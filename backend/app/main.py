"""
FastAPI main application with Telegram MTProto client lifecycle.
"""
import logging
import asyncio
import secrets
import traceback
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, Form
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse, JSONResponse
from urllib.parse import urlencode
import os

import logging
logging.getLogger("pyrogram").setLevel(logging.INFO)

from .config import get_settings
from .database import init_db, engine
from .telegram import start_telegram_client, stop_telegram_client
from .downloader import link_importer
from .drive_importer import drive_importer
from .tts import tts_queue
from .stt import stt_queue
from .monitoring import source_monitor_service
from .routers import files_router, folders_router, streaming_router, auth_router, tv_router, playlists_router, accounts_router, tts_router, stt_router, packs_router
from .routers.delivery import router as delivery_router

settings = get_settings()

# Rate limiter - uses IP address by default
limiter = Limiter(key_func=get_remote_address)


logger = logging.getLogger(__name__)


async def persist_error_log(request_id: str, method: str, path: str, message: str, trace: str | None = None):
    """Best-effort persistence that must never hide the original response."""
    try:
        from .database import async_session
        from .models import ErrorLog
        async with async_session() as db:
            db.add(ErrorLog(
                error_id=request_id[:16], method=method[:12], path=path[:512],
                message=message[:2000] or "Unknown server error",
                traceback=trace[-12000:] if trace else None,
            ))
            await db.commit()
    except Exception:
        logger.exception("Could not persist request error [%s]", request_id)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan - start/stop Telegram client and init DB."""
    logger.info("Starting کمد Backend...")
    logger.info(
        "Database target: host=%s port=%s pool=%s",
        engine.url.host or "local",
        engine.url.port or "default",
        type(engine.sync_engine.pool).__name__,
    )
    logger.info("Runtime port: PORT=%s fallback=%s", os.getenv("PORT", "unset"), settings.server_port)
    for attempt in range(1, 7):
        try:
            await init_db()
            break
        except Exception:
            if attempt == 6:
                logger.exception("Database initialization failed after 6 attempts")
                raise
            delay = min(2 ** attempt, 10)
            logger.warning(
                "Database is temporarily unavailable; retrying in %s seconds (%s/6)",
                delay,
                attempt,
                exc_info=True,
            )
            await asyncio.sleep(delay)
    logger.info("Database initialized")
    try:
        from .caption_metadata import extract_tags_from_caption
        from .models import File, User
        from .database import async_session
        from sqlalchemy import select, or_
        import json
        async with async_session() as db:
            files_to_sync = (await db.execute(
                select(File, User).join(User, User.id == File.user_id).where(
                    File.description.isnot(None),
                    or_(File.tags_json.is_(None), File.tags_json == "[]", File.tags_json == ""),
                )
            )).all()
            changed = False
            for f, owner in files_to_sync:
                try:
                    exclusions = json.loads(owner.tag_exclusions_json or "[]")
                except (TypeError, ValueError):
                    exclusions = []
                tags = extract_tags_from_caption(f.description, exclusions)
                if tags:
                    f.tags_json = json.dumps(tags, ensure_ascii=False)
                    changed = True
            if changed:
                await db.commit()
                logger.info("Backfilled caption tags for existing files.")
    except Exception as e:
        logger.warning(f"Could not backfill caption tags: {e}")
    if settings.local_dev_mode:
        logger.warning("Local development mode is active: external Telegram, Drive and monitor workers are disabled")
    else:
        await start_telegram_client()
        logger.info("Telegram client started")
        if link_importer.available:
            try:
                await link_importer.start()
            except Exception:
                logger.exception("Background link importer could not start; the rest of the app remains available")
        await drive_importer.start()
        # Recovery also supports users who configured only personal Gemini keys.
        await tts_queue.start()
        await stt_queue.start()
        await source_monitor_service.start()
    
    yield
    
    logger.info("Shutting down...")
    if not settings.local_dev_mode:
        await source_monitor_service.stop()
        await drive_importer.stop()
        await link_importer.stop()
        await tts_queue.stop()
        await stt_queue.stop()
        await stop_telegram_client()
        logger.info("Telegram client stopped")


app = FastAPI(
    title="کمد API",
    description="Stream files from Telegram to Android TV and Web",
    version="1.0.0",
    lifespan=lifespan,
)

# Add rate limiter to app state
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


@app.middleware("http")
async def track_unexpected_errors(request: Request, call_next):
    """Attach a trace ID to responses and persist unexpected failures for admins."""
    request_id = secrets.token_hex(6)
    try:
        response = await call_next(request)
    except Exception as error:
        logger.exception("Unhandled request error [%s] %s %s", request_id, request.method, request.url.path)
        await persist_error_log(request_id, request.method, request.url.path, str(error) or error.__class__.__name__, traceback.format_exc())
        return JSONResponse(
            status_code=500,
            content={"detail": "یک خطای پیش‌بینی‌نشده رخ داد.", "error_id": request_id},
            headers={"X-Request-ID": request_id},
        )
    if response.status_code >= 500:
        logger.error("Server error response [%s] %s %s -> %s", request_id, request.method, request.url.path, response.status_code)
        await persist_error_log(request_id, request.method, request.url.path, f"HTTP {response.status_code} response")
    response.headers["X-Request-ID"] = request_id
    return response

# CORS middleware - Properly configured for production
# List allowed origins explicitly instead of using "*"
allowed_origins = [
    settings.web_base_url,  # Your web app domain
    "http://localhost:3000",  # Dev frontend
    "http://localhost:5173",  # Vite dev server
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept", "Range", "X-Workspace-User", "X-Komod-Device-ID"],
    expose_headers=["Content-Range", "Accept-Ranges", "Content-Length", "X-Request-ID"],
)


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    """Add security headers to all responses."""
    response = await call_next(request)
    
    # Prevent MIME type sniffing
    response.headers["X-Content-Type-Options"] = "nosniff"
    
    # Prevent clickjacking (allow framing only for same origin)
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=()"
    if request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    if request.url.path.startswith("/api/auth"):
        response.headers["Cache-Control"] = "no-store"
    
    # Content Security Policy (adjust as needed for your frontend)
    # response.headers["Content-Security-Policy"] = "default-src 'self'"
    
    return response


# Include routers
app.include_router(auth_router, prefix="/api")
app.include_router(files_router, prefix="/api")
app.include_router(folders_router, prefix="/api")
app.include_router(streaming_router, prefix="/api")
app.include_router(tv_router, prefix="/api")
app.include_router(playlists_router, prefix="/api")
app.include_router(accounts_router, prefix="/api")
app.include_router(tts_router, prefix="/api")
app.include_router(stt_router, prefix="/api")
app.include_router(packs_router, prefix="/api")
app.include_router(delivery_router, prefix="/api")





@app.get("/health")
async def health():
    """Health check for container orchestration."""
    return {"status": "healthy"}


@app.post("/share-target")
async def receive_shared_link(
    title: str = Form(""),
    text: str = Form(""),
    url: str = Form(""),
):
    """Receive links shared to the installed PWA and continue in the import UI."""
    query = urlencode({"share-target": "1", "title": title, "text": text, "url": url})
    return RedirectResponse(url=f"/?{query}", status_code=303)


# ... imports ...

# Mount static files (assets) - checking if directory exists first to avoid dev errors
if os.path.exists("app/static/assets"):
    app.mount("/assets", StaticFiles(directory="app/static/assets"), name="assets")

# ... (API routers are included above) ...

@app.get("/{full_path:path}")
async def serve_spa(full_path: str):
    """Serve the React SPA for any non-API routes."""
    # API routes are already handled by routers above
    if full_path == "api" or full_path.startswith("api/"):
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="API Endpoint not found")

    # Check if the file exists in static directory (e.g. logo.png, favicon.ico)
    static_file_path = f"app/static/{full_path}"
    if os.path.exists(static_file_path) and os.path.isfile(static_file_path):
        headers = {"Cache-Control": "no-cache, no-store, must-revalidate"} if full_path in {"sw.js", "index.html"} else None
        return FileResponse(static_file_path, headers=headers)
        
    # Serve index.html for generic SPA routes
    if os.path.exists("app/static/index.html"):
        return FileResponse(
            "app/static/index.html",
            headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
        )
        
    return {"message": "Backend running. Frontend not built/mounted (dev mode)."}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=settings.server_host,
        port=settings.server_port,
        reload=True
    )
