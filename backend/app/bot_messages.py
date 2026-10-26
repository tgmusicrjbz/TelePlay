"""Administrator-editable Telegram bot reply templates."""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from string import Formatter

from sqlalchemy import select

from .database import async_session
from .models import AppSetting


@dataclass(frozen=True)
class BotMessageDefinition:
    key: str
    title: str
    category: str
    default: str
    variables: tuple[str, ...] = ()


BOT_MESSAGE_DEFINITIONS = (
    BotMessageDefinition("welcome", "پیام شروع", "عمومی", "🗄️ **سلام {first_name}!**\nفایل بفرست یا یکی از بخش‌ها را باز کن.", ("first_name",)),
    BotMessageDefinition("access_denied", "دسترسی محدود", "عمومی", "🚫 **دسترسی محدوده**\n\nاین ربات فقط برای کاربرهای مجاز فعاله.\nشناسهٔ تلگرام شما: `{telegram_id}`", ("telegram_id",)),
    BotMessageDefinition("file_access_denied", "عدم اجازه ذخیره فایل", "عمومی", "🚫 این حساب فعلاً اجازهٔ ذخیره فایل در کمد رو نداره.\nآیدی تلگرام: `{telegram_id}`", ("telegram_id",)),
    BotMessageDefinition("help", "راهنمای ربات", "عمومی", "💡 **راهنمای کمد**\n\nفایل، متن یا لینک بفرست؛ بقیه‌اش با کمد."),
    BotMessageDefinition("login_confirmed", "تأیید ورود دستگاه", "ورود", "✅ ورود دستگاه شما تأیید شد."),
    BotMessageDefinition("login_code_used", "کد ورود استفاده‌شده", "ورود", "⚠️ این کد قبلاً استفاده شده."),
    BotMessageDefinition("login_code_expired", "انقضای کد ورود", "ورود", "❌ اعتبار این کد تموم شده."),
    BotMessageDefinition("link_service_unavailable", "غیرفعال بودن دریافت لینک", "لینک‌ها", "⚙️ دانلود از لینک هنوز روی سرور تنظیم نشده است."),
    BotMessageDefinition("link_queued", "افزوده شدن لینک به صف", "لینک‌ها", "🔗 {count} لینک به صف اضافه شد{queue_note}.\nوقتی آماده شود خبرت می‌کنم.", ("count", "queue_note")),
    BotMessageDefinition("link_enqueue_failed", "خطای ثبت لینک", "لینک‌ها", "❌ ثبت لینک در صف انجام نشد؛ کمی بعد دوباره تلاش کن."),
    BotMessageDefinition("link_finished", "پایان دریافت لینک", "لینک‌ها", "✅ {count} فایل {destination}.", ("count", "destination")),
    BotMessageDefinition("link_failed", "خطای دریافت لینک", "لینک‌ها", "❌ {error}", ("error",)),
    BotMessageDefinition("tts_unavailable", "غیرفعال بودن متن به صدا", "متن و صدا", "تبدیل متن به صدا هنوز روی سرور فعال نشده."),
    BotMessageDefinition("tts_text_required", "نبودن متن برای تبدیل", "متن و صدا", "متن را بعد از `/tts` بنویس یا این دستور را روی یک پیام متنی ریپلای کن."),
    BotMessageDefinition("tts_queued", "ثبت درخواست متن به صدا", "متن و صدا", "🎙️ درخواست ساخت صدا ثبت شد.{queue_note}", ("queue_note",)),
    BotMessageDefinition("group_tts_output_caption", "متن زیر خروجی متن به صدا در گروه", "گروه‌ها", "{title}", ("title",)),
    BotMessageDefinition("stt_unavailable", "غیرفعال بودن صوت به متن", "متن و صدا", "استخراج متن هنوز روی سرور فعال نشده."),
    BotMessageDefinition("stt_waiting_upload", "انتظار برای صوت یا ویدیو", "متن و صدا", "🎙️ حالا صدا یا ویدیو را بفرست. خود فایل در کمد ذخیره نمی‌شود."),
    BotMessageDefinition("stt_reply_required", "راهنمای ریپلای صوت", "متن و صدا", "روی صدا یا ویدیو ریپلای کن و `/stt` را بفرست. برای خروجی موقت هم `/stt temp` بزن."),
    BotMessageDefinition("stt_invalid_media", "نوع فایل نامعتبر", "متن و صدا", "این فایل صوتی یا ویدیویی نیست."),
    BotMessageDefinition("stt_prepare_failed", "خطای آماده‌سازی صوت", "متن و صدا", "فایل برای استخراج متن آماده نشد؛ دوباره تلاش کن."),
    BotMessageDefinition("stt_queued", "ثبت درخواست صوت به متن", "متن و صدا", "📝 درخواست استخراج متن ثبت شد.{queue_note}", ("queue_note",)),
    BotMessageDefinition("group_stt_output_caption", "متن زیر خروجی صوت به متن در گروه", "گروه‌ها", "{title}", ("title",)),
    BotMessageDefinition("folder_name_required", "نبودن نام کشو", "کشوها", "اسم کشو رو بعد از دستور بنویس؛ نمونه: `/newfolder فیلم‌ها`."),
    BotMessageDefinition("folder_name_invalid", "نام نامعتبر کشو", "کشوها", "اسم کشو باید بین ۱ تا ۲۵۵ نویسه باشه."),
    BotMessageDefinition("folder_duplicate", "کشوی تکراری", "کشوها", "❌ یه کشو با اسم «{folder_name}» همین‌جا داری.", ("folder_name",)),
    BotMessageDefinition("search_query_required", "نبودن عبارت جست‌وجو", "جست‌وجو", "🔎 عبارت رو بعد از دستور بنویس؛ نمونه: `/search سفر`."),
    BotMessageDefinition("file_save_queued", "شروع ذخیره فایل", "فایل‌ها", "⏳ {state}", ("state",)),
    BotMessageDefinition("group_admin_required", "نیاز به مدیر گروه", "گروه‌ها", "این دستور را یکی از مدیرهای گروه بفرستد."),
    BotMessageDefinition("group_not_connected", "گروه متصل نیست", "گروه‌ها", "اول یکی از مدیرهای گروه دستور `/connect_here` را بفرستد تا امکانات کمد برای این گروه فعال شود."),
    BotMessageDefinition("group_owner_required", "اتصال فقط توسط مدیر", "گروه‌ها", "فقط مدیر گروه یا کانال می‌تواند این مقصد را وصل کند."),
    BotMessageDefinition("group_access_check_failed", "خطای بررسی دسترسی گروه", "گروه‌ها", "بررسی دسترسی انجام نشد؛ ربات را مدیر این گفت‌وگو کن."),
    BotMessageDefinition("group_connect_private_first", "فعال نبودن کمد مدیر", "گروه‌ها", "اول در گفت‌وگوی خصوصی ربات، کمدت را فعال کن."),
    BotMessageDefinition("group_approval_pending", "درخواست تأیید گروه", "گروه‌ها", "🕓 درخواست اتصال این گروه برای مدیر کمد فرستاده شد. بعد از تأیید، ابزارها فعال می‌شوند."),
    BotMessageDefinition("group_connected", "اتصال موفق گروه", "گروه‌ها", "✅ این گروه تأیید و به کمد متصل شد.\n\nاز منوی دکمه‌ای ربات برای متن به صدا، صوت به متن، لینک‌ها و نمایش مصرف استفاده کن."),
)

BOT_MESSAGE_BY_KEY = {item.key: item for item in BOT_MESSAGE_DEFINITIONS}
SETTING_PREFIX = "bot_message."
_cache: dict[str, str] = {}
_cache_loaded_at = 0.0
_cache_lock = asyncio.Lock()


def validate_bot_message(key: str, value: str) -> str:
    definition = BOT_MESSAGE_BY_KEY.get(key)
    if definition is None:
        raise ValueError("پیام ناشناخته است.")
    cleaned = value.strip()
    if not cleaned:
        raise ValueError("متن پیام نمی‌تواند خالی باشد.")
    if len(cleaned) > 3500:
        raise ValueError("متن پیام نباید بیشتر از ۳۵۰۰ نویسه باشد.")
    try:
        used = {field.split(".", 1)[0].split("[", 1)[0] for _, field, _, _ in Formatter().parse(cleaned) if field}
    except ValueError as error:
        raise ValueError("ساختار آکولادهای متن درست نیست.") from error
    unknown = used.difference(definition.variables)
    if unknown:
        raise ValueError(f"متغیر ناشناخته: {', '.join(sorted(unknown))}")
    return cleaned


def invalidate_bot_message_cache() -> None:
    global _cache_loaded_at
    _cache.clear()
    _cache_loaded_at = 0.0


async def _load_overrides() -> dict[str, str]:
    global _cache_loaded_at
    if time.monotonic() - _cache_loaded_at < 15:
        return _cache
    async with _cache_lock:
        if time.monotonic() - _cache_loaded_at < 15:
            return _cache
        async with async_session() as db:
            rows = (await db.execute(select(AppSetting).where(AppSetting.key.like(f"{SETTING_PREFIX}%")))).scalars().all()
        _cache.clear()
        _cache.update({row.key.removeprefix(SETTING_PREFIX): row.value for row in rows})
        _cache_loaded_at = time.monotonic()
    return _cache


async def bot_message(key: str, **values: object) -> str:
    definition = BOT_MESSAGE_BY_KEY[key]
    template = (await _load_overrides()).get(key, definition.default)
    context = {name: str(values.get(name, "")) for name in definition.variables}
    try:
        return template.format_map(context)
    except (KeyError, ValueError):
        return definition.default.format_map(context)
