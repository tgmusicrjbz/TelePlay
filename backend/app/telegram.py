"""
PyroTGFork MTProto client for Telegram interactions.
Handles both bot commands and file streaming via a client pool.
"""
from .patch import Client
from pyrogram.types import Message, BotCommand
from pyrogram.errors import MessageIdInvalid
from .config import get_settings
from pathlib import Path
import asyncio
import logging


settings = get_settings()

# Absolute path for session files
BASE_DIR = Path(__file__).resolve().parent.parent
SESSION_DIR = BASE_DIR / "session"


def get_session_name(index: int) -> str:
    return str(SESSION_DIR / f"bot_{index}")


# Created in build_clients() inside the running event loop (see start_telegram_client).
clients: list[Client] = []
tg_client: Client | None = None
_background_tasks: set[asyncio.Task] = set()


def build_clients() -> None:
    """Build client pool lazily so Pyrogram binds to uvicorn's event loop."""
    global tg_client
    if clients:
        return
    SESSION_DIR.mkdir(parents=True, exist_ok=True)
    for i, token in enumerate(settings.all_bot_tokens):
        client = Client(
            name=get_session_name(i),
            api_id=settings.telegram_api_id,
            api_hash=settings.telegram_api_hash,
            bot_token=token,
            ipv6=False,
            max_concurrent_transmissions=settings.telegram_client_concurrency,
            no_updates=(i > 0),          # only main client receives updates
        )
        client.pool_index = i            # custom attr for logging
        clients.append(client)
    tg_client = clients[0]


# ── lifecycle helpers ────────────────────────────────────────────────
logger = logging.getLogger(__name__)


def spawn_background(coro, *, name: str) -> asyncio.Task:
    """Run optional Telegram setup without delaying FastAPI readiness."""
    task = asyncio.create_task(coro, name=name)
    _background_tasks.add(task)

    def finished(done: asyncio.Task) -> None:
        _background_tasks.discard(done)
        if done.cancelled():
            return
        error = done.exception()
        if error is not None:
            logger.error("Background Telegram task %s failed: %s", name, error, exc_info=error)

    task.add_done_callback(finished)
    return task


async def configure_main_client(c) -> None:
    """Update commands and profile text; failures must never block the web app."""
    try:
        await asyncio.wait_for(c.set_bot_commands([
            BotCommand("start", "باز کردن منوی اصلی"),
            BotCommand("myfiles", "دیدن فایل‌های ذخیره‌شده"),
            BotCommand("folders", "مرور کشوهای کمد"),
            BotCommand("playlists", "ساخت و پخش پلی‌لیست‌ها"),
            BotCommand("search", "جست‌وجو در فایل‌ها و کشوها"),
            BotCommand("newfolder", "ساخت کشوی جدید"),
            BotCommand("web", "راهنمای ورود به نسخهٔ وب"),
            BotCommand("login", "تأیید کد ورود دستگاه"),
            BotCommand("help", "نمایش راهنمای استفاده"),
            BotCommand("logout_all", "خروج از همهٔ دستگاه‌ها"),
        ]), timeout=20)
        if hasattr(c, "set_bot_name"):
            await asyncio.wait_for(c.set_bot_name("🗂 کمد | درایو ابری تلگرام"), timeout=20)
            await asyncio.wait_for(c.set_bot_info_short_description(
                "فایلات رو کشوبندی کن، فیلم و موزیکاتو بدون نیاز به دانلود استریم کن و همه‌چیز رو منظم نگه دار! 📦✨"
            ), timeout=20)
            await asyncio.wait_for(c.set_bot_info_description(
                "به کُمُد 🗄 خوش اومدی!\n"
                "کمد، درایو ابری و پخش‌کننده شخصی شما روی تلگرامه تا فایل‌هاتون هیچ‌وقت گم نشن.\n\n"
                "توی کمد چه کارهایی می‌تونی بکنی؟\n"
                "🗃 کِشوبندی و نظم: ساخت پوشه‌ها و زیرپوشه‌ها برای هر نوع فایل\n"
                "🎬 استریم اختصاصی: تماشای مستقیم فیلم‌ها و پخش آهنگ‌ها بدون اتلاف حافظه\n"
                "🔍 جست‌وجوی تیزبین: پیدا کردن آنی فایل‌ها بر اساس نام یا نوع (فیلم، سند، عکس، صوت)\n"
                "🌐 نسخه وب: دسترسی سریع و راحت روی مرورگر و کامپیوتر\n"
                "👈 دکمه Start (شروع) رو بزن تا در کمدت باز بشه!"
            ), timeout=20)
    except Exception as error:
        logger.warning("Could not update Telegram bot commands/profile: %s", error)


async def start_one_client(i, c):
    try:
        await asyncio.wait_for(c.start(), timeout=45)
        me = await asyncio.wait_for(c.get_me(), timeout=15)
        label = "Main" if i == 0 else "Helper"
        logger.info("Client %d (%s) started → @%s", i, label, me.username)
        return True
    except Exception as e:
        logger.error("Client %d failed to start: %s", i, e)
        await stop_one_client(c)
        if i == 0:
            raise
        return False


async def start_all_clients():
    logger.info("Starting %d Telegram client(s)...", len(clients))
    await start_one_client(0, clients[0])
    spawn_background(configure_main_client(clients[0]), name="configure-main-bot")
    if len(clients) > 1:
        for i, client in enumerate(clients[1:], 1):
            spawn_background(start_one_client(i, client), name=f"start-helper-{i}")


async def stop_one_client(c):
    try:
        if c.is_connected:
            await c.stop()
    except Exception:
        pass


async def stop_all_clients():
    pending = list(_background_tasks)
    for task in pending:
        task.cancel()
    if pending:
        await asyncio.gather(*pending, return_exceptions=True)
    await asyncio.gather(*(stop_one_client(c) for c in clients))


async def start_telegram_client():
    """Called from app lifespan — starts the full pool."""
    build_clients()
    from . import bot  # noqa: F401 — register handlers after client exists
    await start_all_clients()


async def stop_telegram_client():
    """Called from app lifespan — stops the full pool."""
    await stop_all_clients()


# ── convenience helpers (always use tg_client) ───────────────────────

async def get_message_from_channel(message_id: int) -> Message:
    """Get a message from the storage channel by ID."""
    return await tg_client.get_messages(
        settings.telegram_storage_channel_id,
        message_id,
    )


async def forward_to_storage_channel(message: Message) -> Message:
    """Forward a message to the storage channel."""
    return await message.copy(settings.telegram_storage_channel_id)



async def delete_from_storage_channel(message_ids: int | list[int]) -> bool:
    """Delete channel messages idempotently, with per-message fallback for mixed batches."""
    ids = message_ids if isinstance(message_ids, list) else [message_ids]
    if not ids:
        return True
    try:
        await tg_client.delete_messages(
            settings.telegram_storage_channel_id,
            ids if isinstance(message_ids, list) else ids[0],
        )
        return True
    except MessageIdInvalid:
        # One stale ID can reject a complete Telegram batch. Retry each message;
        # an already removed message is considered a successful delete.
        pass
    except Exception as error:
        logger.warning("Batch delete failed for %d storage message(s): %s", len(ids), error)

    failed = []
    for message_id in ids:
        try:
            await tg_client.delete_messages(settings.telegram_storage_channel_id, message_id)
        except MessageIdInvalid:
            continue
        except Exception as error:
            logger.error("Could not delete storage message %s: %s", message_id, error)
            failed.append(message_id)
    return not failed
