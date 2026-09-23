"""
Telegram Bot handlers using PyroTGFork MTProto.
Handles commands, file uploads, and inline callbacks.
"""

import secrets
import string
import re
import asyncio
import contextlib
from datetime import datetime, timedelta, timezone
from pyrogram import filters
from pyrogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
from sqlalchemy import select, or_

from .telegram import tg_client, forward_to_storage_channel, delete_from_storage_channel
from .database import async_session
from .models import User, File, Folder, LoginCode
from .config import get_settings
from .auth import create_access_token
from .services import escape_like

settings = get_settings()
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
            prefix = f"{current[0] + 1}. {'↑' if current[1] == 'asc' else '↓'} " if current else ""
            row.append(InlineKeyboardButton(f"{prefix}{SORT_LABELS[field]}", callback_data=f"sort_toggle:{field}"))
        buttons.append(row)
    buttons.extend([
        [InlineKeyboardButton("اعمال مرتب‌سازی", callback_data="sort_apply"), InlineKeyboardButton("پیش‌فرض", callback_data="sort_default")],
        [InlineKeyboardButton("لغو", callback_data="sort_cancel")],
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


def format_size(size_bytes: int) -> str:
    """Format bytes to human readable size."""
    for unit in ['B', 'KB', 'MB', 'GB']:
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} TB"


def format_duration(seconds: int) -> str:
    """Format seconds to human readable duration."""
    if not seconds:
        return ""
    hours, remainder = divmod(seconds, 3600)
    minutes, secs = divmod(remainder, 60)
    if hours:
        return f"{hours}h {minutes}m"
    return f"{minutes}m {secs}s"


def to_persian_digits(value: str) -> str:
    return value.translate(str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹"))


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


def get_web_app_button(telegram_id: int, text: str = "🌐 Open Web") -> InlineKeyboardButton:
    """Use a Mini App for HTTPS; local HTTP needs the code login flow."""
    if not settings.web_base_url.startswith("https://"):
        return InlineKeyboardButton(text, callback_data="get_web_link")
    from urllib.parse import quote
    token = create_access_token(telegram_id)
    encoded_token = quote(token, safe='')
    web_url = f"{settings.web_base_url}/auth?token={encoded_token}"
    return InlineKeyboardButton(text, web_app=WebAppInfo(url=web_url))


def local_web_instructions() -> str:
    return (
        "🌐 **نسخهٔ وب کمد**\n\n"
        f"در مرورگر همین کامپیوتر `{settings.web_base_url}` را باز کنید. "
        "کد ورود صفحه را با دستور `/login CODE` برای ربات بفرستید."
    )


async def safe_delete(message: Message | None, animate: bool = False) -> None:
    if not message:
        return
    try:
        await message.delete()
    except Exception:
        pass


async def delete_preview_later(client, chat_id: int, message_id: int) -> None:
    await asyncio.sleep(PREVIEW_TTL_SECONDS)
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
    row.append(InlineKeyboardButton(f"{page + 1} از {pages}", callback_data="noop"))
    if page + 1 < pages:
        row.append(InlineKeyboardButton("بعدی ▶️", callback_data=f"{prefix}:{page + 1}"))
    return row


def file_list_button(file: File, telegram_id: int) -> InlineKeyboardButton:
    selected = file.id in batch_selections.get(telegram_id, set())
    label = f"{'✅ ' if selected else ''}{FILE_ICONS.get(file.file_type, '📎')} {file.file_name[:38]}"
    callback_data = f"batch_toggle:{file.id}" if telegram_id in batch_return_targets else f"openfile:{file.id}"
    return InlineKeyboardButton(label, callback_data=callback_data)


def list_action_rows(telegram_id: int, target: str) -> list[list[InlineKeyboardButton]]:
    if telegram_id in batch_return_targets:
        count = len(batch_selections.get(telegram_id, set()))
        return [
            [InlineKeyboardButton(f"انتخاب‌شده‌ها: {count}", callback_data="noop")],
            [InlineKeyboardButton("🗃️ انتقال", callback_data="batch_move:0"), InlineKeyboardButton("✏️ ویرایش", callback_data="batch_edit")],
            [InlineKeyboardButton("🗑 حذف", callback_data="batch_delete"), InlineKeyboardButton("لغو انتخاب", callback_data="batch_cancel")],
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
    detail_back_targets[telegram_id] = f"folders:{parent_id or 0}:{page}"
    selected_types = library_filters.get(telegram_id, set())
    async with async_session() as db:
        user = (await db.execute(select(User).where(User.telegram_id == telegram_id))).scalar_one_or_none()
        if not user:
            await message.edit("برای شروع، دستور /start را بفرستید.")
            return
        parent = (await db.execute(owned_folder(parent_id, telegram_id))).scalar_one_or_none() if parent_id else None
        if parent_id and not parent:
            await message.edit("این کشو دیگر وجود ندارد.", reply_markup=main_menu_keyboard(telegram_id))
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

    if parent_id is None:
        items = [("root", root_file_count)] + sort_library_items([("folder", item) for item in folders], telegram_id)
    else:
        items = sort_library_items([("folder", item) for item in folders] + [("file", item) for item in files], telegram_id)
    total = len(items)
    max_page = max(0, (total - 1) // PAGE_SIZE)
    page = min(max(page, 0), max_page)
    current_items = items[page * PAGE_SIZE:(page + 1) * PAGE_SIZE]
    buttons = []
    for kind, item in current_items:
        if kind == "root":
            buttons.append([InlineKeyboardButton(f"📦 فایل‌های بیرون از کشو ({item})", callback_data="rootfiles:0")])
        elif kind == "folder":
            buttons.append([InlineKeyboardButton(f"🗃️ {item.name[:40]}", callback_data=f"folder:{item.id}:0")])
        else:
            buttons.append([file_list_button(item, telegram_id)])
    if total > PAGE_SIZE:
        buttons.append(pagination_row(f"folders:{parent_id or 0}", page, total))
    if parent_id is None and telegram_id not in batch_return_targets:
        buttons.append([InlineKeyboardButton("↕️ مرتب‌سازی کشوها", callback_data=f"sort_open:folders:0:{page}")])
    else:
        buttons.extend(list_action_rows(telegram_id, f"folders:{parent_id or 0}:{page}"))
    if parent:
        buttons.extend([
            [InlineKeyboardButton("➕ ساخت زیرکشو", callback_data=f"create_folder:{parent.id}"),
             InlineKeyboardButton("✏️ ویرایش کشو", callback_data=f"folder_actions:{parent.id}")],
            [InlineKeyboardButton("☑️ انتخاب نوع", callback_data=f"library_filter:folders:{parent.id}"),
             InlineKeyboardButton("↩️ کشوی قبلی", callback_data=f"folders:{parent.parent_id or 0}:0")],
            [InlineKeyboardButton("🚪 منوی اصلی", callback_data="home")],
        ])
    else:
        buttons.extend([
            [InlineKeyboardButton("➕ ساخت کشو", callback_data="create_folder"),
             InlineKeyboardButton("☑️ انتخاب نوع", callback_data="library_filter:folders:0")],
            [InlineKeyboardButton("🔍 بگرد تو کمد", callback_data="search_choose")],
            [InlineKeyboardButton("🚪 منوی اصلی", callback_data="home")],
        ])
    if parent:
        text = f"🗃️ **{path}**\n{len(folders)} کشو · {len(files)} فایل"
    else:
        text = f"🗄️ **کشوهای کمد**\n{len(folders)} کشو · {root_file_count} فایل بیرون از کشو"
    if selected_types:
        text += "\n☑️ نوع‌ها: " + "، ".join(TYPE_LABELS[item] for item in sorted(selected_types))
    if parent and parent.description:
        text += f"\n\n📝 توضیحات: {escape_markdown(parent.description[:700])}"
    if not total:
        text += "\n\nاین کشو هنوز خالیه! فایلی بفرست تا بذارمش سر جاش." if parent else "\n\nکمدت هنوز کشویی نداره؛ یکی بساز تا فایل‌هات مرتب‌تر بشن."
    await message.edit(text, reply_markup=InlineKeyboardMarkup(buttons))


async def render_root_files(message: Message, telegram_id: int, page: int = 0) -> None:
    detail_back_targets[telegram_id] = f"rootfiles:{page}"
    selected_types = library_filters.get(telegram_id, set())
    async with async_session() as db:
        user = (await db.execute(select(User).where(User.telegram_id == telegram_id))).scalar_one_or_none()
        if not user:
            await message.edit("برای شروع، دستور /start را بفرستید.")
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
    buttons.extend([
        [InlineKeyboardButton("☑️ انتخاب نوع", callback_data="library_filter:rootfiles")],
        [InlineKeyboardButton("↩️ کشوهای کمد", callback_data="folders:0:0"), InlineKeyboardButton("🚪 منوی اصلی", callback_data="home")],
    ])
    text = f"📦 **فایل‌های بیرون از کشو**\n{len(files)} مورد"
    if selected_types:
        text += "\n☑️ نوع‌ها: " + "، ".join(TYPE_LABELS[item] for item in sorted(selected_types))
    if not files:
        text += "\n\nفایلی با این فیلتر پیدا نشد."
    await message.edit(text, reply_markup=InlineKeyboardMarkup(buttons))


async def render_recent_files(message: Message, telegram_id: int, page: int = 0) -> None:
    detail_back_targets[telegram_id] = f"files:{page}"
    selected_types = library_filters.get(telegram_id, set())
    async with async_session() as db:
        user = (await db.execute(select(User).where(User.telegram_id == telegram_id))).scalar_one_or_none()
        if not user:
            await message.edit("برای شروع، دستور /start را بفرستید.")
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
    buttons.extend([[InlineKeyboardButton("☑️ انتخاب نوع", callback_data="library_filter:files"), InlineKeyboardButton("🔍 بگرد تو کمد", callback_data="search_choose")], [InlineKeyboardButton("🗄️ کشوها", callback_data="folders:0:0"), InlineKeyboardButton("🚪 منوی اصلی", callback_data="home")]])
    text = "🗃️ **فایل‌های داخل کشو**"
    if selected_types:
        text += "\n☑️ نوع‌ها: " + "، ".join(TYPE_LABELS[item] for item in sorted(selected_types))
    if not files:
        text += "\n\nهنوز چیزی ذخیره نکرده‌اید. فایل، عکس یا متن بفرستید."
    await message.edit(text, reply_markup=InlineKeyboardMarkup(buttons))


def type_filter_keyboard(selected: set[str], context: str, include_folder: bool = False) -> InlineKeyboardMarkup:
    types = ["video", "audio", "image", "text", "document"] + (["folder"] if include_folder else [])
    buttons = []
    for index in range(0, len(types), 2):
        row = []
        for item in types[index:index + 2]:
            icon = "🗃️" if item == "folder" else FILE_ICONS[item]
            mark = "✅ " if item in selected else ""
            row.append(InlineKeyboardButton(f"{mark}{icon} {TYPE_LABELS[item]}", callback_data=f"{context}_filter_toggle:{item}"))
        buttons.append(row)
    buttons.append([InlineKeyboardButton("همهٔ موارد", callback_data=f"{context}_filter_all"), InlineKeyboardButton("پاک‌کردن انتخاب‌ها", callback_data=f"{context}_filter_clear")])
    apply_label = "ادامه" if context == "search" else "اعمال"
    buttons.append([InlineKeyboardButton(apply_label, callback_data=f"{context}_filter_apply"), InlineKeyboardButton("لغو", callback_data=f"{context}_filter_cancel")])
    return InlineKeyboardMarkup(buttons)


def search_type_keyboard(telegram_id: int | None = None) -> InlineKeyboardMarkup:
    selected = search_filters.get(telegram_id, set()) if telegram_id is not None else set()
    return type_filter_keyboard(selected, "search", include_folder=True)


async def render_search_results(message: Message, telegram_id: int, page: int = 0) -> None:
    query = search_queries.get(telegram_id, "").strip()
    selected_types = search_filters.get(telegram_id, set())
    file_types = selected_types.intersection(FILE_ICONS)
    include_files = not selected_types or bool(file_types)
    include_folders = not selected_types or "folder" in selected_types
    if not query:
        await message.edit("عبارت جست‌وجو در دسترس نیست. دوباره جست‌وجو کنید.", reply_markup=main_menu_keyboard(telegram_id))
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
    buttons.extend([
        [InlineKeyboardButton("🔍 عبارت تازه", callback_data="search_again"), InlineKeyboardButton("☑️ تغییر نوع‌ها", callback_data="search_refine")],
        [InlineKeyboardButton("🚪 منوی اصلی", callback_data="home")],
    ])
    selected_label = "همهٔ موارد" if not selected_types else "، ".join(TYPE_LABELS[item] for item in sorted(selected_types))
    text = f"🔍 **نتایج «{escape_markdown(query)}»**\nنوع‌ها: {selected_label} · {len(items)} مورد"
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
    text = f"{FILE_ICONS.get(file.file_type, '📎')} **{escape_markdown(file.file_name)}**\n📦 حجم: {format_size(file.file_size)}"
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
        [InlineKeyboardButton("✏️ تغییر نام", callback_data=f"renamefile:{file.id}"),
         InlineKeyboardButton("🗃️ انتقال", callback_data=f"move:{file.id}")],
        description_row,
        [share_button],
        [InlineKeyboardButton("🗑 حذف", callback_data=f"delfile:{file.id}"),
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
    "🗃️ کشوها می‌تونن چندلایه باشن و هر کدوم اسم و توضیحات خودشون رو داشته باشن.\n\n"
    "روی هر فایل یا کشو بزن تا گزینه‌های دیدن، ویرایش، انتقال، اشتراک و حذف رو ببینی ✨"
)


def main_menu_keyboard(telegram_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("📦 فایل‌های من", callback_data="files:0"),
         InlineKeyboardButton("🗄️ کشوهای من", callback_data="folders:0:0")],
        [InlineKeyboardButton("🔍 بگرد تو کمد", callback_data="search_choose"),
         InlineKeyboardButton("➕ کشوی تازه", callback_data="create_folder")],
        [get_web_app_button(telegram_id, "✨ نسخهٔ وب")],
        [InlineKeyboardButton("💡 راهنمای من", callback_data="show_help")],
    ])


def recent_files_view(files: list[File], telegram_id: int) -> tuple[str, InlineKeyboardMarkup]:
    if not files:
        return "📭 کمد هنوز خالی است. یک فایل، عکس یا پیام متنی بفرستید.", main_menu_keyboard(telegram_id)
    icons = {"video": "🎬", "audio": "🎵", "document": "📄", "image": "🖼", "text": "📝"}
    buttons = [
        [InlineKeyboardButton(f"{icons.get(file.file_type, '📎')} {file.file_name[:36]}", callback_data=f"openfile:{file.id}")]
        for file in files
    ]
    buttons.append([InlineKeyboardButton("🗄️ کشوها", callback_data="back_folders"),
                    get_web_app_button(telegram_id, "🌐 نسخهٔ وب")])
    return "📁 **موارد اخیر**\nبرای دیدن جزئیات و مدیریت، روی هر مورد بزنید.", InlineKeyboardMarkup(buttons)

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
                "🚫 **دسترسی محدود است**\n\n"
                "این ربات فقط برای کاربران مجاز فعال است.\n"
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
                     await message.reply("⚠️ این کد قبلاً استفاده شده است.")
                     return
                else:
                     await message.reply("❌ اعتبار این کد تمام شده است.")
                     return

    await message.reply(
        f"👋 **سلام {message.from_user.first_name or 'رفیق'}! به کمدت خوش اومدی 🗄️**\n\n"
        "اینجا می‌تونی 🎬 فیلم، 🎵 آهنگ، 🖼 عکس، 📄 سند و 📝 متن‌هات رو یک‌جا نگه داری. "
        "هرچی بفرستی برات ذخیره می‌کنم و کپشنش هم به‌عنوان توضیحات کنار فایل می‌مونه 😉\n\n"
        "آماده‌ای کمدتو بچینیم؟ از یکی از گزینه‌های پایین شروع کن 👇",
        reply_markup=main_menu_keyboard(message.from_user.id),
    )


@tg_client.on_message(filters.command("help") & filters.private)
async def help_command(client, message: Message):
    """Show help message."""
    await message.reply(HELP_TEXT, reply_markup=main_menu_keyboard(message.from_user.id))


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


@tg_client.on_message(filters.command("newfolder") & filters.private)
async def newfolder_command(client, message: Message):
    """Create a new folder."""
    if len(message.command) < 2:
        await message.reply("نام کشو را بعد از دستور بنویسید؛ نمونه: `/newfolder فیلم‌ها`.")
        return
    
    folder_name = " ".join(message.command[1:]).strip()
    if not folder_name or len(folder_name) > 255:
        await message.reply("نام کشو باید بین ۱ تا ۲۵۵ نویسه باشد.")
        return
    
    async with async_session() as db:
        # Get user
        user_result = await db.execute(
            select(User).where(User.telegram_id == message.from_user.id)
        )
        user = user_result.scalar_one_or_none()
        
        if not user:
            await message.reply("برای شروع، دستور /start را بفرستید.")
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
            await message.reply(f"❌ کشویی با نام «{folder_name}» در این محل وجود دارد.")
            return
        
        # Create folder
        folder = Folder(user_id=user.id, name=folder_name)
        db.add(folder)
        await db.commit()
    
    await message.reply(
        f"✅ کشوی «{folder_name}» ساخته شد.",
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("🗃️ باز کردن کشو", callback_data=f"folder:{folder.id}:0")],
            [InlineKeyboardButton("✏️ تغییر نام", callback_data=f"renamefolder:{folder.id}"),
             InlineKeyboardButton("🗑 حذف", callback_data=f"delfolder:{folder.id}")],
            [InlineKeyboardButton("📝 افزودن توضیحات", callback_data=f"folderdesc:{folder.id}")],
            [InlineKeyboardButton("🚪 منوی اصلی", callback_data="home")],
        ]),
    )


@tg_client.on_message(filters.command("search") & filters.private)
async def search_command(client, message: Message):
    """Search file names and descriptions."""
    query = " ".join(message.command[1:]).strip()
    if not query:
        await message.reply("🔎 عبارت را بعد از دستور بنویسید؛ نمونه: `/search سفر`.")
        return
    search_queries[message.from_user.id] = query[:100]
    search_filters[message.from_user.id] = set()
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
        "با دکمهٔ زیر باز کنید یا لینک را در مرورگر خود باز کنید. این لینک را در اختیار دیگران نگذارید.\n"
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
                await message.reply("❌ کد معتبر نیست. کد روی دستگاه را بررسی کنید.")
                return
            
            if login_code.expires_at < datetime.utcnow():
                await message.reply("❌ اعتبار کد تمام شده است. کد جدید بسازید.")
                return
                
            if login_code.telegram_id:
                await message.reply("❌ این کد قبلاً استفاده شده است.")
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
        "این کد را در صفحهٔ ورود وارد کنید. اعتبار: ۵ دقیقه."
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
        "⚠️ از همهٔ دستگاه‌ها خارج شوید؟\nنشست نسخهٔ وب و دستگاه‌های متصل باطل می‌شود.",
        reply_markup=InlineKeyboardMarkup([
            [
                InlineKeyboardButton("✅ خروج از همه", callback_data="logout_all_confirm"),
                InlineKeyboardButton("انصراف", callback_data="logout_all_cancel")
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
            f"{emoji} **{file_info['file_name']}**\n"
            f"📦 {format_size(file_info['file_size'])}\n"
        )
        
        if file_info['duration']:
            response += f"⏱ {format_duration(file_info['duration'])}\n"
        response += "\nاز دکمه‌ها برای مدیریت فایل استفاده کنید."
        
        if file.description:
            response += f"\n📝 {escape_markdown(file.description[:250])}"
        detail_back_targets[message.from_user.id] = "files:0"
        await status_msg.edit(response, reply_markup=file_detail_keyboard(file))
        
    except Exception as e:
        await status_msg.edit("❌ ذخیرهٔ فایل ناموفق بود. دوباره تلاش کنید.")


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
    try:
        stored = await forward_to_storage_channel(message)
        title = sanitize_filename(content.strip().splitlines()[0][:80])
        async with async_session() as db:
            note = File(
                user_id=user.id, channel_message_id=stored.id,
                file_id=f"text:{stored.id}", file_unique_id=f"text:{stored.id}",
                file_name=title, file_size=len(content.encode("utf-8")),
                mime_type="text/plain; charset=utf-8", file_type="text",
            )
            db.add(note)
            await db.commit()
            await db.refresh(note)
        detail_back_targets[message.from_user.id] = "files:0"
        await message.reply(
            f"📝 در کمد ذخیره شد: {title}",
            reply_markup=file_detail_keyboard(note),
        )
    except Exception:
        await message.reply("❌ ذخیرهٔ متن ناموفق بود. دوباره تلاش کنید.")


# ============== Callback Query Handlers ==============

@tg_client.on_callback_query()
async def handle_callback(client, callback: CallbackQuery):
    """Handle inline button callbacks."""
    if settings.auth_users and callback.from_user.id not in settings.auth_users:
        await callback.answer("دسترسی به این ربات مجاز نیست.", show_alert=True)
        return
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
        target = sort_return_targets.pop(callback.from_user.id, "files:0")
        sort_drafts.pop(callback.from_user.id, None)
        await render_list_target(callback.message, callback.from_user.id, target)
        await callback.answer("مرتب‌سازی اعمال شد." if data == "sort_apply" else "تغییری اعمال نشد.")

    elif data.startswith("batch_start:"):
        target = data.split(":", 1)[1]
        batch_return_targets[callback.from_user.id] = target
        batch_selections[callback.from_user.id] = set()
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
        target = batch_return_targets.get(callback.from_user.id, "files:0")
        await render_list_target(callback.message, callback.from_user.id, target)
        await callback.answer("انتخاب شد." if file_id in selected else "از انتخاب خارج شد.")

    elif data == "batch_cancel":
        target = batch_return_targets.pop(callback.from_user.id, "files:0")
        batch_selections.pop(callback.from_user.id, None)
        await render_list_target(callback.message, callback.from_user.id, target)
        await callback.answer("انتخاب گروهی بسته شد.")

    elif data == "batch_delete":
        count = len(batch_selections.get(callback.from_user.id, set()))
        if not count:
            await callback.answer("اول حداقل یک فایل انتخاب کن.", show_alert=True)
            return
        await callback.message.edit(
            f"🗑 **حذف {count} فایل**\nاین فایل‌ها از کمد و کانال ذخیره‌سازی حذف می‌شن. مطمئنی؟",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("بله، حذف شوند", callback_data="batch_delete_confirm")],
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
        await render_list_target(callback.message, callback.from_user.id, target)
        await callback.answer(f"{len(files)} فایل حذف شد.")

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
        await render_list_target(callback.message, callback.from_user.id, return_target)
        await callback.answer(f"{len(files)} فایل منتقل شد.")

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
        await callback.answer(f"{len(files)} فایل ویرایش شد.")

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
        await callback.message.edit(
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
        await callback.message.edit_reply_markup(type_filter_keyboard(selected, "library"))
        await callback.answer()

    elif data == "library_filter_all":
        library_filters[callback.from_user.id] = set(FILE_ICONS)
        await callback.message.edit_reply_markup(type_filter_keyboard(library_filters[callback.from_user.id], "library"))
        await callback.answer("همهٔ نوع‌ها انتخاب شد.")

    elif data == "library_filter_clear":
        library_filters[callback.from_user.id] = set()
        await callback.message.edit_reply_markup(type_filter_keyboard(set(), "library"))
        await callback.answer("فیلتر پاک شد.")

    elif data in ("library_filter_apply", "library_filter_cancel"):
        if data.endswith("cancel"):
            library_filters[callback.from_user.id] = filter_previous.get((callback.from_user.id, "library"), set())
        filter_previous.pop((callback.from_user.id, "library"), None)
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
        await callback.message.edit_reply_markup(search_type_keyboard(callback.from_user.id))
        await callback.answer()

    elif data == "search_filter_all":
        search_filters[callback.from_user.id] = set(FILE_ICONS) | {"folder"}
        await callback.message.edit_reply_markup(search_type_keyboard(callback.from_user.id))
        await callback.answer("همهٔ نوع‌ها انتخاب شد.")

    elif data == "search_filter_clear":
        search_filters[callback.from_user.id] = set()
        await callback.message.edit_reply_markup(search_type_keyboard(callback.from_user.id))
        await callback.answer("بدون محدودیت جست‌وجو می‌کنم.")

    elif data == "search_filter_cancel":
        search_filters[callback.from_user.id] = filter_previous.pop((callback.from_user.id, "search"), set())
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
            await render_search_results(callback.message, callback.from_user.id)
        except Exception as exc:
            if "timeout" in str(exc).lower():
                await callback.message.reply("⏱ زمان جست‌وجو تمام شد؛ دوباره تلاش کنید.")
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
                InlineKeyboardButton("🗑 بستن پیش‌نمایش", callback_data=f"deletepreview:{preview.id}")
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
        description_row = [InlineKeyboardButton(
            "✏️ ویرایش توضیحات" if folder.description else "📝 افزودن توضیحات",
            callback_data=f"folderdesc:{folder.id}",
        )]
        if folder.description:
            description_row.append(InlineKeyboardButton("🧹 حذف توضیحات", callback_data=f"clearfolderdesc:{folder.id}"))
        await callback.message.edit(
            f"⚙️ **مدیریت کشوی {escape_markdown(folder.name)}**\n\n📝 توضیحات: {escape_markdown(folder.description) if folder.description else 'هنوز توضیحی نداره.'}",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("✏️ تغییر نام", callback_data=f"renamefolder:{folder.id}"),
                 InlineKeyboardButton("🗃️ انتقال", callback_data=f"movefolder:{folder.id}")],
                description_row,
                [InlineKeyboardButton("🗑 حذف", callback_data=f"delfolder:{folder.id}")],
                [InlineKeyboardButton("↩️ بازگشت به کشو", callback_data=f"folder:{folder.id}:0"),
                 InlineKeyboardButton("🚪 منوی اصلی", callback_data="home")],
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
                await callback.message.edit("ویرایش توضیحات لغو شد.", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("↩️ مدیریت کشو", callback_data=f"folder_actions:{folder_id}")]]))
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
                    "✅ از همهٔ دستگاه‌ها خارج شدید.",
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
                "🌐 نسخهٔ وب کمد\nلینک را خصوصی نگه دارید:\n"
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
        await callback.message.edit(HELP_TEXT, reply_markup=main_menu_keyboard(callback.from_user.id))
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
                await callback.message.edit("ساخت کشو لغو شد.", reply_markup=main_menu_keyboard(callback.from_user.id))
                return
            
            folder_name = reply.text.strip() if reply.text else None
            
            if not folder_name or len(folder_name) > 255:
                await callback.message.edit("❌ نام کشو باید بین ۱ تا ۲۵۵ نویسه باشد.", reply_markup=main_menu_keyboard(callback.from_user.id))
                return
            
            # Create folder
            async with async_session() as db:
                user_result = await db.execute(
                    select(User).where(User.telegram_id == callback.from_user.id)
                )
                user = user_result.scalar_one_or_none()
                
                if not user:
                    await callback.message.edit("برای شروع، دستور /start را بفرستید.")
                    return

                if parent_id is not None:
                    parent = (await db.execute(owned_folder(parent_id, callback.from_user.id))).scalar_one_or_none()
                    if parent is None:
                        await callback.message.edit("❌ کشوی والد دیگر وجود ندارد.", reply_markup=main_menu_keyboard(callback.from_user.id))
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
                    await callback.message.edit(f"❌ کشویی با نام «{folder_name}» در این محل وجود دارد.", reply_markup=main_menu_keyboard(callback.from_user.id))
                    return
                
                folder = Folder(user_id=user.id, parent_id=parent_id, name=folder_name)
                db.add(folder)
                await db.commit()
            
            await callback.message.edit(
                f"✅ کشوی «{folder_name}» ساخته شد.",
                reply_markup=InlineKeyboardMarkup([
                    [InlineKeyboardButton("🗃️ باز کردن", callback_data=f"folder:{folder.id}:0")],
                    [InlineKeyboardButton("✏️ تغییر نام", callback_data=f"renamefolder:{folder.id}"),
                     InlineKeyboardButton("🗑 حذف", callback_data=f"delfolder:{folder.id}")],
                    [InlineKeyboardButton("📝 افزودن توضیحات", callback_data=f"folderdesc:{folder.id}")],
                    [InlineKeyboardButton("↩️ کشوی قبلی", callback_data=f"folders:{parent_id or 0}:0"),
                     InlineKeyboardButton("🚪 منوی اصلی", callback_data="home")],
                ]),
            )
            
        except Exception as e:
            if "timeout" in str(e).lower():
                await callback.message.edit("⏱ زمان ساخت کشو تمام شد؛ دوباره تلاش کنید.", reply_markup=main_menu_keyboard(callback.from_user.id))
            else:
                await callback.message.edit("❌ ساخت کشو انجام نشد؛ دوباره تلاش کنید.", reply_markup=main_menu_keyboard(callback.from_user.id))
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
        await callback.message.edit("🗃️ مقصد کشو را انتخاب کنید:", reply_markup=InlineKeyboardMarkup(buttons))
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
                    await callback.answer("کشو را نمی‌توان داخل خودش یا زیرکشوی خودش منتقل کرد.", show_alert=True)
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
                await callback.answer("ابتدا /start را بفرستید.", show_alert=True)
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
            await callback.answer("هنوز کشویی ندارید. با /newfolder یکی بسازید.", show_alert=True)
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
            f"✏️ نام فعلی: {escape_markdown(current_name)}\nنام جدید رو بفرست.",
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
                await callback.message.edit("❌ نام فایل باید بین ۱ تا ۲۵۵ نویسه باشد.", reply_markup=file_detail_keyboard_for_user(file, callback.from_user.id))
                return
            
            async with async_session() as db:
                result = await db.execute(owned_file(file_id, callback.from_user.id))
                file = result.scalar_one_or_none()
                
                if file:
                    file.file_name = sanitize_filename(new_name)
                    await db.commit()
                    await db.refresh(file)
                    await callback.message.edit(
                        f"✅ نام فایل به «{file.file_name}» تغییر کرد.\n\n{file_detail_text(file)}",
                        reply_markup=file_detail_keyboard_for_user(file, callback.from_user.id),
                    )
                else:
                    await callback.message.edit("❌ فایل پیدا نشد.", reply_markup=main_menu_keyboard(callback.from_user.id))
                    
        except Exception as e:
            if "timeout" in str(e).lower():
                await callback.message.edit("⏱ زمان تغییر نام تمام شد؛ دوباره تلاش کنید.", reply_markup=main_menu_keyboard(callback.from_user.id))
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
            f"🗑 فایل «{file_name}» حذف شود؟\nاین کار بازگشت‌پذیر نیست.",
            reply_markup=InlineKeyboardMarkup([
                [
                    InlineKeyboardButton("🗑 حذف فایل", callback_data=f"confirmdelfile:{file_id}"),
                    InlineKeyboardButton("انصراف", callback_data=f"openfile:{file_id}"),
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
                await callback.answer("حذف فایل از فضای ذخیره‌سازی انجام نشد؛ دوباره تلاش کنید.", show_alert=True)
                return
            await db.delete(file)
            await db.commit()
        
        back_target = detail_back_targets.get(callback.from_user.id, "files:0")
        back_label = "↩️ نتایج جست‌وجو" if back_target.startswith("search:") else "↩️ فایل‌ها"
        await callback.message.edit(f"✅ فایل «{file_name}» حذف شد.", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton(back_label, callback_data=back_target), InlineKeyboardButton("🚪 منوی اصلی", callback_data="home")]]))
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
                await callback.message.edit("تغییر نام لغو شد.", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("↩️ مدیریت کشو", callback_data=f"folder_actions:{folder_id}")]]))
                return
            
            new_name = reply.text.strip() if reply.text else None
            
            if not new_name or len(new_name) > 255:
                await callback.message.edit("❌ نام کشو باید بین ۱ تا ۲۵۵ نویسه باشد.", reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("↩️ بازگشت", callback_data=f"folder_actions:{folder_id}")]]))
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
                await callback.message.edit("⏱ زمان تغییر نام تمام شد؛ دوباره تلاش کنید.", reply_markup=main_menu_keyboard(callback.from_user.id))
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
            "با محتوای آن چه کنیم؟\n"
            "📁 نگه‌داشتن: فایل‌ها و زیرکشوها یک سطح بالاتر می‌روند.\n"
            "🗑 حذف کامل: تمام محتوا هم پاک می‌شود."
        )
        
        await callback.message.edit(
            text,
            reply_markup=InlineKeyboardMarkup([
                [
                    InlineKeyboardButton("📁 نگه‌داشتن محتوا", callback_data=f"confirmdelfolder:{folder_id}:keep"),
                ],
                [InlineKeyboardButton("🗑 حذف کامل", callback_data=f"confirmdelfolder:{folder_id}:delete")],
                [InlineKeyboardButton("انصراف", callback_data=f"folder_actions:{folder_id}")]
            ])
        )
        await callback.answer()
        
    elif data.startswith("confirmdelfolder:"):
        parts = data.split(":")
        folder_id = int(parts[1])
        mode = parts[2] if len(parts) > 2 else "keep"
        if mode not in ("keep", "delete"):
            await callback.answer("گزینهٔ حذف معتبر نیست.", show_alert=True)
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
                await callback.answer("حذف محتوا از فضای ذخیره‌سازی انجام نشد؛ دوباره تلاش کنید.", show_alert=True)
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
                await callback.answer("ابتدا /start را بفرستید.", show_alert=True)
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
                await callback.answer("ابتدا /start را بفرستید.", show_alert=True)
                return
            
            result = await db.execute(
                select(File).where(File.id == file_id, File.user_id == user.id)
            )
            file = result.scalar_one_or_none()
            
            if not file:
                await callback.answer("فایل پیدا نشد.", show_alert=True)
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
        await message.reply("شناسهٔ فایل را بعد از دستور وارد کنید؛ نمونه: `/file 12`.")
        return
    
    try:
        file_id = int(message.command[1])
    except ValueError:
        await message.reply("❌ شناسهٔ فایل معتبر نیست.")
        return
    
    async with async_session() as db:
        # Get user
        user_result = await db.execute(
            select(User).where(User.telegram_id == message.from_user.id)
        )
        user = user_result.scalar_one_or_none()
        
        if not user:
            await message.reply("ابتدا /start را بفرستید.")
            return
        
        # Get file
        result = await db.execute(
            select(File).where(File.id == file_id, File.user_id == user.id)
        )
        file = result.scalar_one_or_none()
    
    if not file:
        await message.reply("❌ فایل پیدا نشد یا به آن دسترسی ندارید.")
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
            await message.reply("ابتدا /start را بفرستید.")
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
        await message.reply("چند کشو با این نام دارید. برای انتخاب دقیق، /folders را باز کنید.")
        return
    
    if not folder:
        await message.reply(f"❌ کشوی «{folder_name}» پیدا نشد.")
        return
    
    # Show confirmation
    await message.reply(
        f"🗑 حذف کشوی «{folder_name}»؟\n\n"
        "محتوا نگه داشته شود یا همه‌چیز حذف شود؟",
        reply_markup=InlineKeyboardMarkup([
            [
                InlineKeyboardButton("📁 نگه‌داشتن محتوا", callback_data=f"confirmdelfolder:{folder.id}:keep"),
            ],
            [InlineKeyboardButton("🗑 حذف کامل", callback_data=f"confirmdelfolder:{folder.id}:delete")],
            [InlineKeyboardButton("انصراف", callback_data="canceldel")],
        ])
    )
