"""TelePlay backend package.

Importing a model or migration must not construct the FastAPI application or
Telegram clients. The ASGI entry point remains ``app.main:app``.
"""
