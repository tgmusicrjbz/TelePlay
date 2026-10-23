"""Create a Telegram user session string for the background import worker."""
import asyncio
import os

from pyrogram import Client


async def main() -> None:
    api_id = int(os.getenv("TELEGRAM_API_ID") or input("Telegram API ID: ").strip())
    api_hash = os.getenv("TELEGRAM_API_HASH") or input("Telegram API Hash: ").strip()
    client = Client("komod-worker-local", api_id=api_id, api_hash=api_hash, in_memory=True)
    await client.start()
    try:
        session = await client.export_session_string()
        print("\nTELEGRAM_WORKER_SESSION=\n")
        print(session)
        print("\nبرای افزودن حساب‌های بعدی، همین اسکریپت را با همان API ID و Hash برای هر حساب اجرا کن؛ نشست‌های تازه را با کاما در TELEGRAM_WORKER_SESSIONS در Railway قرار بده.")
    finally:
        await client.stop()


if __name__ == "__main__":
    asyncio.run(main())
