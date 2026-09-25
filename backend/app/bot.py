"""
Telegram Bot handlers using PyroTGFork MTProto.
Handles commands, file uploads, and inline callbacks.
"""

import secrets
import string
import re
import asyncio
import contextlib
import logging
import random
import json
from datetime import datetime, timedelta, timezone
from pyrogram import filters, enums
from pyrogram.errors import MessageNotModified
from pyrogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
from sqlalchemy import delete, func, select, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from .telegram import tg_client, forward_to_storage_channel, delete_from_storage_channel
from .database import async_session
from .models import User, File, Folder, LoginCode, Playlist, PlaylistItem, BotUserState
from .config import get_settings
from .auth import create_access_token
from .services import escape_like

settings = get_settings()
logger = logging.getLogger(__name__)
pending_input_chats: set[int] = set()
search_queries: dict[int, str] = {}
library_filters: dict[int, set[str]] = {}
search_filters: dict[int, set[str]] = {}
filter_return_targets: dict[int, str] = {}
filter_previous: dict[tuple[int, str], set[str]] = {}
search_filter_returns: dict[int, str] = {}
input_action_queues: dict[int, asyncio.Queue[str]] = {}
detail_back_targets: dict[int, str] = {}
sort_preferences: dict[int, list[tuple[str, str]]] = {}
sort_drafts: dict[int, list[tuple[str, str]]] = {}
sort_return_targets: dict[int, str] = {}
batch_selections: dict[int, set[int]] = {}
batch_return_targets: dict[int, str] = {}
current_drawers: dict[int, int | None] = {}
loaded_ui_state_users: set[int] = set()
PAGE_SIZE = 8
PREVIEW_TTL_SECONDS = 300
TEHRAN_TZ = timezone(timedelta(hours=3, minutes=30))
FILE_ICONS = {"video": "🎬", "audio": "🎵", "document": "📄", "image": "🖼", "text": "📝"}
TYPE_LABELS = {"all": "همه", "video": "فیلم", "audio": "آهنگ", "image": "عکس", "text": "متن", "document": "سند", "folder": "کشو"}
SORT_LABELS = {"name": "نام", "type": "نوع", "size": "حجم", "duration": "مدت", "created": "تاریخ آپلود", "updated": "تاریخ ویرایش"}


def _sort_value(kind: str, item, field: str):
    if kind == "root":
        return None
    if field == "name":
        return (item.file_name if kind == "file" else item.name).casefold()
    if field == "type":
        return item.file_type if kind == "file" else "folder"
    if field == "size":
        return item.file_size if kind == "file" else None
    if field == "duration":
        return item.duration if kind == "file" else None
    if field == "created":
        return item.created_at
    if field == "updated":
        return item.updated_at
    return None


def sort_library_items(items: list[tuple[str, object]], telegram_id: int) -> list[tuple[str, object]]:
    """Stable multi-level sorting with missing values kept at the end."""
    ordered = list(items)
    criteria = sort_preferences.get(telegram_id, [("created", "desc")])
    for field, direction in reversed(criteria):
        present = [entry for entry in ordered if _sort_value(entry[0], entry[1], field) is not None]
        missing = [entry for entry in ordered if _sort_value(entry[0], entry[1], field) is None]
        present.sort(key=lambda entry: _sort_value(entry[0], entry[1], field), reverse=direction == "desc")
        ordered = present + missing
    return ordered


def sort_keyboard(telegram_id: int) -> InlineKeyboardMarkup:
    draft = sort_drafts.get(telegram_id, [])
    buttons = []
    fields = list(SORT_LABELS)
    for start in range(0, len(fields), 2):
        row = []
        for field in fields[start:start + 2]:
            current = next(((index, direction) for index, (name, direction) in enumerate(draft) if name == field), None)
            prefix = f"{to_persian_digits(str(current[0] + 1))}. {'↑' if current[1] == 'asc' else '↓'} " if current else ""
            row.append(InlineKeyboardButton(f"{prefix}{SORT_LABELS[field]}", callback_data=f"sort_toggle:{field}"))
        buttons.append(row)
    buttons.extend([
        [InlineKeyboardButton("💾 اعمال مرتب‌سازی", callback_data="sort_apply"), InlineKeyboardButton("↩️ حالت پیش‌فرض", callback_data="sort_default")],
        [InlineKeyboardButton("✖️ انصراف", callback_data="sort_cancel")],
    ])
    return InlineKeyboardMarkup(buttons)


def escape_markdown(value: str) -> str:
    """Keep user supplied names and descriptions from breaking Telegram formatting."""
    return re.sub(r"([\\*_`\[\]])", r"\\\1", value)


def owned_file(file_id: int, telegram_id: int):
    return select(File).join(User, File.user_id == User.id).where(
        File.id == file_id, User.telegram_id == telegram_id
    )


def owned_folder(folder_id: int, telegram_id: int):
    return select(Folder).join(User, Folder.user_id == User.id).where(
        Folder.id == folder_id, User.telegram_id == telegram_id
    )


def owned_playlist(playlist_id: int, telegram_id: int):
    return (
        select(Playlist)
        .join(User, Playlist.user_id == User.id)
        .where(Playlist.id == playlist_id, User.telegram_id == telegram_id)
        .options(selectinload(Playlist.items).selectinload(PlaylistItem.file))
        .execution_options(populate_existing=True)
    )


def format_size(size_bytes: int) -> str:
    """Format bytes with Persian digits and localized units."""
    for unit in ["بایت", "کیلوبایت", "مگابایت", "گیگابایت"]:
        if size_bytes < 1024:
            return to_persian_digits(f"{size_bytes:.1f}") + f" {unit}"
        size_bytes /= 1024
    return to_persian_digits(f"{size_bytes:.1f}") + " ترابایت"


def format_duration(seconds: int) -> str:
    """Format seconds as friendly Persian text."""
    if not seconds:
        return ""
    hours, remainder = divmod(seconds, 3600)
    minutes, secs = divmod(remainder, 60)
    if hours:
        parts = [f"{to_persian_digits(str(hours))} ساعت"]
        if minutes:
            parts.append(f"{to_persian_digits(str(minutes))} دقیقه")
        return " و ".join(parts)
    if minutes:
        parts = [f"{to_persian_digits(str(minutes))} دقیقه"]
        if secs:
            parts.append(f"{to_persian_digits(str(secs))} ثانیه")
        return " و ".join(parts)
    return f"{to_persian_digits(str(secs))} ثانیه"


def to_persian_digits(value: str) -> str:
    return value.translate(str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹"))


def display_filename(value: str, *, limit: int | None = None) -> str:
    """Keep mixed Persian/Latin file names visually stable in RTL messages."""
    shown = value[:limit] if limit else value
    return f"\u200e{escape_markdown(shown)}\u200e"


def gregorian_to_jalali(gy: int, gm: int, gd: int) -> tuple[int, int, int]:
    month_days = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
    if gy > 1600:
        jy, gy = 979, gy - 1600
    else:
        jy, gy = 0, gy - 621
    gy2 = gy + 1 if gm > 2 else gy
    days = 365 * gy + (gy2 + 3) // 4 - (gy2 + 99) // 100 + (gy2 + 399) // 400 - 80 + gd + month_days[gm - 1]
    jy += 33 * (days // 12053)
    days %= 12053
    jy += 4 * (days // 1461)
    days %= 1461
    if days > 365:
        jy += (days - 1) // 365
        days = (days - 1) % 365
    if days < 186:
        jm, jd = 1 + days // 31, 1 + days % 31
    else:
        jm, jd = 7 + (days - 186) // 30, 1 + (days - 186) % 30
    return jy, jm, jd


def format_jalali(value: datetime | None) -> str:
    if value is None:
        return "—"
    aware = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value
    local = aware.astimezone(TEHRAN_TZ)
    jy, jm, jd = gregorian_to_jalali(local.year, local.month, local.day)
    return to_persian_digits(f"{jy:04}/{jm:02}/{jd:02}، {local.hour:02}:{local.minute:02}")


def sanitize_filename(name: str) -> str:
    """
    Sanitize filename to prevent path traversal and XSS attacks.
    Removes dangerous characters and limits length.
    """
    import re
    if not name:
        return "unnamed_file"
    
    # Remove null bytes and path separators
    name = name.replace("\x00", "").replace("/", "_").replace("\\", "_")
    
    # Remove other dangerous characters that could cause issues
    name = re.sub(r'[<>:"|?*\x00-\x1f]', '_', name)
    
    # Remove leading/trailing dots and spaces (Windows issues)
    name = name.strip(". ")
    
    # Limit length to prevent issues
    if len(name) > 255:
        # Keep extension if present
        if "." in name:
            ext = name.rsplit(".", 1)[-1][:10]  # Max 10 char extension
            name = name[:255 - len(ext) - 1] + "." + ext
        else:
            name = name[:255]
    
    return name if name else "unnamed_file"


async def get_or_create_user(telegram_id: int, username: str = None, 
                             first_name: str = None, last_name: str = None) -> User:
    """Get or create a user in the database."""
    async with async_session() as db:
        result = await db.execute(select(User).where(User.telegram_id == telegram_id))
        user = result.scalar_one_or_none()
        
        if not user:
            user = User(
                telegram_id=telegram_id,
                username=username,
                first_name=first_name,
                last_name=last_name,
            )
            db.add(user)
            await db.commit()
            await db.refresh(user)
        
        return user


def _json_list(value: str | None, default: list) -> list:
    try:
        result = json.loads(value or "")
        return result if isinstance(result, list) else list(default)
    except (TypeError, ValueError):
        return list(default)


async def load_user_ui_state(telegram_id: int, *, force: bool = False) -> None:
    """Hydrate volatile bot dictionaries from the persistent DB state."""
    if telegram_id in loaded_ui_state_users and not force:
        return
    async with async_session() as db:
        user = (await db.execute(select(User).where(User.telegram_id == telegram_id))).scalar_one_or_none()
        if user is None:
            return
        state = await db.get(BotUserState, user.id)
        if state is None:
            state = BotUserState(user_id=user.id)
            db.add(state)
            await db.commit()
        current_drawers[telegram_id] = state.current_drawer_id
        library_filters[telegram_id] = set(_json_list(state.library_filters_json, []))
        search_filters[telegram_id] = set(_json_list(state.search_filters_json, []))
        if state.search_query:
            search_queries[telegram_id] = state.search_query
        else:
            search_queries.pop(telegram_id, None)
        sort_items = _json_list(state.sort_preferences_json, [["created", "desc"]])
        sort_preferences[telegram_id] = [tuple(item) for item in sort_items if isinstance(item, list) and len(item) == 2]
        selected = {int(item) for item in _json_list(state.batch_selection_json, []) if str(item).isdigit()}
        if selected:
            valid_selected = (await db.execute(
                select(File.id).where(File.user_id == user.id, File.id.in_(selected))
            )).scalars().all()
            selected = set(valid_selected)
        if state.batch_target:
            batch_return_targets[telegram_id] = state.batch_target
            batch_selections[telegram_id] = selected
        else:
            batch_return_targets.pop(telegram_id, None)
            batch_selections.pop(telegram_id, None)
        loaded_ui_state_users.add(telegram_id)


async def persist_user_ui_state(telegram_id: int) -> None:
    """Persist filters, sorting, selection and current drawer across restarts."""
    async with async_session() as db:
        user = (await db.execute(select(User).where(User.telegram_id == telegram_id))).scalar_one_or_none()
        if user is None:
            return
        state = await db.get(BotUserState, user.id)
        if state is None:
            state = BotUserState(user_id=user.id)
            db.add(state)
        state.current_drawer_id = current_drawers.get(telegram_id)
        state.library_filters_json = json.dumps(sorted(library_filters.get(telegram_id, set())))
        state.search_filters_json = json.dumps(sorted(search_filters.get(telegram_id, set())))
        state.search_query = search_queries.get(telegram_id)
        state.sort_preferences_json = json.dumps(sort_preferences.get(telegram_id, [("created", "desc")]))
        state.batch_selection_json = json.dumps(sorted(batch_selections.get(telegram_id, set())))
        state.batch_target = batch_return_targets.get(telegram_id)
        await db.commit()


async def set_current_drawer(telegram_id: int, folder_id: int | None) -> None:
    await load_user_ui_state(telegram_id)
    if current_drawers.get(telegram_id) == folder_id:
        return
    current_drawers[telegram_id] = folder_id
    await persist_user_ui_state(telegram_id)


async def get_active_drawer_id(telegram_id: int) -> int | None:
    await load_user_ui_state(telegram_id)
    folder_id = current_drawers.get(telegram_id)
    if folder_id is None:
        return None
    async with async_session() as db:
        folder = (await db.execute(owned_folder(folder_id, telegram_id))).scalar_one_or_none()
    if folder is None:
        await set_current_drawer(telegram_id, None)
        return None
    return folder_id


def get_web_app_button(telegram_id: int, text: str = "🌐 Open Web") -> InlineKeyboardButton:
    """Use a Mini App for HTTPS; local HTTP needs the code login flow."""
    if not settings.web_base_url.startswith("https://"):
        return InlineKeyboardButton(text, callback_data="get_web_link", style=enums.ButtonStyle.SUCCESS)
    from urllib.parse import quote
    token = create_access_token(telegram_id)
    encoded_token = quote(token, safe='')
    web_url = f"{settings.web_base_url}/auth?token={encoded_token}"
    return InlineKeyboardButton(text, web_app=WebAppInfo(url=web_url), style=enums.ButtonStyle.SUCCESS)


def local_web_instructions() -> str:
    return (
        "🌐 **نسخهٔ وب کمد**\n\n"
        f"توی مرورگر همین کامپیوتر `{settings.web_base_url}` رو باز کن. "
        "کد ورود صفحه رو با دستور `/login CODE` برای ربات بفرست."
    )


async def safe_delete(message: Message | None, animate: bool = False) -> None:
    if not message:
        return
    try:
        await message.delete()
    except Exception:
        pass


async def safe_edit(message: Message, *args, **kwargs):
    """Treat an identical Telegram edit as a successful no-op."""
    try:
        return await message.edit(*args, **kwargs)
    except MessageNotModified:
        return message


async def safe_edit_reply_markup(message: Message, reply_markup):
    try:
        return await message.edit_reply_markup(reply_markup)
    except MessageNotModified:
        return message


async def delete_preview_later(client, chat_id: int, message_id: int, delay: int = PREVIEW_TTL_SECONDS) -> None:
    await asyncio.sleep(delay)
    with contextlib.suppress(Exception):
        await client.delete_messages(chat_id, message_id)


def input_keyboard(*, allow_clear: bool = False) -> InlineKeyboardMarkup:
    row = []
    if allow_clear:
        row.append(InlineKeyboardButton("🧹 پاک‌کردن", callback_data="input_action:clear"))
    row.append(InlineKeyboardButton("✖️ لغو", callback_data="input_action:cancel"))
    return InlineKeyboardMarkup([row])


async def wait_for_input(client, chat_id: int, timeout: int = 120) -> tuple[Message | None, str | None]:
    """Wait for either a user message or an inline action from the prompt."""
    queue: asyncio.Queue[str] = asyncio.Queue(maxsize=1)
    input_action_queues[chat_id] = queue
    message_task = asyncio.create_task(client.wait_for_message(chat_id=chat_id, timeout=timeout))
    action_task = asyncio.create_task(queue.get())
    try:
        done, _ = await asyncio.wait({message_task, action_task}, return_when=asyncio.FIRST_COMPLETED)
        if action_task in done:
            return None, action_task.result()
        return message_task.result(), None
    finally:
        input_action_queues.pop(chat_id, None)
        for task in (message_task, action_task):
            if not task.done():
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task


def truncate_description(value: str, max_chars: int = 360, max_lines: int = 4) -> str:
    lines = value.strip().splitlines()
    clipped = "\n".join(lines[:max_lines]).strip()
    truncated = len(lines) > max_lines or len(clipped) > max_chars
    if len(clipped) > max_chars:
        clipped = clipped[:max_chars].rstrip()
    return clipped + ("…" if truncated else "")


def pagination_row(prefix: str, page: int, total: int) -> list[InlineKeyboardButton]:
    pages = max(1, (total + PAGE_SIZE - 1) // PAGE_SIZE)
    row = []
    if page > 0:
        row.append(InlineKeyboardButton("◀️ قبلی", callback_data=f"{prefix}:{page - 1}"))
    row.append(InlineKeyboardButton(f"صفحه {to_persian_digits(str(page + 1))} از {to_persian_digits(str(pages))}", callback_data="noop"))
    if page + 1 < pages:
        row.append(InlineKeyboardButton("▶️ بعدی", callback_data=f"{prefix}:{page + 1}"))
    return row


def file_list_button(file: File, telegram_id: int) -> InlineKeyboardButton:
    selected = file.id in batch_selections.get(telegram_id, set())
    label = f"{'✅ ' if selected else ''}{FILE_ICONS.get(file.file_type, '📎')} \u200e{file.file_name[:38]}\u200e"
    callback_data = f"batch_toggle:{file.id}" if telegram_id in batch_return_targets else f"openfile:{file.id}"
    return InlineKeyboardButton(label, callback_data=callback_data)


def list_action_rows(telegram_id: int, target: str) -> list[list[InlineKeyboardButton]]:
    if telegram_id in batch_return_targets:
        count = to_persian_digits(str(len(batch_selections.get(telegram_id, set()))))
        return [
            [InlineKeyboardButton(f"☑️ انتخاب‌شده‌ها: {count} مورد", callback_data="noop")],
            [InlineKeyboardButton("🗃️ انتقال به کشو", callback_data="batch_move:0", style=enums.ButtonStyle.PRIMARY), InlineKeyboardButton("✏️ ویرایش نام/متن", callback_data="batch_edit")],
            [InlineKeyboardButton("🗑️ حذف گروهی", callback_data="batch_delete", style=enums.ButtonStyle.DANGER), InlineKeyboardButton("✖️ انصراف از انتخاب", callback_data="batch_cancel")],
        ]
    return [[InlineKeyboardButton("☑️ انتخاب گروهی", callback_data=f"batch_start:{target}"), InlineKeyboardButton("↕️ مرتب‌سازی", callback_data=f"sort_open:{target}")]]


async def folder_path(db, folder: Folder | None) -> str:
    names = []
    current = folder
    while current:
        names.append(current.name)
        current = await db.get(Folder, current.parent_id) if current.parent_id else None
    return " / ".join(reversed(names)) or "کشوهای کمد"


async def render_folder_page(message: Message, telegram_id: int, parent_id: int | None = None, page: int = 0) -> None:
    await load_user_ui_state(telegram_id)
    detail_back_targets[telegram_id] = f"folders:{parent_id or 0}:{page}"
    selected_types = library_filters.get(telegram_id, set())
    async with async_session() as db:
        user = (await db.execute(select(User).where(User.telegram_id == telegram_id))).scalar_one_or_none()
        if not user:
            await message.edit("برای شروع، دستور /start رو بفرست.")
            return
        parent = (await db.execute(owned_folder(parent_id, telegram_id))).scalar_one_or_none() if parent_id else None
        if parent_id and not parent:
            await message.edit("این کشو دیگه وجود نداره.", reply_markup=main_menu_keyboard(telegram_id))
            return
        folders = (await db.execute(select(Folder).where(
            Folder.user_id == user.id,
            Folder.parent_id == parent_id,
        ).order_by(Folder.name))).scalars().all()
        file_query = select(File).where(File.user_id == user.id, File.folder_id == parent_id)
        if selected_types:
            file_query = file_query.where(File.file_type.in_(selected_types))
        files = (await db.execute(file_query)).scalars().all()
        root_file_count = len(files) if parent_id is None else 0
        path = await folder_path(db, parent)

    await set_current_drawer(telegram_id, parent_id)

    if parent_id is None:
        items = [("root", root_file_count)] + sort_library_items([("folder", item) for item in folders], telegram_id)
    else:
        items = sort_library_items([("folder", item) for item in folders] + [("file", item) for item in files], telegram_id)
    total = len(items)
    max_page = max(0, (total - 1) // PAGE_SIZE)
    page = min(max(page, 0), max_page)
    current_items = items[page * PAGE_SIZE:(page + 1) * PAGE_SIZE]
    buttons = []
    root_items = [item for kind, item in current_items if kind == "root"]
    folder_items = [item for kind, item in current_items if kind == "folder"]
    file_items = [item for kind, item in current_items if kind == "file"]
    for item in root_items:
        buttons.append([InlineKeyboardButton(f"📦 فایل‌های بیرون از کشو ({to_persian_digits(str(item))})", callback_data="rootfiles:0", style=enums.ButtonStyle.PRIMARY)])
    for index in range(0, len(folder_items), 2):
        buttons.append([
            InlineKeyboardButton(f"🗃️ {folder.name[:22]}", callback_data=f"folder:{folder.id}:0", style=enums.ButtonStyle.PRIMARY)
            for folder in folder_items[index:index + 2]
        ])
    buttons.extend([[file_list_button(item, telegram_id)] for item in file_items])
    if total > PAGE_SIZE:
        buttons.append(pagination_row(f"folders:{parent_id or 0}", page, total))
    if telegram_id in batch_return_targets:
        buttons.extend(list_action_rows(telegram_id, f"folders:{parent_id or 0}:{page}"))
    elif parent:
        buttons.extend([
            [InlineKeyboardButton("☑️ انتخاب گروهی", callback_data=f"batch_start:folders:{parent.id}:{page}"),
             InlineKeyboardButton("⚙️ مدیریت این کشو", callback_data=f"folder_actions:{parent.id}")],
            [InlineKeyboardButton("↩️ کشوی قبلی", callback_data=f"folders:{parent.parent_id or 0}:0"),
             InlineKeyboardButton("🚪 منوی اصلی", callback_data="home")],
        ])
    else:
        buttons.extend([
            [InlineKeyboardButton("↕️ مرتب‌سازی کشوها", callback_data=f"sort_open:folders:0:{page}"),
             InlineKeyboardButton("☑️ فیلتر نوع", callback_data="library_filter:folders:0")],
            [InlineKeyboardButton("➕ ساخت کشو", callback_data="create_folder", style=enums.ButtonStyle.SUCCESS),
             InlineKeyboardButton("🔍 جست‌وجو", callback_data="search_choose", style=enums.ButtonStyle.PRIMARY)],
            [InlineKeyboardButton("🚪 منوی اصلی", callback_data="home")],
        ])
    if parent:
        text = f"🗃️ **{escape_markdown(path)}**\n{to_persian_digits(str(len(folders)))} کشو · {to_persian_digits(str(len(files)))} فایل"
    else:
        text = f"🗄️ **کشوهای کمد**\n{to_persian_digits(str(len(folders)))} کشو · {to_persian_digits(str(root_file_count))} فایل بیرون از کشو"
    if selected_types:
        text += "\n☑️ نوع‌ها: " + "، ".join(TYPE_LABELS[item] for item in sorted(selected_types))
    if parent and parent.description:
        text += f"\n\n📝 توضیحات: {escape_markdown(parent.description[:700])}"
    if not total:
        text += "\n\nاین کشو هنوز خالیه! فایلی بفرست تا بذارمش سر جاش." if parent else "\n\nکمدت هنوز کشویی نداره؛ یکی بساز تا فایل‌هات مرتب‌تر بشن."
    await safe_edit(message, text, reply_markup=InlineKeyboardMarkup(buttons))


async def render_root_files(message: Message, telegram_id: int, page: int = 0) -> None:
    await set_current_drawer(telegram_id, None)
    detail_back_targets[telegram_id] = f"rootfiles:{page}"
    selected_types = library_filters.get(telegram_id, set())
    async with async_session() as db:
        user = (await db.execute(select(User).where(User.telegram_id == telegram_id))).scalar_one_or_none()
        if not user:
            await message.edit("برای شروع، دستور /start رو بفرست.")
            return
        query = select(File).where(File.user_id == user.id, File.folder_id.is_(None))
        if selected_types:
            query = query.where(File.file_type.in_(selected_types))
        files = (await db.execute(query)).scalars().all()
    files = [item for _, item in sort_library_items([("file", file) for file in files], telegram_id)]
    page = min(max(page, 0), max(0, (len(files) - 1) // PAGE_SIZE))
    shown = files[page * PAGE_SIZE:(page + 1) * PAGE_SIZE]
    buttons = [[file_list_button(file, telegram_id)] for file in shown]
    if len(files) > PAGE_SIZE:
        buttons.append(pagination_row("rootfiles", page, len(files)))
    buttons.extend(list_action_rows(telegram_id, f"rootfiles:{page}"))
    if telegram_id not in batch_return_targets:
        buttons.extend([
            [InlineKeyboardButton("☑️ فیلتر نوع", callback_data="library_filter:rootfiles")],
            [InlineKeyboardButton("↩️ کشوهای کمد", callback_data="folders:0:0"), InlineKeyboardButton("🚪 منوی اصلی", callback_data="home")],
        ])
    text = f"📦 **فایل‌های بیرون از کشو**\n{to_persian_digits(str(len(files)))} مورد"
    if selected_types:
        text += "\n☑️ نوع‌ها: " + "، ".join(TYPE_LABELS[item] for item in sorted(selected_types))
    if not files:
        text += "\n\nفایلی با این فیلتر پیدا نشد."
    await safe_edit(message, text, reply_markup=InlineKeyboardMarkup(buttons))


async def render_recent_files(message: Message, telegram_id: int, page: int = 0) -> None:
    await set_current_drawer(telegram_id, None)
    detail_back_targets[telegram_id] = f"files:{page}"
    selected_types = library_filters.get(telegram_id, set())
    async with async_session() as db:
        user = (await db.execute(select(User).where(User.telegram_id == telegram_id))).scalar_one_or_none()
        if not user:
            await message.edit("برای شروع، دستور /start رو بفرست.")
            return
        query = select(File).where(File.user_id == user.id)
        if selected_types:
            query = query.where(File.file_type.in_(selected_types))
        files = (await db.execute(query)).scalars().all()
    files = [item for _, item in sort_library_items([("file", file) for file in files], telegram_id)]
    page = min(max(page, 0), max(0, (len(files) - 1) // PAGE_SIZE))
    shown = files[page * PAGE_SIZE:(page + 1) * PAGE_SIZE]
    buttons = [[file_list_button(file, telegram_id)] for file in shown]
    if len(files) > PAGE_SIZE:
        buttons.append(pagination_row("files", page, len(files)))
    buttons.extend(list_action_rows(telegram_id, f"files:{page}"))
    if telegram_id not in batch_return_targets:
        buttons.extend([[InlineKeyboardButton("🔍 جست‌وجو", callback_data="search_choose"), InlineKeyboardButton("☑️ فیلتر نوع", callback_data="library_filter:files")], [InlineKeyboardButton("🗄️ کشوهای من", callback_data="folders:0:0"), InlineKeyboardButton("🚪 منوی اصلی", callback_data="home")]])
    text = "📦 **همه‌ی فایل‌های کمد**"
    if selected_types:
        text += "\n☑️ نوع‌ها: " + "، ".join(TYPE_LABELS[item] for item in sorted(selected_types))
    if not files:
        text += "\n\nهنوز چیزی ذخیره نکردی؛ یه فایل، عکس یا متن برام بفرست."
    await message.edit(text, reply_markup=InlineKeyboardMarkup(buttons))


def type_filter_keyboard(selected: set[str], context: str, include_folder: bool = False) -> InlineKeyboardMarkup:
    types = ["video", "audio", "image", "text", "document"] + (["folder"] if include_folder else [])
    buttons = []
    for index in range(0, len(types), 3):
        row = []
        for item in types[index:index + 3]:
            icon = "🗃️" if item == "folder" else FILE_ICONS[item]
            mark = "✅ " if item in selected else ""
            row.append(InlineKeyboardButton(f"{mark}{icon} {TYPE_LABELS[item]}", callback_data=f"{context}_filter_toggle:{item}"))
        buttons.append(row)
    buttons.append([InlineKeyboardButton("🧹 پاک‌کردن انتخاب‌ها", callback_data=f"{context}_filter_clear"), InlineKeyboardButton("✅ همهٔ موارد", callback_data=f"{context}_filter_all")])
    apply_label = "➡️ ادامه" if context == "search" else "💾 اعمال فیلتر"
    buttons.append([InlineKeyboardButton("↩️ انصراف", callback_data=f"{context}_filter_cancel"), InlineKeyboardButton(apply_label, callback_data=f"{context}_filter_apply")])
    return InlineKeyboardMarkup(buttons)


def search_type_keyboard(telegram_id: int | None = None) -> InlineKeyboardMarkup:
    selected = search_filters.get(telegram_id, set()) if telegram_id is not None else set()
    return type_filter_keyboard(selected, "search", include_folder=True)


async def render_search_results(message: Message, telegram_id: int, page: int = 0) -> None:
    await set_current_drawer(telegram_id, None)
    query = search_queries.get(telegram_id, "").strip()
    selected_types = search_filters.get(telegram_id, set())
    file_types = selected_types.intersection(FILE_ICONS)
    include_files = not selected_types or bool(file_types)
    include_folders = not selected_types or "folder" in selected_types
    if not query:
        await message.edit("عبارت جست‌وجو در دسترس نیست؛ دوباره جست‌وجو کن.", reply_markup=main_menu_keyboard(telegram_id))
        return
    async with async_session() as db:
        user = (await db.execute(select(User).where(User.telegram_id == telegram_id))).scalar_one_or_none()
        pattern = f"%{escape_like(query)}%"
        file_conditions = [File.user_id == user.id, or_(File.file_name.ilike(pattern, escape="\\"), File.description.ilike(pattern, escape="\\"))] if user else []
        if file_types:
            file_conditions.append(File.file_type.in_(file_types))
        files = (await db.execute(select(File).where(*file_conditions).order_by(File.created_at.desc()))).scalars().all() if user and include_files else []
        folders = (await db.execute(select(Folder).where(
            Folder.user_id == user.id,
            or_(Folder.name.ilike(pattern, escape="\\"), Folder.description.ilike(pattern, escape="\\")),
        ).order_by(Folder.name))).scalars().all() if user and include_folders else []
    items = sort_library_items([("folder", folder) for folder in folders] + [("file", file) for file in files], telegram_id)
    page = min(max(page, 0), max(0, (len(items) - 1) // PAGE_SIZE))
    detail_back_targets[telegram_id] = f"search:{page}"
    shown = items[page * PAGE_SIZE:(page + 1) * PAGE_SIZE]
    buttons = []
    for kind, item in shown:
        if kind == "folder":
            buttons.append([InlineKeyboardButton(f"🗃️ {item.name[:40]}", callback_data=f"folder:{item.id}:0")])
        else:
            buttons.append([file_list_button(item, telegram_id)])
    if len(items) > PAGE_SIZE:
        buttons.append(pagination_row("search", page, len(items)))
    buttons.extend(list_action_rows(telegram_id, f"search:{page}"))
    if telegram_id not in batch_return_targets:
        buttons.extend([
            [InlineKeyboardButton("🔍 عبارت تازه", callback_data="search_again"), InlineKeyboardButton("☑️ تغییر نوع‌ها", callback_data="search_refine")],
            [InlineKeyboardButton("🚪 منوی اصلی", callback_data="home")],
        ])
    selected_label = "همهٔ موارد" if not selected_types else "، ".join(TYPE_LABELS[item] for item in sorted(selected_types))
    text = f"🔍 **نتایج «{escape_markdown(query)}»**\nنوع‌ها: {selected_label} · {to_persian_digits(str(len(items)))} مورد"
    if not items:
        text += "\n\nکمد رو گشتم ولی چیزی پیدا نکردم! عبارتت یا دسته‌بندی رو تغییر بده 🌱"
    await message.edit(text, reply_markup=InlineKeyboardMarkup(buttons))


async def render_list_target(message: Message, telegram_id: int, target: str) -> None:
    if target.startswith("files:"):
        await render_recent_files(message, telegram_id, int(target.split(":")[1]))
    elif target.startswith("rootfiles:"):
        await render_root_files(message, telegram_id, int(target.split(":")[1]))
    elif target.startswith("folders:"):
        _, parent, page = target.split(":")
        await render_folder_page(message, telegram_id, int(parent) or None, int(page))
    elif target.startswith("search:"):
        await render_search_results(message, telegram_id, int(target.split(":")[1]))
    else:
        await render_recent_files(message, telegram_id)


def file_detail_text(file: File) -> str:
    text = f"{FILE_ICONS.get(file.file_type, '📎')} **{display_filename(file.file_name)}**\n📦 حجم: {format_size(file.file_size)}"
    if file.duration:
        text += f"\n⏱ مدت: {format_duration(file.duration)}"
    text += f"\n📅 آپلود: {format_jalali(file.created_at)}"
    text += f"\n🕰 آخرین تغییر: {format_jalali(file.updated_at)}"
    if file.description:
        text += f"\n\n📝 **توضیحات:**\n{escape_markdown(truncate_description(file.description))}"
    return text


def file_detail_keyboard(file: File, back_callback: str = "files:0") -> InlineKeyboardMarkup:
    share_button = InlineKeyboardButton(
        "🔒 لغو لینک عمومی" if file.public_hash else "🔗 ساخت لینک عمومی",
        callback_data=f"unsharefile:{file.id}" if file.public_hash else f"sharefile:{file.id}",
    )
    description_row = [InlineKeyboardButton(
        "✏️ ویرایش توضیحات" if file.description else "📝 افزودن توضیحات",
        callback_data=f"filedesc:{file.id}",
    )]
    if file.description:
        description_row.append(InlineKeyboardButton("🧹 حذف توضیحات", callback_data=f"clearfiledesc:{file.id}"))
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("👁 نمایش در تلگرام", callback_data=f"preview:{file.id}")],
        *([[InlineKeyboardButton("🎧 افزودن به پلی‌لیست", callback_data=f"fileplaylist:{file.id}:0")]] if file.file_type in ("audio", "video") else []),
        [InlineKeyboardButton("✏️ تغییر نام", callback_data=f"renamefile:{file.id}"),
         InlineKeyboardButton("🗃️ انتقال", callback_data=f"move:{file.id}")],
        description_row,
        [share_button],
        [InlineKeyboardButton("🗑️ حذف", callback_data=f"delfile:{file.id}"),
         InlineKeyboardButton("↩️ نتایج جست‌وجو" if back_callback.startswith("search:") else "↩️ بازگشت", callback_data=back_callback)],
        [InlineKeyboardButton("🚪 منوی اصلی", callback_data="home")],
    ])


def file_detail_keyboard_for_user(file: File, telegram_id: int) -> InlineKeyboardMarkup:
    return file_detail_keyboard(file, detail_back_targets.get(telegram_id, "files:0"))


HELP_TEXT = (
    "💡 **راهنمای کمد 🗄️**\n\n"
    "📥 فیلم، آهنگ، عکس، سند یا متن رو بفرست تا برات نگه دارم.\n"
    "📝 کپشن هر فایل هم به‌عنوان توضیحاتش ذخیره می‌شه و بعداً می‌تونی تغییرش بدی.\n"
    "🔍 برای پیدا کردن فایل‌ها، هم عبارت جست‌وجو داری هم انتخاب چند نوع محتوا.\n"
    "🎧 آهنگ‌ها و ویدیوها رو داخل پلی‌لیست بچین و پشت‌سرهم پخش کن.\n"
    "🗃️ کشوها می‌تونن چندلایه باشن و هر کدوم اسم و توضیحات خودشون رو داشته باشن.\n\n"
    "روی هر فایل یا کشو بزن تا گزینه‌های دیدن، ویرایش، انتقال، اشتراک و حذف رو ببینی ✨"
)


def main_menu_keyboard(telegram_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("🗄️ کشوهای من", callback_data="folders:0:0", style=enums.ButtonStyle.PRIMARY),
         InlineKeyboardButton("📦 همه‌ی فایل‌ها", callback_data="files:0", style=enums.ButtonStyle.PRIMARY)],
        [InlineKeyboardButton("➕ کشوی تازه", callback_data="create_folder", style=enums.ButtonStyle.SUCCESS),
         InlineKeyboardButton("🔍 بگرد تو کمد", callback_data="search_choose", style=enums.ButtonStyle.PRIMARY)],
        [InlineKeyboardButton("🎧 پلی‌لیست‌های من", callback_data="playlists:0", style=enums.ButtonStyle.PRIMARY)],
        [get_web_app_button(telegram_id, "✨ باز کردن نسخهٔ وب")],
        [InlineKeyboardButton("💡 راهنمای کمد", callback_data="show_help")],
    ])


def help_keyboard(telegram_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [get_web_app_button(telegram_id, "✨ ورود به نسخهٔ وب")],
        [InlineKeyboardButton("🚪 بازگشت به منوی اصلی", callback_data="home")],
    ])


def recent_files_view(files: list[File], telegram_id: int) -> tuple[str, InlineKeyboardMarkup]:
    if not files:
        return "📭 کمد هنوز خالیه؛ یه فایل، عکس یا پیام متنی بفرست.", main_menu_keyboard(telegram_id)
    icons = {"video": "🎬", "audio": "🎵", "document": "📄", "image": "🖼", "text": "📝"}
    buttons = [
        [InlineKeyboardButton(f"{icons.get(file.file_type, '📎')} \u200e{file.file_name[:36]}\u200e", callback_data=f"openfile:{file.id}")]
        for file in files
    ]
    buttons.append([InlineKeyboardButton("🗄️ کشوها", callback_data="back_folders"),
                    get_web_app_button(telegram_id, "🌐 نسخهٔ وب")])
    return "📁 **موارد اخیر**\nبرای دیدن جزئیات و مدیریتش، روی هر مورد بزن.", InlineKeyboardMarkup(buttons)


async def render_playlists(message: Message, telegram_id: int, page: int = 0) -> None:
    await set_current_drawer(telegram_id, None)
    async with async_session() as db:
        user = (await db.execute(select(User).where(User.telegram_id == telegram_id))).scalar_one_or_none()
        playlists = (await db.execute(
            select(Playlist)
            .where(Playlist.user_id == user.id)
            .options(selectinload(Playlist.items))
            .order_by(Playlist.updated_at.desc(), Playlist.id.desc())
        )).scalars().unique().all() if user else []
    page = min(max(page, 0), max(0, (len(playlists) - 1) // PAGE_SIZE))
    shown = playlists[page * PAGE_SIZE:(page + 1) * PAGE_SIZE]
    buttons = [[InlineKeyboardButton(
        f"🎧 {playlist.name[:32]} · {to_persian_digits(str(len(playlist.items)))} مورد",
        callback_data=f"playlist:{playlist.id}:0",
    )] for playlist in shown]
    if len(playlists) > PAGE_SIZE:
        buttons.append(pagination_row("playlists", page, len(playlists)))
    buttons.extend([
        [InlineKeyboardButton("➕ پلی‌لیست تازه", callback_data="playlist_new", style=enums.ButtonStyle.SUCCESS)],
        [InlineKeyboardButton("🚪 منوی اصلی", callback_data="home")],
    ])
    text = "🎧 **پلی‌لیست‌های کمد**\n\nآهنگ‌ها و ویدیوها رو با ترتیب دلخواهت کنار هم بچین و پشت‌سرهم پخش کن."
    if not playlists:
        text += "\n\nهنوز پلی‌لیستی نساختی؛ اولین پلی‌لیستت رو بساز ✨"
    await safe_edit(message, text, reply_markup=InlineKeyboardMarkup(buttons))


async def render_playlist_detail(message: Message, telegram_id: int, playlist_id: int, page: int = 0) -> None:
    async with async_session() as db:
        playlist = (await db.execute(owned_playlist(playlist_id, telegram_id))).scalar_one_or_none()
    if playlist is None:
        await message.edit("این پلی‌لیست پیدا نشد.", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("↩️ پلی‌لیست‌ها", callback_data="playlists:0")]]))
        return
    items = sorted(playlist.items, key=lambda item: (item.position, item.id))
    page_size = PAGE_SIZE
    page = min(max(page, 0), max(0, (len(items) - 1) // page_size))
    shown = items[page * page_size:(page + 1) * page_size]
    buttons = [[InlineKeyboardButton(
        f"{FILE_ICONS.get(item.file.file_type, '🎵')} {to_persian_digits(str(page * page_size + index + 1))}. \u200e{item.file.file_name[:30]}\u200e",
        callback_data=f"plitem:{playlist.id}:{item.file.id}:{page}",
    )] for index, item in enumerate(shown)]
    if len(items) > page_size:
        buttons.append(pagination_row(f"playlist:{playlist.id}", page, len(items)))
    buttons.extend([
        [InlineKeyboardButton("▶️ پخش همه (از اول)", callback_data=f"plplay:{playlist.id}:0", style=enums.ButtonStyle.SUCCESS)],
        [InlineKeyboardButton("🔀 پخش شافل", callback_data=f"plshuffle:{playlist.id}", style=enums.ButtonStyle.PRIMARY), InlineKeyboardButton("➕ افزودن فایل", callback_data=f"pladd:{playlist.id}:0", style=enums.ButtonStyle.SUCCESS)],
        [InlineKeyboardButton("⚙️ تنظیمات نام و توضیح", callback_data=f"plsettings:{playlist.id}"), InlineKeyboardButton("🗑️ حذف پلی‌لیست", callback_data=f"pldelete:{playlist.id}", style=enums.ButtonStyle.DANGER)],
        [InlineKeyboardButton("↩️ لیست پلی‌لیست‌ها", callback_data="playlists:0"), InlineKeyboardButton("🚪 منوی اصلی", callback_data="home")],
    ])
    total_duration = sum(item.file.duration or 0 for item in items)
    text = f"🎼 **{escape_markdown(playlist.name)}**\n{to_persian_digits(str(len(items)))} مورد"
    if total_duration:
        text += f" · {format_duration(total_duration)}"
    if playlist.description:
        text += f"\n\n📝 {escape_markdown(truncate_description(playlist.description, 350))}"
    if not items:
        text += "\n\nاین پلی‌لیست هنوز خالیه؛ چند آهنگ یا ویدیو بهش اضافه کن."
    await safe_edit(message, text, reply_markup=InlineKeyboardMarkup(buttons))


async def send_playlist_media(client, callback: CallbackQuery, playlist_id: int, index: int) -> None:
    async with async_session() as db:
        playlist = (await db.execute(owned_playlist(playlist_id, callback.from_user.id))).scalar_one_or_none()
    if playlist is None or not playlist.items:
        await callback.answer("پلی‌لیست خالیه یا پیدا نشد.", show_alert=True)
        return
    items = sorted(playlist.items, key=lambda item: (item.position, item.id))
    index %= len(items)
    item = items[index]
    previous_index = (index - 1) % len(items)
    next_index = (index + 1) % len(items)
    keyboard = InlineKeyboardMarkup([
        [InlineKeyboardButton("⏭️ بعدی", callback_data=f"plplay:{playlist_id}:{next_index}"),
         InlineKeyboardButton(f"{to_persian_digits(str(index + 1))}/{to_persian_digits(str(len(items)))}", callback_data="noop"),
         InlineKeyboardButton("⏮️ قبلی", callback_data=f"plplay:{playlist_id}:{previous_index}")],
        [InlineKeyboardButton("↩️ برگشت به پلی‌لیست", callback_data=f"plback:{playlist_id}:{index // PAGE_SIZE}"),
         InlineKeyboardButton("✖️ بستن پیام", callback_data="plclose")],
    ])
    try:
        preview = await client.copy_message(callback.message.chat.id, settings.telegram_storage_channel_id, item.file.channel_message_id)
        await safe_edit_reply_markup(preview, keyboard)
        asyncio.create_task(delete_preview_later(client, preview.chat.id, preview.id))
        if callback.message.video or callback.message.audio or callback.message.document:
            await safe_delete(callback.message)
        await callback.answer(f"در حال پخش: {item.file.file_name[:40]}")
    except Exception as error:
        logger.exception("Could not preview playlist item %s: %s", item.file.id, error)
        await callback.answer("پخش این مورد در تلگرام ممکن نشد.", show_alert=True)

# ============== Authorization Middleware ==============

@tg_client.on_message(filters.private, group=-2)
async def check_auth(client, message: Message):
    """Check if the user is authorized to use the bot."""
    auth_users = settings.auth_users
    if not auth_users:
        # Open to everyone
        return
    
    if message.from_user.id not in auth_users:
        # Ignore if it's a command we don't want to reply to (to avoid spamming unauthorized users)
        # But for /start, we should give a polite rejection
        if message.text and message.text.startswith("/start"):
            await message.reply(
                "🚫 **دسترسی محدوده**\n\n"
                "این ربات فقط برای کاربرهای مجاز فعاله.\n"
                f"شناسهٔ تلگرام شما: `{message.from_user.id}`"
            )
        
        # Stop further processing of this message
        message.stop_propagation()

# ============== Command Handlers ==============

@tg_client.on_message(filters.command("start") & filters.private)
async def start_command(client, message: Message):
    """Welcome message and bot instructions. Also handles deep-linked login codes."""
    await get_or_create_user(
        message.from_user.id,
        message.from_user.username,
        message.from_user.first_name,
        message.from_user.last_name,
    )
    await load_user_ui_state(message.from_user.id)
    await set_current_drawer(message.from_user.id, None)
    
    # Check for deep-linked login codes (e.g. /start ABCDEF)
    if len(message.command) > 1:
        code_input = message.command[1].strip().upper()
        async with async_session() as db:
            result = await db.execute(select(LoginCode).where(LoginCode.code == code_input))
            login_code = result.scalar_one_or_none()
            
            if login_code:
                if login_code.expires_at > datetime.utcnow() and not login_code.telegram_id:
                    # Claim the code
                    login_code.telegram_id = message.from_user.id
                    await db.commit()
                    
                    await message.reply(
                        "✅ ورود دستگاه شما تأیید شد."
                    )
                    return
                elif login_code.telegram_id:
                     await message.reply("⚠️ این کد قبلاً استفاده شده.")
                     return
                else:
                     await message.reply("❌ اعتبار این کد تموم شده.")
                     return

    await message.reply(
        f"👋 **سلام {message.from_user.first_name or 'رفیق'} عزیز! به کمدت خوش اومدی 🗄️**\n\n"
        "اینجا می‌تونی 🎬 فیلم، 🎵 آهنگ، 🖼 عکس، 📄 سند و 📝 متن‌هات رو یک‌جا نگه داری. "
        "هرچی بفرستی برات ذخیره می‌کنم و کپشنش هم به‌عنوان توضیحات کنار فایل می‌مونه 😉\n\n"
        "آماده‌ای کمدتو بچینیم؟ از یکی از گزینه‌های پایین شروع کن 👇",
        reply_markup=main_menu_keyboard(message.from_user.id),
    )


@tg_client.on_message(filters.command("help") & filters.private)
async def help_command(client, message: Message):
    """Show help message."""
    await load_user_ui_state(message.from_user.id)
    await set_current_drawer(message.from_user.id, None)
    await message.reply(HELP_TEXT, reply_markup=help_keyboard(message.from_user.id))


@tg_client.on_message(filters.command("myfiles") & filters.private)
async def myfiles_command(client, message: Message):
    """List user's recent files."""
    panel = await message.reply("در حال آماده‌سازی فایل‌ها…")
    await render_recent_files(panel, message.from_user.id)


@tg_client.on_message(filters.command("folders") & filters.private)
async def folders_command(client, message: Message):
    """Show folder structure."""
    panel = await message.reply("در حال آماده‌سازی کمد…")
    await render_folder_page(panel, message.from_user.id)


@tg_client.on_message(filters.command("playlists") & filters.private)
async def playlists_command(client, message: Message):
    """Browse and manage audio/video playlists."""
    panel = await message.reply("در حال آماده‌سازی پلی‌لیست‌ها…")
    await render_playlists(panel, message.from_user.id)


@tg_client.on_message(filters.command("newfolder") & filters.private)
async def newfolder_command(client, message: Message):
    """Create a new folder."""
    if len(message.command) < 2:
        await message.reply("اسم کشو رو بعد از دستور بنویس؛ نمونه: `/newfolder فیلم‌ها`.")
        return
    
    folder_name = " ".join(message.command[1:]).strip()
    if not folder_name or len(folder_name) > 255:
        await message.reply("اسم کشو باید بین ۱ تا ۲۵۵ نویسه باشه.")
        return
    
    async with async_session() as db:
        # Get user
        user_result = await db.execute(
            select(User).where(User.telegram_id == message.from_user.id)
        )
        user = user_result.scalar_one_or_none()
        
        if not user:
            await message.reply("برای شروع، دستور /start رو بفرست.")
            return
        
        # Check if folder exists
        existing = await db.execute(
            select(Folder).where(
                Folder.user_id == user.id,
                Folder.name == folder_name,
                Folder.parent_id.is_(None)
            )
        )
        if existing.scalar_one_or_none():
            await message.reply(f"❌ یه کشو با اسم «{folder_name}» همین‌جا داری.")
            return
        
        # Create folder
        folder = Folder(user_id=user.id, name=folder_name)
        db.add(folder)
        await db.commit()
    
    await message.reply(
        f"✅ کشوی «{folder_name}» ساخته شد.",
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("🗃️ باز کردن کشو", callback_data=f"folder:{folder.id}:0")],
            [InlineKeyboardButton("↩️ بازگشت به کشوهای کمد", callback_data="folders:0:0")],
        ]),
    )


@tg_client.on_message(filters.command("search") & filters.private)
async def search_command(client, message: Message):
    """Search file names and descriptions."""
    query = " ".join(message.command[1:]).strip()
    if not query:
        await message.reply("🔎 عبارت رو بعد از دستور بنویس؛ نمونه: `/search سفر`.")
        return
    await load_user_ui_state(message.from_user.id)
    search_queries[message.from_user.id] = query[:100]
    search_filters[message.from_user.id] = set()
    current_drawers[message.from_user.id] = None
    await persist_user_ui_state(message.from_user.id)
    panel = await message.reply("در حال جست‌وجو…")
    await render_search_results(panel, message.from_user.id)


@tg_client.on_message(filters.command("web") & filters.private)
async def web_command(client, message: Message):
    """Get authenticated web interface link."""
    if not settings.web_base_url.startswith("https://"):
        await message.reply(local_web_instructions())
        return
    user = await get_or_create_user(
        message.from_user.id,
        message.from_user.username,
        message.from_user.first_name,
        message.from_user.last_name,
    )
    
    token = create_access_token(message.from_user.id)
    web_url = f"{settings.web_base_url}/auth?token={token}"
    
    await message.reply(
        "🌐 **نسخهٔ وب کمد**\n\n"
        "با دکمهٔ زیر بازش کن یا لینک رو توی مرورگرت باز کن. این لینک رو برای کسی نفرست.\n"
        f"{web_url}",
        reply_markup=InlineKeyboardMarkup([[get_web_app_button(message.from_user.id, "🌐 باز کردن نسخهٔ وب")]])
    )


@tg_client.on_message(filters.command("login") & filters.private)
async def login_command(client, message: Message):
    """
    Handle login command.
    Usage:
    /login <CODE> - Link TV/Web session
    /login - Generate code to enter on device
    """
    await get_or_create_user(
        message.from_user.id,
        message.from_user.username,
        message.from_user.first_name,
        message.from_user.last_name,
    )

    # Check if code is provided (TV/Web -> User flow)
    if len(message.command) > 1:
        code_input = message.command[1].strip().upper()
        
        async with async_session() as db:
            result = await db.execute(select(LoginCode).where(LoginCode.code == code_input))
            login_code = result.scalar_one_or_none()
            
            if not login_code:
                await message.reply("❌ کد معتبر نیست؛ کد روی دستگاه رو دوباره بررسی کن.")
                return
            
            if login_code.expires_at < datetime.utcnow():
                await message.reply("❌ اعتبار کد تموم شده؛ یه کد تازه بساز.")
                return
                
            if login_code.telegram_id:
                await message.reply("❌ این کد قبلاً استفاده شده.")
                return

            # Claim the code
            login_code.telegram_id = message.from_user.id
            await db.commit()
            
            await message.reply(
                "✅ ورود دستگاه شما تأیید شد."
            )
        return

    # Use secrets for cryptographically strong random number generation
    alphabet = string.ascii_uppercase + string.digits
    code = ''.join(secrets.choice(alphabet) for _ in range(6))
    
    async with async_session() as db:
        # Save code
        login_code = LoginCode(
            code=code,
            telegram_id=message.from_user.id,
            expires_at=datetime.utcnow() + timedelta(minutes=5)
        )
        db.add(login_code)
        await db.commit()
    
    await message.reply(
        "🔑 **کد ورود شما:**\n\n"
        f"`{code}`\n\n"
        "این کد رو توی صفحهٔ ورود وارد کن. اعتبارش ۵ دقیقه‌ست."
    )

    return

@tg_client.on_message(filters.command("logout_all") & filters.private)
async def logout_all_command(client, message: Message):
    """
    Invalidate all active sessions for the current user.
    """
    await get_or_create_user(
        message.from_user.id,
        message.from_user.username,
        message.from_user.first_name,
        message.from_user.last_name,
    )
    
    await message.reply(
        "⚠️ از همهٔ دستگاه‌ها خارج بشی؟\nنشست نسخهٔ وب و دستگاه‌های متصل باطل می‌شه.",
        reply_markup=InlineKeyboardMarkup([
            [
                InlineKeyboardButton("✅ خروج از همه", callback_data="logout_all_confirm"),
                InlineKeyboardButton("✖️ انصراف", callback_data="logout_all_cancel")
            ]
        ])
    )

# ============== File Handler ==============

@tg_client.on_message(filters.private & (filters.video | filters.audio | filters.document | filters.photo))
async def handle_file(client, message: Message):
    """Handle uploaded files - forward to channel and save to DB."""
    # Get or create user
    user = await get_or_create_user(
        message.from_user.id,
        message.from_user.username,
        message.from_user.first_name,
        message.from_user.last_name,
    )
    active_drawer_id = await get_active_drawer_id(message.from_user.id)
    
    # Determine file type and extract metadata
    if message.video:
        media = message.video
        file_type = "video"
    elif message.audio:
        media = message.audio
        file_type = "audio"
    elif message.document:
        media = message.document
        file_type = "image" if (media.mime_type or "").startswith("image/") else "document"
    elif message.photo:
        media = message.photo.sizes[-1]
        file_type = "image"
    else:
        return
    
    status_msg = await message.reply("📥 در حال ذخیره‌سازی...")
    
    try:
        # Forward to storage channel
        forwarded = await forward_to_storage_channel(message)
        stored_media = forwarded.video or forwarded.audio or forwarded.document
        if forwarded.photo:
            stored_media = forwarded.photo.sizes[-1]
        if stored_media is not None:
            media = stored_media
        
        # Extract file info
        raw_filename = getattr(media, "file_name", None) or (f"photo_{message.id}.jpg" if message.photo else f"{file_type}_{message.id}")
        file_info = {
            "file_id": media.file_id,
            "file_unique_id": media.file_unique_id,
            "file_name": sanitize_filename(raw_filename),
            "file_size": media.file_size,
            "mime_type": getattr(media, "mime_type", None) or ("image/jpeg" if message.photo else None),
            "duration": getattr(media, "duration", None),
            "width": getattr(media, "width", None),
            "height": getattr(media, "height", None),
            "thumbnail_file_id": media.file_id if message.photo else (media.thumbs[0].file_id if getattr(media, "thumbs", None) else None),
            "description": message.caption.strip()[:1024] if message.caption else None,
        }
        
        # Save to database
        async with async_session() as db:
            file = File(
                user_id=user.id,
                folder_id=active_drawer_id,
                channel_message_id=forwarded.id,
                file_type=file_type,
                **file_info
            )
            db.add(file)
            await db.commit()
            await db.refresh(file)
        
        # Build response
        emoji = {"video": "🎬", "audio": "🎵", "document": "📄", "image": "🖼"}.get(file_type, "📎")
        
        response = (
            f"✅ **ذخیره شد**\n\n"
            f"{emoji} **{display_filename(file_info['file_name'])}**\n"
            f"📦 {format_size(file_info['file_size'])}\n"
        )
        
        if file_info['duration']:
            response += f"⏱ {format_duration(file_info['duration'])}\n"
        response += "\nبا دکمه‌های پایین فایل رو مدیریت کن."
        
        if file.description:
            response += f"\n📝 {escape_markdown(file.description[:250])}"
        if active_drawer_id:
            async with async_session() as db:
                drawer = await db.get(Folder, active_drawer_id)
            if drawer:
                response += f"\n🗃️ در کشوی «{escape_markdown(drawer.name)}» ذخیره شد."
        detail_back_targets[message.from_user.id] = "files:0"
        await status_msg.edit(response, reply_markup=file_detail_keyboard(file))
        asyncio.create_task(delete_preview_later(client, status_msg.chat.id, status_msg.id, 30))
        
    except Exception as e:
        logger.exception("Telegram upload failed for user %s: %s", message.from_user.id, e)
        await status_msg.edit("❌ فایل ذخیره نشد؛ دوباره تلاش کن.")


@tg_client.on_message(filters.private & filters.text & ~filters.regex(r"^/"))
async def handle_text_note(client, message: Message):
    """Save ordinary text messages as notes in the same library."""
    if message.chat.id in pending_input_chats:
        return
    content = message.text
    if not content.strip():
        return
    user = await get_or_create_user(
        message.from_user.id, message.from_user.username,
        message.from_user.first_name, message.from_user.last_name,
    )
    active_drawer_id = await get_active_drawer_id(message.from_user.id)
    try:
        stored = await forward_to_storage_channel(message)
        title = sanitize_filename(content.strip().splitlines()[0][:80])
        async with async_session() as db:
            note = File(
                user_id=user.id, folder_id=active_drawer_id, channel_message_id=stored.id,
                file_id=f"text:{stored.id}", file_unique_id=f"text:{stored.id}",
                file_name=title, file_size=len(content.encode("utf-8")),
                mime_type="text/plain; charset=utf-8", file_type="text",
            )
            db.add(note)
            await db.commit()
            await db.refresh(note)
        detail_back_targets[message.from_user.id] = "files:0"
        management_message = await message.reply(
            f"📝 در کمد ذخیره شد: {title}",
            reply_markup=file_detail_keyboard(note),
        )
        asyncio.create_task(delete_preview_later(client, management_message.chat.id, management_message.id, 30))
    except Exception as error:
        logger.exception("Telegram text upload failed for user %s: %s", message.from_user.id, error)
        await message.reply("❌ متن ذخیره نشد؛ دوباره تلاش کن.")


# ============== Callback Query Handlers ==============

@tg_client.on_callback_query()
async def handle_callback(client, callback: CallbackQuery):
    """Handle inline button callbacks."""
    if settings.auth_users and callback.from_user.id not in settings.auth_users:
        await callback.answer("اجازهٔ استفاده از این ربات رو نداری.", show_alert=True)
        return
    await load_user_ui_state(callback.from_user.id)
    data = callback.data

    if data.startswith("input_action:"):
        action = data.split(":", 1)[1]
        queue = input_action_queues.get(callback.message.chat.id)
        if queue is None:
            await callback.answer("این عملیات دیگه فعال نیست.", show_alert=True)
            return
        if queue.empty():
            queue.put_nowait(action)
        await callback.answer("عملیات لغو شد." if action == "cancel" else "توضیحات پاک می‌شه.")

    elif data == "noop":
        await callback.answer()

    elif data.startswith("playlists:"):
        await render_playlists(callback.message, callback.from_user.id, int(data.split(":")[1]))
        await callback.answer()

    elif data.startswith("playlist:"):
        _, playlist_id, page = data.split(":")
        await render_playlist_detail(callback.message, callback.from_user.id, int(playlist_id), int(page))
        await callback.answer()

    elif data == "playlist_new":
        pending_input_chats.add(callback.message.chat.id)
        prompt = await callback.message.reply(
            "🎼 اسم پلی‌لیست تازه رو بفرست.",
            reply_markup=input_keyboard(),
        )
        await callback.answer()
        reply = None
        try:
            reply, action = await wait_for_input(client, callback.message.chat.id)
            if action == "cancel" or reply is None or not reply.text:
                await callback.message.edit("ساخت پلی‌لیست لغو شد.", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("↩️ پلی‌لیست‌ها", callback_data="playlists:0")]]))
                return
            name = reply.text.strip()[:255]
            if not name:
                await callback.answer("اسم پلی‌لیست نمی‌تونه خالی باشه.", show_alert=True)
                return
            async with async_session() as db:
                user = (await db.execute(select(User).where(User.telegram_id == callback.from_user.id))).scalar_one()
                duplicate = (await db.execute(select(Playlist.id).where(Playlist.user_id == user.id, func.lower(Playlist.name) == name.lower()))).scalar_one_or_none()
                if duplicate:
                    await callback.message.edit("یه پلی‌لیست با این اسم داری.", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("↩️ پلی‌لیست‌ها", callback_data="playlists:0")]]))
                    return
                playlist = Playlist(user_id=user.id, name=name)
                db.add(playlist)
                try:
                    await db.commit()
                except IntegrityError:
                    await db.rollback()
                    await safe_edit(
                        callback.message,
                        "یه پلی‌لیست با این اسم داری.",
                        reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("↩️ پلی‌لیست‌ها", callback_data="playlists:0")]]),
                    )
                    return
                await db.refresh(playlist)
            await render_playlist_detail(callback.message, callback.from_user.id, playlist.id)
        finally:
            pending_input_chats.discard(callback.message.chat.id)
            await safe_delete(prompt)
            await safe_delete(reply)

    elif data.startswith("plsettings:") or data.startswith("pledit:"):
        playlist_id = int(data.split(":")[1])
        async with async_session() as db:
            playlist = (await db.execute(owned_playlist(playlist_id, callback.from_user.id))).scalar_one_or_none()
        if playlist is None:
            await callback.answer("پلی‌لیست پیدا نشد.", show_alert=True)
            return
        await callback.message.edit(
            f"⚙️ **تنظیمات پلی‌لیست {escape_markdown(playlist.name)}**",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("✏️ تغییر نام", callback_data=f"plrename:{playlist_id}"),
                 InlineKeyboardButton("📝 ویرایش توضیحات", callback_data=f"pldesc:{playlist_id}")],
                *([[InlineKeyboardButton("🧹 پاک‌کردن توضیحات", callback_data=f"plcleardesc:{playlist_id}")]] if playlist.description else []),
                [InlineKeyboardButton("↩️ برگشت به پلی‌لیست", callback_data=f"playlist:{playlist_id}:0")],
            ]),
        )
        await callback.answer()

    elif data.startswith("plrename:"):
        playlist_id = int(data.split(":")[1])
        pending_input_chats.add(callback.message.chat.id)
        prompt = await callback.message.reply("✏️ اسم جدید پلی‌لیست رو بفرست.", reply_markup=input_keyboard())
        reply = None
        try:
            reply, action = await wait_for_input(client, callback.message.chat.id)
            if action == "cancel" or reply is None or not reply.text:
                await render_playlist_detail(callback.message, callback.from_user.id, playlist_id)
                return
            name = reply.text.strip()[:255]
            if not name:
                return
            async with async_session() as db:
                playlist = (await db.execute(owned_playlist(playlist_id, callback.from_user.id))).scalar_one()
                playlist.name = name
                await db.commit()
            await render_playlist_detail(callback.message, callback.from_user.id, playlist_id)
        finally:
            pending_input_chats.discard(callback.message.chat.id)
            await safe_delete(prompt)
            await safe_delete(reply)

    elif data.startswith("pldesc:"):
        playlist_id = int(data.split(":")[1])
        pending_input_chats.add(callback.message.chat.id)
        prompt = await callback.message.reply("📝 توضیحات جدید پلی‌لیست رو بفرست.", reply_markup=input_keyboard(allow_clear=True))
        await callback.answer()
        reply = None
        try:
            reply, action = await wait_for_input(client, callback.message.chat.id)
            if action == "cancel" or (reply and reply.text and reply.text.startswith("/cancel")):
                await render_playlist_detail(callback.message, callback.from_user.id, playlist_id)
                return
            description = None if action == "clear" else (reply.text.strip()[:1024] if reply and reply.text else None)
            async with async_session() as db:
                playlist = (await db.execute(owned_playlist(playlist_id, callback.from_user.id))).scalar_one_or_none()
                if playlist:
                    playlist.description = description or None
                    await db.commit()
            await render_playlist_detail(callback.message, callback.from_user.id, playlist_id)
        finally:
            pending_input_chats.discard(callback.message.chat.id)
            await safe_delete(prompt)
            await safe_delete(reply)

    elif data.startswith("plcleardesc:"):
        playlist_id = int(data.split(":")[1])
        async with async_session() as db:
            playlist = (await db.execute(owned_playlist(playlist_id, callback.from_user.id))).scalar_one_or_none()
            if playlist:
                playlist.description = None
                await db.commit()
        await render_playlist_detail(callback.message, callback.from_user.id, playlist_id)
        await callback.answer("توضیحات پاک شد.")

    elif data.startswith("pladd:"):
        _, playlist_id, page = data.split(":")
        playlist_id, page = int(playlist_id), int(page)
        async with async_session() as db:
            playlist = (await db.execute(owned_playlist(playlist_id, callback.from_user.id))).scalar_one_or_none()
            user = (await db.execute(select(User).where(User.telegram_id == callback.from_user.id))).scalar_one_or_none()
            existing = {item.file_id for item in playlist.items} if playlist else set()
            files = (await db.execute(select(File).where(File.user_id == user.id, File.file_type.in_(("audio", "video"))).order_by(File.created_at.desc()))).scalars().all() if user and playlist else []
        page = min(max(page, 0), max(0, (len(files) - 1) // PAGE_SIZE))
        shown = files[page * PAGE_SIZE:(page + 1) * PAGE_SIZE]
        buttons = [[InlineKeyboardButton(
            f"{'✅' if file.id in existing else '➕'} {FILE_ICONS.get(file.file_type, '🎵')} \u200e{file.file_name[:32]}\u200e",
            callback_data="noop" if file.id in existing else f"pladdfile:{playlist_id}:{file.id}:{page}",
        )] for file in shown]
        if len(files) > PAGE_SIZE:
            buttons.append(pagination_row(f"pladd:{playlist_id}", page, len(files)))
        buttons.append([InlineKeyboardButton("↩️ برگشت", callback_data=f"playlist:{playlist_id}:0")])
        await callback.message.edit("🎵 **افزودن به پلی‌لیست**\nروی هر آهنگ یا ویدیو بزن تا اضافه بشه.", reply_markup=InlineKeyboardMarkup(buttons))
        await callback.answer()

    elif data.startswith("pladdfile:"):
        _, playlist_id, file_id, page = data.split(":")
        playlist_id, file_id, page = int(playlist_id), int(file_id), int(page)
        async with async_session() as db:
            playlist = (await db.execute(owned_playlist(playlist_id, callback.from_user.id))).scalar_one_or_none()
            file = (await db.execute(owned_file(file_id, callback.from_user.id))).scalar_one_or_none()
            if playlist is None or file is None or file.file_type not in ("audio", "video"):
                await callback.answer("نمی‌شه این فایل رو اضافه کرد.", show_alert=True)
                return
            if file_id not in {item.file_id for item in playlist.items}:
                position = max((item.position for item in playlist.items), default=-1) + 1
                db.add(PlaylistItem(playlist_id=playlist.id, file_id=file.id, position=position))
                await db.commit()
        await callback.answer("✅ به پلی‌لیست اضافه شد.")
        page_value = str(page)
        # Re-render in place so the plus immediately becomes a check mark.
        async with async_session() as db:
            playlist = (await db.execute(owned_playlist(playlist_id, callback.from_user.id))).scalar_one()
            user = (await db.execute(select(User).where(User.telegram_id == callback.from_user.id))).scalar_one()
            existing = {item.file_id for item in playlist.items}
            files = (await db.execute(select(File).where(File.user_id == user.id, File.file_type.in_(("audio", "video"))).order_by(File.created_at.desc()))).scalars().all()
        shown = files[int(page_value) * PAGE_SIZE:(int(page_value) + 1) * PAGE_SIZE]
        buttons = [[InlineKeyboardButton(
            f"{'✅' if item.id in existing else '➕'} {FILE_ICONS.get(item.file_type, '🎵')} \u200e{item.file_name[:32]}\u200e",
            callback_data="noop" if item.id in existing else f"pladdfile:{playlist_id}:{item.id}:{page_value}",
        )] for item in shown]
        if len(files) > PAGE_SIZE:
            buttons.append(pagination_row(f"pladd:{playlist_id}", int(page_value), len(files)))
        buttons.append([InlineKeyboardButton("↩️ برگشت", callback_data=f"playlist:{playlist_id}:0")])
        await callback.message.edit_reply_markup(InlineKeyboardMarkup(buttons))

    elif data.startswith("plitem:"):
        _, playlist_id, file_id, page = data.split(":")
        playlist_id, file_id, page = int(playlist_id), int(file_id), int(page)
        async with async_session() as db:
            playlist = (await db.execute(owned_playlist(playlist_id, callback.from_user.id))).scalar_one_or_none()
        items = sorted(playlist.items, key=lambda item: (item.position, item.id)) if playlist else []
        index = next((i for i, item in enumerate(items) if item.file_id == file_id), -1)
        if index < 0:
            await callback.answer("این مورد پیدا نشد.", show_alert=True)
            return
        item = items[index]
        await safe_edit(callback.message,
            f"{FILE_ICONS.get(item.file.file_type, '🎵')} **{display_filename(item.file.file_name)}**\nجایگاه {to_persian_digits(str(index + 1))} از {to_persian_digits(str(len(items)))}",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("▶️ پخش", callback_data=f"plplay:{playlist_id}:{index}")],
                [InlineKeyboardButton("⬆️ بالاتر", callback_data=f"plmove:{playlist_id}:{file_id}:-1:{page}"), InlineKeyboardButton("⬇️ پایین‌تر", callback_data=f"plmove:{playlist_id}:{file_id}:1:{page}")],
                [InlineKeyboardButton("✕ حذف از پلی‌لیست", callback_data=f"plremove:{playlist_id}:{file_id}:{page}")],
                [InlineKeyboardButton("↩️ برگشت", callback_data=f"playlist:{playlist_id}:{page}")],
            ]),
        )
        await callback.answer()

    elif data.startswith("plmove:"):
        _, playlist_id, file_id, offset, page = data.split(":")
        playlist_id, file_id, offset, page = int(playlist_id), int(file_id), int(offset), int(page)
        async with async_session() as db:
            playlist = (await db.execute(owned_playlist(playlist_id, callback.from_user.id))).scalar_one_or_none()
            items = sorted(playlist.items, key=lambda item: (item.position, item.id)) if playlist else []
            index = next((i for i, item in enumerate(items) if item.file_id == file_id), -1)
            target = index + offset
            if index >= 0 and 0 <= target < len(items):
                items[index].position, items[target].position = items[target].position, items[index].position
                await db.commit()
        await render_playlist_detail(callback.message, callback.from_user.id, playlist_id, page)
        await callback.answer("ترتیب ذخیره شد.")

    elif data.startswith("plremove:"):
        _, playlist_id, file_id, page = data.split(":")
        async with async_session() as db:
            playlist = (await db.execute(owned_playlist(int(playlist_id), callback.from_user.id))).scalar_one_or_none()
            if playlist:
                await db.execute(delete(PlaylistItem).where(PlaylistItem.playlist_id == playlist.id, PlaylistItem.file_id == int(file_id)))
                await db.flush()
                remaining = (await db.execute(select(PlaylistItem).where(PlaylistItem.playlist_id == playlist.id).order_by(PlaylistItem.position, PlaylistItem.id))).scalars().all()
                for position, item in enumerate(remaining):
                    item.position = position
                await db.commit()
        await render_playlist_detail(callback.message, callback.from_user.id, int(playlist_id), int(page))
        await callback.answer("از پلی‌لیست حذف شد.")

    elif data.startswith("plshuffle:"):
        playlist_id = int(data.split(":")[1])
        async with async_session() as db:
            playlist = (await db.execute(owned_playlist(playlist_id, callback.from_user.id))).scalar_one_or_none()
            if playlist:
                items = list(playlist.items)
                random.shuffle(items)
                for position, item in enumerate(items):
                    item.position = position
                await db.commit()
        await render_playlist_detail(callback.message, callback.from_user.id, playlist_id)
        await callback.answer("🔀 پلی‌لیست شافل شد.")

    elif data.startswith("plplay:"):
        _, playlist_id, index = data.split(":")
        await send_playlist_media(client, callback, int(playlist_id), int(index))

    elif data.startswith("plback:"):
        _, playlist_id, page = data.split(":")
        await safe_delete(callback.message)
        panel = await client.send_message(callback.message.chat.id, "در حال بازگشت به پلی‌لیست…")
        await render_playlist_detail(panel, callback.from_user.id, int(playlist_id), int(page))
        await callback.answer()

    elif data == "plclose":
        await safe_delete(callback.message)
        await callback.answer("پخش بسته شد.")

    elif data.startswith("pldelete:"):
        playlist_id = int(data.split(":")[1])
        await callback.message.edit("پلی‌لیست حذف بشه؟ فایل‌های اصلی داخل کمد می‌مونن.", reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("🗑️ بله، حذفش کن", callback_data=f"pldeleteok:{playlist_id}", style=enums.ButtonStyle.DANGER),
             InlineKeyboardButton("↩️ انصراف", callback_data=f"playlist:{playlist_id}:0")],
        ]))
        await callback.answer()

    elif data.startswith("pldeleteok:"):
        playlist_id = int(data.split(":")[1])
        async with async_session() as db:
            playlist = (await db.execute(owned_playlist(playlist_id, callback.from_user.id))).scalar_one_or_none()
            if playlist:
                await db.delete(playlist)
                await db.commit()
        await render_playlists(callback.message, callback.from_user.id)
        await callback.answer("پلی‌لیست حذف شد.")

    elif data.startswith("fileplaylist:"):
        _, file_id, page = data.split(":")
        file_id, page = int(file_id), int(page)
        async with async_session() as db:
            user = (await db.execute(select(User).where(User.telegram_id == callback.from_user.id))).scalar_one_or_none()
            playlists = (await db.execute(select(Playlist).where(Playlist.user_id == user.id).order_by(Playlist.updated_at.desc()))).scalars().all() if user else []
        page = min(max(page, 0), max(0, (len(playlists) - 1) // PAGE_SIZE))
        shown = playlists[page * PAGE_SIZE:(page + 1) * PAGE_SIZE]
        buttons = [[InlineKeyboardButton(f"🎧 {item.name[:35]}", callback_data=f"fileplaylistadd:{file_id}:{item.id}")] for item in shown]
        if len(playlists) > PAGE_SIZE:
            buttons.append(pagination_row(f"fileplaylist:{file_id}", page, len(playlists)))
        buttons.extend([[InlineKeyboardButton("➕ پلی‌لیست تازه", callback_data="playlist_new")], [InlineKeyboardButton("↩️ برگشت", callback_data=f"openfile:{file_id}")]])
        await callback.message.edit("این فایل به کدوم پلی‌لیست اضافه بشه؟", reply_markup=InlineKeyboardMarkup(buttons))
        await callback.answer()

    elif data.startswith("fileplaylistadd:"):
        _, file_id, playlist_id = data.split(":")
        file_id, playlist_id = int(file_id), int(playlist_id)
        async with async_session() as db:
            file = (await db.execute(owned_file(file_id, callback.from_user.id))).scalar_one_or_none()
            playlist = (await db.execute(owned_playlist(playlist_id, callback.from_user.id))).scalar_one_or_none()
            if file and playlist and file.file_type in ("audio", "video") and file.id not in {item.file_id for item in playlist.items}:
                db.add(PlaylistItem(playlist_id=playlist.id, file_id=file.id, position=max((item.position for item in playlist.items), default=-1) + 1))
                await db.commit()
        await callback.answer("✅ به پلی‌لیست اضافه شد.", show_alert=True)
        async with async_session() as db:
            file = (await db.execute(owned_file(file_id, callback.from_user.id))).scalar_one_or_none()
        if file:
            await callback.message.edit(file_detail_text(file), reply_markup=file_detail_keyboard_for_user(file, callback.from_user.id))

    elif data.startswith("sort_open:"):
        target = data.split(":", 1)[1]
        sort_return_targets[callback.from_user.id] = target
        sort_drafts[callback.from_user.id] = list(sort_preferences.get(callback.from_user.id, [("created", "desc")]))
        await callback.message.edit(
            "↕️ **مرتب‌سازی چندمرحله‌ای**\n\nمعیارها به ترتیب انتخاب، اولویت می‌گیرن. هر دکمه رو دوباره بزن تا جهتش عوض بشه یا حذف بشه.",
            reply_markup=sort_keyboard(callback.from_user.id),
        )
        await callback.answer()

    elif data.startswith("sort_toggle:"):
        field = data.split(":", 1)[1]
        draft = sort_drafts.setdefault(callback.from_user.id, [])
        match = next((index for index, item in enumerate(draft) if item[0] == field), None)
        if match is None:
            draft.append((field, "asc"))
        elif draft[match][1] == "asc":
            draft[match] = (field, "desc")
        else:
            draft.pop(match)
        await callback.message.edit_reply_markup(sort_keyboard(callback.from_user.id))
        await callback.answer()

    elif data == "sort_default":
        sort_drafts[callback.from_user.id] = [("created", "desc")]
        await callback.message.edit_reply_markup(sort_keyboard(callback.from_user.id))
        await callback.answer("مرتب‌سازی پیش‌فرض انتخاب شد.")

    elif data in ("sort_apply", "sort_cancel"):
        if data == "sort_apply":
            sort_preferences[callback.from_user.id] = list(sort_drafts.get(callback.from_user.id) or [("created", "desc")])
            await persist_user_ui_state(callback.from_user.id)
        target = sort_return_targets.pop(callback.from_user.id, "files:0")
        sort_drafts.pop(callback.from_user.id, None)
        await render_list_target(callback.message, callback.from_user.id, target)
        await callback.answer("مرتب‌سازی اعمال شد." if data == "sort_apply" else "تغییری اعمال نشد.")

    elif data.startswith("batch_start:"):
        target = data.split(":", 1)[1]
        batch_return_targets[callback.from_user.id] = target
        batch_selections[callback.from_user.id] = set()
        await persist_user_ui_state(callback.from_user.id)
        await render_list_target(callback.message, callback.from_user.id, target)
        await callback.answer("فایل‌ها رو انتخاب کن.")

    elif data.startswith("batch_toggle:"):
        file_id = int(data.split(":", 1)[1])
        async with async_session() as db:
            exists = (await db.execute(owned_file(file_id, callback.from_user.id))).scalar_one_or_none()
        if exists is None:
            await callback.answer("فایل پیدا نشد.", show_alert=True)
            return
        selected = batch_selections.setdefault(callback.from_user.id, set())
        selected.symmetric_difference_update({file_id})
        await persist_user_ui_state(callback.from_user.id)
        target = batch_return_targets.get(callback.from_user.id, "files:0")
        await render_list_target(callback.message, callback.from_user.id, target)
        await callback.answer("انتخاب شد." if file_id in selected else "از انتخاب خارج شد.")

    elif data == "batch_cancel":
        target = batch_return_targets.pop(callback.from_user.id, "files:0")
        batch_selections.pop(callback.from_user.id, None)
        await persist_user_ui_state(callback.from_user.id)
        await render_list_target(callback.message, callback.from_user.id, target)
        await callback.answer("انتخاب گروهی بسته شد.")

    elif data == "batch_delete":
        count = len(batch_selections.get(callback.from_user.id, set()))
        if not count:
            await callback.answer("اول حداقل یک فایل انتخاب کن.", show_alert=True)
            return
        await callback.message.edit(
            f"🗑️ **حذف {to_persian_digits(str(count))} فایل**\nاین فایل‌ها از کمد و کانال ذخیره‌سازی حذف می‌شن. مطمئنی؟",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("🗑️ بله، حذفشون کن", callback_data="batch_delete_confirm", style=enums.ButtonStyle.DANGER)],
                [InlineKeyboardButton("↩️ برگشت", callback_data="batch_return")],
            ]),
        )
        await callback.answer()

    elif data == "batch_delete_confirm":
        selected_ids = batch_selections.get(callback.from_user.id, set())
        async with async_session() as db:
            user = (await db.execute(select(User).where(User.telegram_id == callback.from_user.id))).scalar_one_or_none()
            files = (await db.execute(select(File).where(File.user_id == user.id, File.id.in_(selected_ids)))).scalars().all() if user else []
            message_ids = [file.channel_message_id for file in files]
            for start in range(0, len(message_ids), 100):
                if not await delete_from_storage_channel(message_ids[start:start + 100]):
                    await callback.answer("حذف از فضای ذخیره‌سازی انجام نشد.", show_alert=True)
                    return
            for file in files:
                await db.delete(file)
            await db.commit()
        target = batch_return_targets.pop(callback.from_user.id, "files:0")
        batch_selections.pop(callback.from_user.id, None)
        await persist_user_ui_state(callback.from_user.id)
        await render_list_target(callback.message, callback.from_user.id, target)
        await callback.answer(f"{to_persian_digits(str(len(files)))} فایل حذف شد.")

    elif data == "batch_return":
        await render_list_target(callback.message, callback.from_user.id, batch_return_targets.get(callback.from_user.id, "files:0"))
        await callback.answer()

    elif data.startswith("batch_move:"):
        if not batch_selections.get(callback.from_user.id):
            await callback.answer("اول حداقل یک فایل انتخاب کن.", show_alert=True)
            return
        page = int(data.split(":", 1)[1])
        async with async_session() as db:
            user = (await db.execute(select(User).where(User.telegram_id == callback.from_user.id))).scalar_one_or_none()
            folders = (await db.execute(select(Folder).where(Folder.user_id == user.id).order_by(Folder.name))).scalars().all() if user else []
            targets = [(folder, await folder_path(db, folder)) for folder in folders]
        page = min(max(page, 0), max(0, (len(targets) - 1) // PAGE_SIZE))
        shown = targets[page * PAGE_SIZE:(page + 1) * PAGE_SIZE]
        buttons = [[InlineKeyboardButton(f"🗃️ {path[:42]}", callback_data=f"batch_moveto:{folder.id}")] for folder, path in shown]
        if len(targets) > PAGE_SIZE:
            buttons.append(pagination_row("batch_move", page, len(targets)))
        buttons.extend([[InlineKeyboardButton("📦 فایل‌های بیرون از کشو", callback_data="batch_moveto:0")], [InlineKeyboardButton("↩️ برگشت", callback_data="batch_return")]])
        await callback.message.edit("🗃️ فایل‌های انتخاب‌شده به کجا منتقل بشن؟", reply_markup=InlineKeyboardMarkup(buttons))
        await callback.answer()

    elif data.startswith("batch_moveto:"):
        target_id = int(data.split(":", 1)[1]) or None
        selected_ids = batch_selections.get(callback.from_user.id, set())
        async with async_session() as db:
            user = (await db.execute(select(User).where(User.telegram_id == callback.from_user.id))).scalar_one_or_none()
            if target_id is not None:
                target = (await db.execute(select(Folder).where(Folder.id == target_id, Folder.user_id == user.id))).scalar_one_or_none() if user else None
                if target is None:
                    await callback.answer("کشو مقصد پیدا نشد.", show_alert=True)
                    return
            files = (await db.execute(select(File).where(File.user_id == user.id, File.id.in_(selected_ids)))).scalars().all() if user else []
            for file in files:
                file.folder_id = target_id
            await db.commit()
        return_target = batch_return_targets.pop(callback.from_user.id, "files:0")
        batch_selections.pop(callback.from_user.id, None)
        await persist_user_ui_state(callback.from_user.id)
        await render_list_target(callback.message, callback.from_user.id, return_target)
        await callback.answer(f"{to_persian_digits(str(len(files)))} فایل منتقل شد.")

    elif data == "batch_edit":
        if not batch_selections.get(callback.from_user.id):
            await callback.answer("اول حداقل یک فایل انتخاب کن.", show_alert=True)
            return
        await callback.message.edit(
            "✏️ **ویرایش گروهی فایل‌ها**\nچه تغییری اعمال بشه؟",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("📝 جایگزینی توضیحات", callback_data="batch_edit_input:desc_set"), InlineKeyboardButton("➕ افزودن توضیحات", callback_data="batch_edit_input:desc_append")],
                [InlineKeyboardButton("🧹 پاک‌کردن توضیحات", callback_data="batch_edit_apply:desc_clear")],
                [InlineKeyboardButton("پیشوند نام", callback_data="batch_edit_input:name_prefix"), InlineKeyboardButton("پسوند نام", callback_data="batch_edit_input:name_suffix")],
                [InlineKeyboardButton("پیدا و جایگزین نام", callback_data="batch_edit_input:name_replace")],
                [InlineKeyboardButton("↩️ برگشت", callback_data="batch_return")],
            ]),
        )
        await callback.answer()

    elif data.startswith("batch_edit_apply:"):
        action = data.split(":", 1)[1]
        selected_ids = batch_selections.get(callback.from_user.id, set())
        async with async_session() as db:
            user = (await db.execute(select(User).where(User.telegram_id == callback.from_user.id))).scalar_one_or_none()
            files = (await db.execute(select(File).where(File.user_id == user.id, File.id.in_(selected_ids)))).scalars().all() if user else []
            if action == "desc_clear":
                for file in files:
                    file.description = None
            await db.commit()
        await render_list_target(callback.message, callback.from_user.id, batch_return_targets.get(callback.from_user.id, "files:0"))
        await callback.answer(f"{to_persian_digits(str(len(files)))} فایل ویرایش شد.")

    elif data.startswith("batch_edit_input:"):
        action = data.split(":", 1)[1]
        hints = {
            "desc_set": "توضیحات جدید رو بفرست.", "desc_append": "متنی که باید اضافه بشه رو بفرست.",
            "name_prefix": "پیشوند نام فایل‌ها رو بفرست.", "name_suffix": "پسوند نام فایل‌ها رو بفرست.",
            "name_replace": "عبارت قبلی و جدید رو به شکل `قدیمی => جدید` بفرست.",
        }
        pending_input_chats.add(callback.message.chat.id)
        prompt = await callback.message.reply(hints[action], reply_markup=input_keyboard())
        await callback.answer()
        reply = None
        try:
            reply, input_action = await wait_for_input(client, callback.message.chat.id)
            if input_action == "cancel" or reply is None or not reply.text:
                await callback.message.edit("ویرایش گروهی لغو شد.", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("↩️ برگشت", callback_data="batch_return")]]))
                return
            value = reply.text.strip()
            if not value:
                return
            replacement = ""
            if action == "name_replace":
                if "=>" not in value:
                    await callback.message.edit("قالب متن درست نبود. نمونه: `قدیمی => جدید`", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("↩️ برگشت", callback_data="batch_return")]]))
                    return
                value, replacement = [part.strip() for part in value.split("=>", 1)]
                if not value:
                    return
            selected_ids = batch_selections.get(callback.from_user.id, set())
            async with async_session() as db:
                user = (await db.execute(select(User).where(User.telegram_id == callback.from_user.id))).scalar_one_or_none()
                files = (await db.execute(select(File).where(File.user_id == user.id, File.id.in_(selected_ids)))).scalars().all() if user else []
                for file in files:
                    if action == "desc_set":
                        file.description = value[:1024]
                    elif action == "desc_append":
                        file.description = f"{file.description}\n{value}".strip()[:1024] if file.description else value[:1024]
                    else:
                        stem, dot, extension = file.file_name.rpartition(".")
                        if not dot or not stem:
                            stem, extension = file.file_name, ""
                        if action == "name_prefix": stem = value + stem
                        elif action == "name_suffix": stem = stem + value
                        else: stem = stem.replace(value, replacement)
                        file.file_name = sanitize_filename(f"{stem}.{extension}" if extension else stem)
                await db.commit()
            await render_list_target(callback.message, callback.from_user.id, batch_return_targets.get(callback.from_user.id, "files:0"))
        finally:
            pending_input_chats.discard(callback.message.chat.id)
            await safe_delete(prompt)
            await safe_delete(reply)

    elif data == "home":
        batch_selections.pop(callback.from_user.id, None)
        batch_return_targets.pop(callback.from_user.id, None)
        current_drawers[callback.from_user.id] = None
        await persist_user_ui_state(callback.from_user.id)
        await safe_edit(callback.message,
            "🗄️ **رسیدیم به کُمدت!**\n\nهمه‌چیز مرتب سر جاشه؛ می‌تونی فایل‌هات رو ببینی، کشوهاتو باز کنی یا فایلی رو پیدا کنی. از کجا ادامه بدیم؟ 👇",
            reply_markup=main_menu_keyboard(callback.from_user.id),
        )
        await callback.answer()

    elif data.startswith("files:"):
        await render_recent_files(callback.message, callback.from_user.id, int(data.split(":")[1]))
        await callback.answer()

    elif data.startswith("library_filter:"):
        filter_return_targets[callback.from_user.id] = data.split(":", 1)[1]
        filter_previous[(callback.from_user.id, "library")] = set(library_filters.get(callback.from_user.id, set()))
        await callback.message.edit(
            "☑️ **چه چیزهایی رو از کمد برات بیارم؟**\nهر چند نوعی که می‌خوای رو انتخاب کن، بعد «اعمال» رو بزن 👇",
            reply_markup=type_filter_keyboard(library_filters.get(callback.from_user.id, set()), "library"),
        )
        await callback.answer()

    elif data.startswith("library_filter_toggle:"):
        item = data.split(":", 1)[1]
        selected = library_filters.setdefault(callback.from_user.id, set())
        selected.symmetric_difference_update({item})
        await persist_user_ui_state(callback.from_user.id)
        await callback.message.edit_reply_markup(type_filter_keyboard(selected, "library"))
        await callback.answer()

    elif data == "library_filter_all":
        library_filters[callback.from_user.id] = set(FILE_ICONS)
        await persist_user_ui_state(callback.from_user.id)
        await callback.message.edit_reply_markup(type_filter_keyboard(library_filters[callback.from_user.id], "library"))
        await callback.answer("همهٔ نوع‌ها انتخاب شد.")

    elif data == "library_filter_clear":
        library_filters[callback.from_user.id] = set()
        await persist_user_ui_state(callback.from_user.id)
        await callback.message.edit_reply_markup(type_filter_keyboard(set(), "library"))
        await callback.answer("فیلتر پاک شد.")

    elif data in ("library_filter_apply", "library_filter_cancel"):
        if data.endswith("cancel"):
            library_filters[callback.from_user.id] = filter_previous.get((callback.from_user.id, "library"), set())
        filter_previous.pop((callback.from_user.id, "library"), None)
        await persist_user_ui_state(callback.from_user.id)
        target = filter_return_targets.get(callback.from_user.id, "files")
        if target == "files":
            await render_recent_files(callback.message, callback.from_user.id)
        elif target == "rootfiles":
            await render_root_files(callback.message, callback.from_user.id)
        else:
            await render_folder_page(callback.message, callback.from_user.id, int(target.split(":")[1]) or None)
        await callback.answer("فیلتر اعمال شد." if data.endswith("apply") else "برگشتیم.")

    elif data.startswith("folders:"):
        _, parent_text, page_text = data.split(":")
        await render_folder_page(callback.message, callback.from_user.id, int(parent_text) or None, int(page_text))
        await callback.answer()

    elif data.startswith("rootfiles:"):
        await render_root_files(callback.message, callback.from_user.id, int(data.split(":")[1]))
        await callback.answer()

    elif data in ("search_choose", "search_refine"):
        search_filter_returns[callback.from_user.id] = "results" if data == "search_refine" else "home"
        filter_previous[(callback.from_user.id, "search")] = set(search_filters.get(callback.from_user.id, set()))
        await callback.message.edit(
            "🔍 **مرحلهٔ ۱ از ۲: توی چه فایل‌هایی بگردم؟**\nیک یا چند نوع رو انتخاب کن و بعد «ادامه» رو بزن 👇",
            reply_markup=search_type_keyboard(callback.from_user.id),
        )
        await callback.answer()

    elif data.startswith("search_filter_toggle:"):
        item = data.split(":", 1)[1]
        selected = search_filters.setdefault(callback.from_user.id, set())
        selected.symmetric_difference_update({item})
        await persist_user_ui_state(callback.from_user.id)
        await callback.message.edit_reply_markup(search_type_keyboard(callback.from_user.id))
        await callback.answer()

    elif data == "search_filter_all":
        search_filters[callback.from_user.id] = set(FILE_ICONS) | {"folder"}
        await persist_user_ui_state(callback.from_user.id)
        await callback.message.edit_reply_markup(search_type_keyboard(callback.from_user.id))
        await callback.answer("همهٔ نوع‌ها انتخاب شد.")

    elif data == "search_filter_clear":
        search_filters[callback.from_user.id] = set()
        await persist_user_ui_state(callback.from_user.id)
        await callback.message.edit_reply_markup(search_type_keyboard(callback.from_user.id))
        await callback.answer("بدون محدودیت جست‌وجو می‌کنم.")

    elif data == "search_filter_cancel":
        search_filters[callback.from_user.id] = filter_previous.pop((callback.from_user.id, "search"), set())
        await persist_user_ui_state(callback.from_user.id)
        if search_filter_returns.pop(callback.from_user.id, "home") == "results" and search_queries.get(callback.from_user.id):
            await render_search_results(callback.message, callback.from_user.id)
        else:
            await callback.message.edit("🗄️ **رسیدیم به کُمدت!**\n\nهمه‌چیز مرتب سر جاشه؛ می‌تونی فایل‌هات رو ببینی، کشوهاتو باز کنی یا فایلی رو پیدا کنی. از کجا ادامه بدیم؟ 👇", reply_markup=main_menu_keyboard(callback.from_user.id))
        await callback.answer("جست‌وجو لغو شد.")

    elif data in ("search_filter_apply", "search_prompt", "search_again"):
        return_to_results = data == "search_again" and bool(search_queries.get(callback.from_user.id))
        filter_previous.pop((callback.from_user.id, "search"), None)
        pending_input_chats.add(callback.message.chat.id)
        selected = search_filters.get(callback.from_user.id, set())
        selected_label = "همهٔ موارد" if not selected else "، ".join(TYPE_LABELS[item] for item in sorted(selected))
        prompt = await callback.message.reply(
            f"🔍 **مرحلهٔ ۲ از ۲: دنبال چی بگردم؟**\nاسم فایل یا عبارت مد نظرت رو برام بفرست.\nنوع‌ها: {selected_label}",
            reply_markup=input_keyboard(),
        )
        await callback.answer()
        reply = None
        try:
            reply, action = await wait_for_input(client, callback.message.chat.id, timeout=60)
            if action == "cancel" or not reply or not reply.text or reply.text.startswith("/cancel"):
                if return_to_results:
                    await render_search_results(callback.message, callback.from_user.id)
                else:
                    await callback.message.edit("جست‌وجو لغو شد.", reply_markup=main_menu_keyboard(callback.from_user.id))
                return
            search_queries[callback.from_user.id] = reply.text.strip()[:100]
            await persist_user_ui_state(callback.from_user.id)
            await render_search_results(callback.message, callback.from_user.id)
        except Exception as exc:
            if "timeout" in str(exc).lower():
                await callback.message.reply("⏱ وقت جست‌وجو تموم شد؛ دوباره تلاش کن.")
        finally:
            pending_input_chats.discard(callback.message.chat.id)
            await safe_delete(prompt)
            await safe_delete(reply)

    elif data.startswith("search:"):
        await render_search_results(callback.message, callback.from_user.id, int(data.split(":")[1]))
        await callback.answer()

    elif data.startswith("preview:"):
        file_id = int(data.split(":")[1])
        async with async_session() as db:
            file = (await db.execute(owned_file(file_id, callback.from_user.id))).scalar_one_or_none()
        if not file:
            await callback.answer("فایل پیدا نشد.", show_alert=True)
            return
        try:
            preview = await client.copy_message(callback.message.chat.id, settings.telegram_storage_channel_id, file.channel_message_id)
            await preview.edit_reply_markup(InlineKeyboardMarkup([[
                InlineKeyboardButton("✖️ بستن پیش‌نمایش", callback_data=f"deletepreview:{preview.id}")
            ]]))
            asyncio.create_task(delete_preview_later(client, callback.message.chat.id, preview.id))
            await callback.answer("پیش‌نمایش فرستاده شد و تا ۵ دقیقه دیگه خودکار پاک می‌شه.")
        except Exception:
            await callback.answer("نمایش این فایل در تلگرام ممکن نشد.", show_alert=True)

    elif data.startswith("deletepreview:"):
        preview_id = int(data.split(":")[1])
        try:
            await client.delete_messages(callback.message.chat.id, preview_id)
        except Exception:
            await callback.answer("پیش‌نمایش قبلاً بسته شده.")
            return
        await callback.answer("پیش‌نمایش بسته شد.")

    elif data.startswith("folder_actions:"):
        folder_id = int(data.split(":")[1])
        async with async_session() as db:
            folder = (await db.execute(owned_folder(folder_id, callback.from_user.id))).scalar_one_or_none()
        if not folder:
            await callback.answer("کشو پیدا نشد.", show_alert=True)
            return
        await callback.message.edit(
            f"⚙️ **مدیریت کشوی {escape_markdown(folder.name)}**\n\n📝 توضیحات: {escape_markdown(folder.description) if folder.description else 'هنوز توضیحی نداره.'}",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("➕ ساخت زیرکشو", callback_data=f"create_folder:{folder.id}", style=enums.ButtonStyle.SUCCESS)],
                [InlineKeyboardButton("✏️ ویرایش نام/توضیح", callback_data=f"folder_edit:{folder.id}")],
                [InlineKeyboardButton("🗃️ انتقال کشو", callback_data=f"movefolder:{folder.id}"),
                 InlineKeyboardButton("↕️ مرتب‌سازی", callback_data=f"sort_open:folders:{folder.id}:0")],
                [InlineKeyboardButton("🗑️ حذف کشو", callback_data=f"delfolder:{folder.id}", style=enums.ButtonStyle.DANGER)],
                [InlineKeyboardButton("↩️ بازگشت به کشو", callback_data=f"folder:{folder.id}:0"),
                 InlineKeyboardButton("🚪 منوی اصلی", callback_data="home")],
            ]),
        )
        await callback.answer()

    elif data.startswith("folder_edit:"):
        folder_id = int(data.split(":")[1])
        async with async_session() as db:
            folder = (await db.execute(owned_folder(folder_id, callback.from_user.id))).scalar_one_or_none()
        if not folder:
            await callback.answer("کشو پیدا نشد.", show_alert=True)
            return
        description_row = [InlineKeyboardButton(
            "✏️ ویرایش توضیحات" if folder.description else "📝 افزودن توضیحات",
            callback_data=f"folderdesc:{folder.id}",
        )]
        if folder.description:
            description_row.append(InlineKeyboardButton("🧹 حذف توضیحات", callback_data=f"clearfolderdesc:{folder.id}"))
        await callback.message.edit(
            f"✏️ **ویرایش کشوی {escape_markdown(folder.name)}**",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("✏️ تغییر نام", callback_data=f"renamefolder:{folder.id}")],
                description_row,
                [InlineKeyboardButton("↩️ مدیریت این کشو", callback_data=f"folder_actions:{folder.id}")],
            ]),
        )
        await callback.answer()

    elif data.startswith("folderdesc:"):
        folder_id = int(data.split(":")[1])
        async with async_session() as db:
            folder = (await db.execute(owned_folder(folder_id, callback.from_user.id))).scalar_one_or_none()
        if not folder:
            await callback.answer("کشو پیدا نشد.", show_alert=True)
            return
        pending_input_chats.add(callback.message.chat.id)
        current_description = escape_markdown(folder.description) if folder.description else "— بدون توضیحات —"
        prompt = await callback.message.reply(
            f"📝 توضیحات فعلی:\n{current_description}\n\nمتن جدید رو بفرست.",
            reply_markup=input_keyboard(allow_clear=True),
        )
        await callback.answer()
        reply = None
        try:
            reply, action = await wait_for_input(client, callback.message.chat.id, timeout=120)
            if action == "cancel" or (reply and reply.text and reply.text.startswith("/cancel")):
                await render_folder_page(callback.message, callback.from_user.id, folder_id)
                return
            if action == "clear":
                description = None
            elif not reply or not reply.text:
                return
            else:
                description = None if reply.text.startswith("/clear") else reply.text.strip()[:1024]
            async with async_session() as db:
                folder = (await db.execute(owned_folder(folder_id, callback.from_user.id))).scalar_one_or_none()
                if not folder:
                    return
                folder.description = description or None
                await db.commit()
            await callback.message.edit("✅ توضیحات کشو به‌روز شد.", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("↩️ مدیریت کشو", callback_data=f"folder_actions:{folder_id}"), InlineKeyboardButton("🗃️ باز کردن", callback_data=f"folder:{folder_id}:0")]]))
        except (TimeoutError, asyncio.TimeoutError):
            await callback.message.edit("⏱ زمان ویرایش توضیحات تموم شد.", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("↩️ مدیریت کشو", callback_data=f"folder_actions:{folder_id}")]]))
        finally:
            pending_input_chats.discard(callback.message.chat.id)
            await safe_delete(prompt)
            await safe_delete(reply)

    elif data.startswith("clearfolderdesc:"):
        folder_id = int(data.split(":")[1])
        async with async_session() as db:
            folder = (await db.execute(owned_folder(folder_id, callback.from_user.id))).scalar_one_or_none()
            if not folder:
                await callback.answer("کشو پیدا نشد.", show_alert=True)
                return
            folder.description = None
            await db.commit()
        await callback.message.edit("🧹 توضیحات کشو پاک شد.", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("↩️ مدیریت کشو", callback_data=f"folder_actions:{folder_id}"), InlineKeyboardButton("🗃️ باز کردن", callback_data=f"folder:{folder_id}:0")]]))
        await callback.answer("توضیحات پاک شد.")

    elif data == "logout_all_confirm":
        # Perform global logout
        async with async_session() as db:
            result = await db.execute(select(User).where(User.telegram_id == callback.from_user.id))
            user = result.scalar_one_or_none()
            
            if user:
                user.auth_version += 1
                await db.commit()
                await callback.message.edit(
                    "✅ از همهٔ دستگاه‌ها خارج شدی.",
                    reply_markup=main_menu_keyboard(callback.from_user.id),
                )
            else:
                await callback.answer("حساب کاربری پیدا نشد.", show_alert=True)
        await callback.answer()
        
    elif data == "logout_all_cancel":
        # Cancel logout
        await callback.message.edit("انصراف داده شد؛ نشست‌ها فعال ماندند.", reply_markup=main_menu_keyboard(callback.from_user.id))
        await callback.answer()

    elif data == "get_web_link":
        if settings.web_base_url.startswith("https://"):
            token = create_access_token(callback.from_user.id)
            web_url = f"{settings.web_base_url}/auth?token={token}"
            await callback.message.reply(
                "🌐 نسخهٔ وب کمد\nاین لینک رو خصوصی نگه دار:\n"
                f"{web_url}",
                reply_markup=InlineKeyboardMarkup([
                    [get_web_app_button(callback.from_user.id, "🌐 باز کردن نسخهٔ وب")]
                ])
            )
        else:
            await callback.message.reply(local_web_instructions())
        await callback.answer()
        
    elif data == "show_files":
        await render_recent_files(callback.message, callback.from_user.id)
        await callback.answer()

    elif data == "show_help":
        await set_current_drawer(callback.from_user.id, None)
        await safe_edit(callback.message, HELP_TEXT, reply_markup=help_keyboard(callback.from_user.id))
        await callback.answer()

    elif data.startswith("openfile:"):
        file_id = int(data.split(":")[1])
        async with async_session() as db:
            file = (await db.execute(owned_file(file_id, callback.from_user.id))).scalar_one_or_none()
        if file is None:
            await callback.answer("فایل پیدا نشد.", show_alert=True)
            return
        await callback.message.edit(file_detail_text(file), reply_markup=file_detail_keyboard_for_user(file, callback.from_user.id))
        await callback.answer()

    elif data.startswith("filedesc:"):
        file_id = int(data.split(":")[1])
        async with async_session() as db:
            file = (await db.execute(owned_file(file_id, callback.from_user.id))).scalar_one_or_none()
        if not file:
            await callback.answer("فایل پیدا نشد.", show_alert=True)
            return
        pending_input_chats.add(callback.message.chat.id)
        current_description = escape_markdown(file.description) if file.description else "— بدون توضیحات —"
        prompt = await callback.message.reply(
            f"📝 توضیحات فعلی:\n{current_description}\n\nمتن جدید رو بفرست.",
            reply_markup=input_keyboard(allow_clear=True),
        )
        await callback.answer()
        reply = None
        try:
            reply, action = await wait_for_input(client, callback.message.chat.id, timeout=120)
            if action == "cancel" or (reply and reply.text and reply.text.startswith("/cancel")):
                await callback.message.edit(file_detail_text(file), reply_markup=file_detail_keyboard_for_user(file, callback.from_user.id))
                return
            if action == "clear":
                description = None
            elif not reply or not reply.text:
                return
            else:
                description = None if reply.text.startswith("/clear") else reply.text.strip()[:1024]
            async with async_session() as db:
                file = (await db.execute(owned_file(file_id, callback.from_user.id))).scalar_one_or_none()
                if not file:
                    return
                file.description = description or None
                await db.commit()
                await db.refresh(file)
            await callback.message.edit("✅ توضیحات فایل به‌روز شد.\n\n" + file_detail_text(file), reply_markup=file_detail_keyboard_for_user(file, callback.from_user.id))
        except (TimeoutError, asyncio.TimeoutError):
            await callback.message.edit("⏱ زمان ویرایش توضیحات تموم شد.\n\n" + file_detail_text(file), reply_markup=file_detail_keyboard_for_user(file, callback.from_user.id))
        finally:
            pending_input_chats.discard(callback.message.chat.id)
            await safe_delete(prompt)
            await safe_delete(reply)

    elif data.startswith("clearfiledesc:"):
        file_id = int(data.split(":")[1])
        async with async_session() as db:
            file = (await db.execute(owned_file(file_id, callback.from_user.id))).scalar_one_or_none()
            if not file:
                await callback.answer("فایل پیدا نشد.", show_alert=True)
                return
            file.description = None
            await db.commit()
            await db.refresh(file)
        await callback.message.edit("🧹 توضیحات فایل پاک شد.\n\n" + file_detail_text(file), reply_markup=file_detail_keyboard_for_user(file, callback.from_user.id))
        await callback.answer("توضیحات پاک شد.")
        
    elif data == "create_folder" or data.startswith("create_folder:"):
        # Interactive folder creation using listener
        parent_id = int(data.split(":")[1]) if ":" in data else None
        if parent_id is not None:
            async with async_session() as db:
                parent = (await db.execute(owned_folder(parent_id, callback.from_user.id))).scalar_one_or_none()
            if parent is None:
                await callback.answer("کشو پیدا نشد.", show_alert=True)
                return
        pending_input_chats.add(callback.message.chat.id)
        prompt = await callback.message.reply(
            "📁 نام کشوی جدید رو بفرست.",
            reply_markup=input_keyboard(),
        )
        await callback.answer()
        reply = None
        try:
            # Wait for user's reply (60 second timeout)
            reply, action = await wait_for_input(client, callback.message.chat.id, timeout=60)
            
            if action == "cancel" or (reply and reply.text and reply.text.startswith("/cancel")):
                await render_folder_page(callback.message, callback.from_user.id, parent_id)
                return
            
            folder_name = reply.text.strip() if reply.text else None
            
            if not folder_name or len(folder_name) > 255:
                await callback.message.edit("❌ اسم کشو باید بین ۱ تا ۲۵۵ نویسه باشه.", reply_markup=main_menu_keyboard(callback.from_user.id))
                return
            
            # Create folder
            async with async_session() as db:
                user_result = await db.execute(
                    select(User).where(User.telegram_id == callback.from_user.id)
                )
                user = user_result.scalar_one_or_none()
                
                if not user:
                    await callback.message.edit("برای شروع، دستور /start رو بفرست.")
                    return

                if parent_id is not None:
                    parent = (await db.execute(owned_folder(parent_id, callback.from_user.id))).scalar_one_or_none()
                    if parent is None:
                        await callback.message.edit("❌ کشوی قبلی دیگه وجود نداره.", reply_markup=main_menu_keyboard(callback.from_user.id))
                        return
                
                # Check if exists
                existing = await db.execute(
                    select(Folder).where(
                        Folder.user_id == user.id,
                        Folder.name == folder_name,
                        Folder.parent_id == parent_id
                    )
                )
                if existing.scalar_one_or_none():
                    await callback.message.edit(f"❌ یه کشو با اسم «{folder_name}» همین‌جا داری.", reply_markup=main_menu_keyboard(callback.from_user.id))
                    return
                
                folder = Folder(user_id=user.id, parent_id=parent_id, name=folder_name)
                db.add(folder)
                await db.commit()
            
            await callback.message.edit(
                f"✅ کشوی «{folder_name}» ساخته شد.",
                reply_markup=InlineKeyboardMarkup([
                    [InlineKeyboardButton("🗃️ باز کردن کشو", callback_data=f"folder:{folder.id}:0")],
                    [InlineKeyboardButton("↩️ بازگشت به کشوی قبلی", callback_data=f"folders:{parent_id or 0}:0")],
                ]),
            )
            
        except Exception as e:
            if "timeout" in str(e).lower():
                await callback.message.edit("⏱ وقت ساخت کشو تموم شد؛ دوباره تلاش کن.", reply_markup=main_menu_keyboard(callback.from_user.id))
            else:
                await callback.message.edit("❌ کشو ساخته نشد؛ دوباره تلاش کن.", reply_markup=main_menu_keyboard(callback.from_user.id))
        finally:
            pending_input_chats.discard(callback.message.chat.id)
            await safe_delete(prompt)
            await safe_delete(reply)
        
    elif data.startswith("folder:"):
        parts = data.split(":")
        await render_folder_page(callback.message, callback.from_user.id, int(parts[1]), int(parts[2]) if len(parts) > 2 else 0)
        await callback.answer()
        
    elif data == "back_folders":
        await render_folder_page(callback.message, callback.from_user.id)
        await callback.answer()
        
    elif data.startswith("movefolder:"):
        parts = data.split(":")
        folder_id = int(parts[1])
        page = int(parts[2]) if len(parts) > 2 else 0
        async with async_session() as db:
            folder = (await db.execute(owned_folder(folder_id, callback.from_user.id))).scalar_one_or_none()
            if folder is None:
                await callback.answer("کشو پیدا نشد.", show_alert=True)
                return
            folders = (await db.execute(select(Folder).where(
                Folder.user_id == folder.user_id, Folder.id != folder_id
            ).order_by(Folder.name))).scalars().all()
            targets = [(target, await folder_path(db, target)) for target in folders]
        page = min(max(page, 0), max(0, (len(targets) - 1) // PAGE_SIZE))
        shown = targets[page * PAGE_SIZE:(page + 1) * PAGE_SIZE]
        buttons = [[InlineKeyboardButton(f"🗃️ {path[:40]}", callback_data=f"folderto:{folder_id}:{target.id}")] for target, path in shown]
        if len(targets) > PAGE_SIZE:
            buttons.append(pagination_row(f"movefolder:{folder_id}", page, len(targets)))
        buttons.append([InlineKeyboardButton("📦 بیرون از کشو", callback_data=f"folderto:{folder_id}:0")])
        buttons.append([InlineKeyboardButton("↩️ بازگشت", callback_data=f"folder_actions:{folder_id}")])
        await callback.message.edit("🗃️ مقصد کشو رو انتخاب کن:", reply_markup=InlineKeyboardMarkup(buttons))
        await callback.answer()

    elif data.startswith("folderto:"):
        _, source_text, target_text = data.split(":")
        folder_id, target_id = int(source_text), int(target_text)
        async with async_session() as db:
            folder = (await db.execute(owned_folder(folder_id, callback.from_user.id))).scalar_one_or_none()
            target = (await db.execute(owned_folder(target_id, callback.from_user.id))).scalar_one_or_none() if target_id else None
            if folder is None or (target_id and target is None):
                await callback.answer("کشو پیدا نشد.", show_alert=True)
                return
            ancestor = target
            while ancestor is not None:
                if ancestor.id == folder_id:
                    await callback.answer("نمی‌تونی کشو رو داخل خودش یا زیرکشوی خودش ببری.", show_alert=True)
                    return
                ancestor = (await db.execute(owned_folder(ancestor.parent_id, callback.from_user.id))).scalar_one_or_none() if ancestor.parent_id else None
            duplicate = (await db.execute(select(Folder.id).where(
                Folder.user_id == folder.user_id, Folder.parent_id == (target_id or None),
                Folder.name == folder.name, Folder.id != folder_id
            ))).scalar_one_or_none()
            if duplicate is not None:
                await callback.answer("کشویی با همین نام در مقصد هست.", show_alert=True)
                return
            folder.parent_id = target_id or None
            await db.commit()
        await callback.message.edit(
            "✅ کشو با موفقیت منتقل شد.",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🗃️ باز کردن کشو", callback_data=f"folder:{folder_id}:0")], [InlineKeyboardButton("🚪 منوی اصلی", callback_data="home")]]),
        )
        await callback.answer()

    elif data.startswith("move:"):
        parts = data.split(":")
        file_id = int(parts[1])
        page = int(parts[2]) if len(parts) > 2 else 0
        
        async with async_session() as db:
            # Get user
            user_result = await db.execute(
                select(User).where(User.telegram_id == callback.from_user.id)
            )
            user = user_result.scalar_one_or_none()
            
            if not user:
                await callback.answer("اول /start رو بفرست.", show_alert=True)
                return

            file = (await db.execute(owned_file(file_id, callback.from_user.id))).scalar_one_or_none()
            if file is None:
                await callback.answer("فایل پیدا نشد.", show_alert=True)
                return
            
            # Get folders
            folders_result = await db.execute(
                select(Folder).where(Folder.user_id == user.id).order_by(Folder.name)
            )
            folders = folders_result.scalars().all()
            targets = [(folder, await folder_path(db, folder)) for folder in folders]
        
        if not folders:
            await callback.answer("هنوز کشویی نداری؛ با /newfolder یکی بساز.", show_alert=True)
            return
        
        page = min(max(page, 0), max(0, (len(targets) - 1) // PAGE_SIZE))
        buttons = [[InlineKeyboardButton(f"🗃️ {path[:40]}", callback_data=f"moveto:{file_id}:{folder.id}")] for folder, path in targets[page * PAGE_SIZE:(page + 1) * PAGE_SIZE]]
        if len(targets) > PAGE_SIZE:
            buttons.append(pagination_row(f"move:{file_id}", page, len(targets)))
        buttons.append([InlineKeyboardButton("📦 بیرون از کشو", callback_data=f"moveto:{file_id}:0")])
        buttons.append([InlineKeyboardButton("↩️ بازگشت", callback_data=f"openfile:{file_id}")])
        
        await callback.message.edit_reply_markup(InlineKeyboardMarkup(buttons))
        await callback.answer()
        
    elif data.startswith("moveto:"):
        _, file_id, folder_id = data.split(":")
        file_id = int(file_id)
        folder_id = int(folder_id) if folder_id != "0" else None
        
        async with async_session() as db:
            result = await db.execute(owned_file(file_id, callback.from_user.id))
            file = result.scalar_one_or_none()
            if folder_id is not None:
                folder = (await db.execute(owned_folder(folder_id, callback.from_user.id))).scalar_one_or_none()
                if folder is None:
                    await callback.answer("کشو پیدا نشد.", show_alert=True)
                    return
            
            if file:
                file.folder_id = folder_id
                await db.commit()
                await db.refresh(file)
                await callback.message.edit(file_detail_text(file), reply_markup=file_detail_keyboard_for_user(file, callback.from_user.id))
                await callback.answer("فایل با موفقیت منتقل شد.")
            else:
                await callback.answer("فایل پیدا نشد.", show_alert=True)
                
    # ============== New File Management Callbacks ==============
    
    elif data.startswith("renamefile:"):
        file_id = int(data.split(":")[1])
        
        async with async_session() as db:
            result = await db.execute(owned_file(file_id, callback.from_user.id))
            file = result.scalar_one_or_none()
            
            if not file:
                await callback.answer("فایل پیدا نشد.", show_alert=True)
                return
            
            current_name = file.file_name
        
        pending_input_chats.add(callback.message.chat.id)
        prompt = await callback.message.reply(
            f"✏️ اسم فعلی: {display_filename(current_name)}\nاسم جدید رو بفرست.",
            reply_markup=input_keyboard(),
        )
        await callback.answer()
        reply = None
        try:
            reply, action = await wait_for_input(client, callback.message.chat.id, timeout=60)
            
            if action == "cancel" or (reply and reply.text and reply.text.startswith("/cancel")):
                await callback.message.edit(file_detail_text(file), reply_markup=file_detail_keyboard_for_user(file, callback.from_user.id))
                return
            
            new_name = reply.text.strip() if reply.text else None
            
            if not new_name or len(new_name) > 255:
                await callback.message.edit("❌ اسم فایل باید بین ۱ تا ۲۵۵ نویسه باشه.", reply_markup=file_detail_keyboard_for_user(file, callback.from_user.id))
                return
            
            async with async_session() as db:
                result = await db.execute(owned_file(file_id, callback.from_user.id))
                file = result.scalar_one_or_none()
                
                if file:
                    file.file_name = sanitize_filename(new_name)
                    await db.commit()
                    await db.refresh(file)
                    await callback.message.edit(
                        f"✅ اسم فایل به «{display_filename(file.file_name)}» تغییر کرد.\n\n{file_detail_text(file)}",
                        reply_markup=file_detail_keyboard_for_user(file, callback.from_user.id),
                    )
                else:
                    await callback.message.edit("❌ فایل پیدا نشد.", reply_markup=main_menu_keyboard(callback.from_user.id))
                    
        except Exception as e:
            if "timeout" in str(e).lower():
                await callback.message.edit("⏱ وقت تغییر نام تموم شد؛ دوباره تلاش کن.", reply_markup=main_menu_keyboard(callback.from_user.id))
        finally:
            pending_input_chats.discard(callback.message.chat.id)
            await safe_delete(prompt)
            await safe_delete(reply)
    
    elif data.startswith("delfile:"):
        file_id = int(data.split(":")[1])
        
        async with async_session() as db:
            result = await db.execute(owned_file(file_id, callback.from_user.id))
            file = result.scalar_one_or_none()
            
            if not file:
                await callback.answer("فایل پیدا نشد.", show_alert=True)
                return
                
            file_name = file.file_name
        
        # Ask for confirmation
        await callback.message.edit(
            f"🗑️ فایل «{display_filename(file_name)}» پاک بشه؟\nاین کار برگشت‌پذیر نیست.",
            reply_markup=InlineKeyboardMarkup([
                [
                    InlineKeyboardButton("🗑️ حذف فایل", callback_data=f"confirmdelfile:{file_id}", style=enums.ButtonStyle.DANGER),
                    InlineKeyboardButton("✖️ انصراف", callback_data=f"openfile:{file_id}"),
                ]
            ])
        )
        await callback.answer()
        
    elif data.startswith("confirmdelfile:"):
        file_id = int(data.split(":")[1])
        
        async with async_session() as db:
            result = await db.execute(owned_file(file_id, callback.from_user.id))
            file = result.scalar_one_or_none()
            
            if not file:
                await callback.answer("فایل پیدا نشد.", show_alert=True)
                return
            
            file_name = file.file_name
            channel_msg_id = file.channel_message_id
            
            if not await delete_from_storage_channel(channel_msg_id):
                await callback.answer("فایل از فضای ذخیره‌سازی پاک نشد؛ دوباره تلاش کن.", show_alert=True)
                return
            await db.delete(file)
            await db.commit()
        
        back_target = detail_back_targets.get(callback.from_user.id, "files:0")
        back_label = "↩️ نتایج جست‌وجو" if back_target.startswith("search:") else "↩️ فایل‌ها"
        await callback.message.edit(f"✅ فایل «{display_filename(file_name)}» حذف شد.", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton(back_label, callback_data=back_target), InlineKeyboardButton("🚪 منوی اصلی", callback_data="home")]]))
        await callback.answer("فایل حذف شد.")
        
    elif data.startswith("renamefolder:"):
        folder_id = int(data.split(":")[1])
        
        async with async_session() as db:
            result = await db.execute(owned_folder(folder_id, callback.from_user.id))
            folder = result.scalar_one_or_none()
            
            if not folder:
                await callback.answer("کشو پیدا نشد.", show_alert=True)
                return
            
            current_name = folder.name
        
        pending_input_chats.add(callback.message.chat.id)
        prompt = await callback.message.reply(
            f"✏️ نام فعلی: {escape_markdown(current_name)}\nنام جدید رو بفرست.",
            reply_markup=input_keyboard(),
        )
        await callback.answer()
        reply = None
        try:
            reply, action = await wait_for_input(client, callback.message.chat.id, timeout=60)
            
            if action == "cancel" or (reply and reply.text and reply.text.startswith("/cancel")):
                await render_folder_page(callback.message, callback.from_user.id, folder_id)
                return
            
            new_name = reply.text.strip() if reply.text else None
            
            if not new_name or len(new_name) > 255:
                await callback.message.edit("❌ اسم کشو باید بین ۱ تا ۲۵۵ نویسه باشه.", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("↩️ بازگشت", callback_data=f"folder_actions:{folder_id}")]]))
                return
            
            async with async_session() as db:
                result = await db.execute(owned_folder(folder_id, callback.from_user.id))
                folder = result.scalar_one_or_none()
                
                if folder:
                    duplicate = (await db.execute(select(Folder.id).where(
                        Folder.user_id == folder.user_id, Folder.parent_id == folder.parent_id,
                        Folder.name == new_name, Folder.id != folder_id
                    ))).scalar_one_or_none()
                    if duplicate is not None:
                        await callback.message.edit("❌ کشویی با همین نام در این محل هست.", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("↩️ بازگشت", callback_data=f"folder_actions:{folder_id}")]]))
                        return
                    folder.name = new_name
                    await db.commit()
                    await callback.message.edit(
                        f"✅ نام کشو به «{new_name}» تغییر کرد.",
                        reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🗃️ باز کردن کشو", callback_data=f"folder:{folder_id}:0")], [InlineKeyboardButton("🚪 منوی اصلی", callback_data="home")]]),
                    )
                else:
                    await callback.message.edit("❌ کشو پیدا نشد.", reply_markup=main_menu_keyboard(callback.from_user.id))
                    
        except Exception as e:
            if "timeout" in str(e).lower():
                await callback.message.edit("⏱ وقت تغییر نام تموم شد؛ دوباره تلاش کن.", reply_markup=main_menu_keyboard(callback.from_user.id))
        finally:
            pending_input_chats.discard(callback.message.chat.id)
            await safe_delete(prompt)
            await safe_delete(reply)
    
    elif data.startswith("delfolder:"):
        folder_id = int(data.split(":")[1])
        
        async with async_session() as db:
            result = await db.execute(owned_folder(folder_id, callback.from_user.id))
            folder = result.scalar_one_or_none()
            
            if not folder:
                await callback.answer("کشو پیدا نشد.", show_alert=True)
                return
            
            folder_name = folder.name
            
        text = (
            f"🗑 **حذف کشوی {folder_name}**\n\n"
            "با محتواش چی کار کنیم؟\n"
            "📁 نگه‌داشتن: فایل‌ها و زیرکشوها یه سطح بالاتر می‌رن.\n"
            "🗑️ حذف کامل: همهٔ محتوا هم پاک می‌شه."
        )
        
        await callback.message.edit(
            text,
            reply_markup=InlineKeyboardMarkup([
                [
                     InlineKeyboardButton("📁 نگه‌داشتن محتوا", callback_data=f"confirmdelfolder:{folder_id}:keep"),
                ],
                [InlineKeyboardButton("🗑️ حذف کامل", callback_data=f"confirmdelfolder:{folder_id}:delete")],
                [InlineKeyboardButton("✖️ انصراف", callback_data=f"folder_actions:{folder_id}")]
            ])
        )
        await callback.answer()
        
    elif data.startswith("confirmdelfolder:"):
        parts = data.split(":")
        folder_id = int(parts[1])
        mode = parts[2] if len(parts) > 2 else "keep"
        if mode not in ("keep", "delete"):
            await callback.answer("گزینهٔ حذف درست نیست.", show_alert=True)
            return
        
        async with async_session() as db:
            result = await db.execute(owned_folder(folder_id, callback.from_user.id))
            folder = result.scalar_one_or_none()
            
            if not folder:
                await callback.answer("کشو پیدا نشد.", show_alert=True)
                return
            
            folder_name = folder.name
            
            from fastapi import HTTPException
            from .routers.folders import delete_folder_contents
            try:
                await delete_folder_contents(db, folder, mode == "delete")
                await db.commit()
            except HTTPException:
                await db.rollback()
                await callback.answer("محتوا از فضای ذخیره‌سازی پاک نشد؛ دوباره تلاش کن.", show_alert=True)
                return
        
        await callback.message.edit(f"✅ کشوی «{folder_name}» حذف شد.", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🗄️ بازگشت به کمد", callback_data="folders:0:0"), InlineKeyboardButton("🚪 منوی اصلی", callback_data="home")]]))
        await callback.answer("کشو حذف شد.")
    
    elif data.startswith("sharefile:"):
        file_id = int(data.split(":")[1])
        
        async with async_session() as db:
            # Verify ownership
            user_result = await db.execute(
                select(User).where(User.telegram_id == callback.from_user.id)
            )
            user = user_result.scalar_one_or_none()
            
            if not user:
                await callback.answer("اول /start رو بفرست.", show_alert=True)
                return
            
            result = await db.execute(
                select(File).where(File.id == file_id, File.user_id == user.id)
            )
            file = result.scalar_one_or_none()
            
            if not file:
                await callback.answer("فایل پیدا نشد.", show_alert=True)
                return
            
            # Generate public hash
            file.public_hash = secrets.token_hex(16)
            await db.commit()
            await db.refresh(file)
            
            public_url = f"{settings.web_base_url}/api/stream/s/{file.public_hash}"
        
        await callback.message.edit(
            f"{file_detail_text(file)}\n\n🔗 **لینک عمومی**\n{public_url}",
            reply_markup=file_detail_keyboard_for_user(file, callback.from_user.id),
        )
        await callback.answer("لینک عمومی ساخته شد.")
    
    elif data.startswith("unsharefile:"):
        file_id = int(data.split(":")[1])
        
        async with async_session() as db:
            # Verify ownership
            user_result = await db.execute(
                select(User).where(User.telegram_id == callback.from_user.id)
            )
            user = user_result.scalar_one_or_none()
            
            if not user:
                await callback.answer("اول /start رو بفرست.", show_alert=True)
                return
            
            result = await db.execute(
                select(File).where(File.id == file_id, File.user_id == user.id)
            )
            file = result.scalar_one_or_none()
            
            if not file:
                await callback.answer("فایل پیدا نشد.", show_alert=True)
                return
            if not file.public_hash:
                await callback.answer("این فایل لینک عمومی فعالی ندارد.", show_alert=True)
                await callback.message.edit(file_detail_text(file), reply_markup=file_detail_keyboard_for_user(file, callback.from_user.id))
                return
            
            file.public_hash = None
            await db.commit()
            await db.refresh(file)
        await callback.message.edit(
            f"✅ لینک عمومی غیرفعال شد.\n\n{file_detail_text(file)}",
            reply_markup=file_detail_keyboard_for_user(file, callback.from_user.id),
        )
        await callback.answer("اشتراک لغو شد.")
    
    elif data == "canceldel":
        await callback.message.edit("حذف لغو شد.", reply_markup=main_menu_keyboard(callback.from_user.id))
        await callback.answer()


# ============== File Action Command ==============

@tg_client.on_message(filters.command("file") & filters.private)
async def file_command(client, message: Message):
    """Manage a specific file by ID."""
    if len(message.command) < 2:
        await message.reply("شناسهٔ فایل رو بعد از دستور بنویس؛ نمونه: `/file 12`.")
        return
    
    try:
        file_id = int(message.command[1])
    except ValueError:
        await message.reply("❌ شناسهٔ فایل درست نیست.")
        return
    
    async with async_session() as db:
        # Get user
        user_result = await db.execute(
            select(User).where(User.telegram_id == message.from_user.id)
        )
        user = user_result.scalar_one_or_none()
        
        if not user:
            await message.reply("اول /start رو بفرست.")
            return
        
        # Get file
        result = await db.execute(
            select(File).where(File.id == file_id, File.user_id == user.id)
        )
        file = result.scalar_one_or_none()
    
    if not file:
        await message.reply("❌ فایل پیدا نشد یا بهش دسترسی نداری.")
        return
    text = file_detail_text(file)
    if file.public_hash:
        public_url = f"{settings.web_base_url}/api/stream/s/{file.public_hash}"
        text += f"\n🔗 لینک عمومی:\n{public_url}\n"
    detail_back_targets[message.from_user.id] = "files:0"
    await message.reply(text, reply_markup=file_detail_keyboard(file))


@tg_client.on_message(filters.command("deletefolder") & filters.private)
async def deletefolder_command(client, message: Message):
    """Delete a folder by name."""
    if len(message.command) < 2:
        await message.reply("روش استفاده: /deletefolder نام‌کشو")
        return
    
    folder_name = " ".join(message.command[1:])
    
    async with async_session() as db:
        # Get user
        user_result = await db.execute(
            select(User).where(User.telegram_id == message.from_user.id)
        )
        user = user_result.scalar_one_or_none()
        
        if not user:
            await message.reply("اول /start رو بفرست.")
            return
        
        # Find folder
        result = await db.execute(
            select(Folder).where(
                Folder.user_id == user.id,
                Folder.name == folder_name
            ).limit(2)
        )
        matches = result.scalars().all()
        folder = matches[0] if len(matches) == 1 else None
    if len(matches) > 1:
        await message.reply("چند کشو با این اسم داری؛ برای انتخاب دقیق، /folders رو باز کن.")
        return
    
    if not folder:
        await message.reply(f"❌ کشوی «{folder_name}» پیدا نشد.")
        return
    
    # Show confirmation
    await message.reply(
        f"🗑 حذف کشوی «{folder_name}»؟\n\n"
        "محتوا بمونه یا همه‌چیز پاک بشه؟",
        reply_markup=InlineKeyboardMarkup([
            [
                InlineKeyboardButton("📁 نگه‌داشتن محتوا", callback_data=f"confirmdelfolder:{folder.id}:keep"),
            ],
            [InlineKeyboardButton("🗑️ حذف کامل", callback_data=f"confirmdelfolder:{folder.id}:delete")],
            [InlineKeyboardButton("✖️ انصراف", callback_data="canceldel")],
        ])
    )
