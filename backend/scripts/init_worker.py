"""Create an isolated Telegram user session for imports or monitoring."""
import asyncio
import argparse
import os

from pyrogram import Client


async def main(purpose: str) -> None:
    api_id = int(os.getenv("TELEGRAM_API_ID") or input("Telegram API ID: ").strip())
    api_hash = os.getenv("TELEGRAM_API_HASH") or input("Telegram API Hash: ").strip()
    client = Client(f"komod-{purpose}-local", api_id=api_id, api_hash=api_hash, in_memory=True)
    await client.start()
    try:
        session = await client.export_session_string()
        variable = "TELEGRAM_MONITOR_SESSION" if purpose == "monitor" else "TELEGRAM_WORKER_SESSION"
        plural = "TELEGRAM_MONITOR_SESSIONS" if purpose == "monitor" else "TELEGRAM_WORKER_SESSIONS"
        print(f"\n{variable}=\n")
        print(session)
        print(f"\nبرای افزودن حساب‌های بعدی، نشست‌های تازه را با کاما در {plural} در Railway قرار بده.")
        if purpose == "import":
            print("این حساب فقط برای واردکردن لینک استفاده می‌شود؛ یک‌بار @allsaverbot را با آن باز و Start کن.")
        else:
            print("این حساب فقط برای پایش کانال‌های تلگرام و Saved Messages استفاده می‌شود.")
    finally:
        await client.stop()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--purpose", choices=("import", "monitor"), default="import")
    args = parser.parse_args()
    asyncio.run(main(args.purpose))
