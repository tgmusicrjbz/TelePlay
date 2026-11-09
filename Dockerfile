# Dockerfile for PaaS Deployment (Render, Railway, Heroku)
# Builds both Frontend and Backend in a single image.

# ----------------------------
# Stage 1: Build Frontend
# ----------------------------
FROM node:20-alpine as frontend-builder
WORKDIR /web-build

# Copy frontend dependency files
COPY web/package*.json ./
RUN npm ci

# Copy frontend source code
COPY web/ ./
RUN npm run build


# ----------------------------
# Stage 2: Build Python wheels
# ----------------------------
FROM python:3.11-slim AS backend-builder
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*
COPY backend/requirements.txt .
RUN pip wheel --no-cache-dir --wheel-dir /wheels -r requirements.txt


# ----------------------------
# Stage 3: Minimal Backend Runtime
# ----------------------------
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install prebuilt dependencies without carrying compilers into production.
COPY --from=backend-builder /wheels /wheels
RUN pip install --no-cache-dir --no-index /wheels/* && rm -rf /wheels

RUN useradd --create-home --uid 10001 appuser

# Copy backend code
COPY --chown=appuser:appuser backend/app/ ./app/
COPY --chown=appuser:appuser backend/alembic.ini ./alembic.ini
COPY --chown=appuser:appuser backend/alembic/ ./alembic/

# Copy built frontend assets from Stage 1 to Backend's static folder
# FastAPI is configured to look in 'app/static' to serve the SPA
COPY --chown=appuser:appuser --from=frontend-builder /web-build/dist ./app/static

# Create session directory
RUN mkdir -p /app/session && chown appuser:appuser /app/session

# Set environment variable to tell FastAPI we are in production/monolith mode if needed
ENV MULTI_CONTAINER_SETUP=false

# Expose port
EXPOSE 8000

USER appuser

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
    CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:'+os.getenv('PORT','8000')+'/ready', timeout=3)" || exit 1

# Run FastAPI on the port assigned by the hosting platform.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
