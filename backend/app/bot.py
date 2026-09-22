"""
Telegram Bot handlers using PyroTGFork MTProto.
Handles commands, file uploads, and inline callbacks.
"""

import secrets
import string
from datetime import datetime, timedelta
from pyrogram import filters
from pyrogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
from sqlalchemy import select

from .telegram import tg_client, forward_to_storage_channel, delete_from_storage_channel
from .database import async_session
from .models import User, File, Folder, LoginCode
from .config import get_settings
from .auth import create_access_token

settings = get_settings()
pending_input_chats: set[int] = set()


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
        "🌐 **نسخهٔ وب TelePlay**\n\n"
        f"در مرورگر همین کامپیوتر `{settings.web_base_url}` را باز کنید. "
        "کد ورود صفحه را با دستور `/login CODE` برای ربات بفرستید."
    )


HELP_TEXT = (
    "📖 **راهنمای TelePlay**\n\n"
    "ویدیو، صدا، عکس، سند یا یک پیام متنی برای ربات بفرستید تا در کتابخانه‌تان ذخیره شود. "
    "برای دیدن عکس و متن یا پخش رسانه، از نسخهٔ وب استفاده کنید.\n\n"
    "📁 /myfiles — فایل‌ها و یادداشت‌های اخیر\n"
    "📂 /folders — پوشه‌ها\n"
    "➕ /newfolder نام — ساخت پوشه\n"
    "🌐 /web — باز کردن نسخهٔ وب\n"
    "🔑 /login — ورود به دستگاه دیگر\n"
    "🔒 /logout_all — خروج از همهٔ دستگاه‌ها\n\n"
    "برای تغییر نام، انتقال یا حذف، دکمهٔ کنار هر مورد را بزنید. "
    "هنگام حذف پوشه انتخاب می‌کنید محتوا بماند یا همه‌چیز حذف شود."
)


def main_menu_keyboard(telegram_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("📁 فایل‌های من", callback_data="show_files"),
         InlineKeyboardButton("📂 پوشه‌ها", callback_data="back_folders")],
        [get_web_app_button(telegram_id, "🌐 نسخهٔ وب"),
         InlineKeyboardButton("❔ راهنما", callback_data="show_help")],
    ])


def recent_files_view(files: list[File], telegram_id: int) -> tuple[str, InlineKeyboardMarkup]:
    if not files:
        return "📭 کتابخانه هنوز خالی است. یک فایل، عکس یا پیام متنی بفرستید.", main_menu_keyboard(telegram_id)
    icons = {"video": "🎬", "audio": "🎵", "document": "📄", "image": "🖼", "text": "📝"}
    buttons = [
        [InlineKeyboardButton(f"{icons.get(file.file_type, '📎')} {file.file_name[:36]}", callback_data=f"openfile:{file.id}")]
        for file in files
    ]
    buttons.append([InlineKeyboardButton("📂 پوشه‌ها", callback_data="back_folders"),
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
                "🚫 **Access Restricted**\n\n"
                "Sorry, this bot is limited to authorized users only.\n"
                f"Your Telegram ID: `{message.from_user.id}`"
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
        "👋 **به TelePlay خوش آمدید**\n\n"
        "فایل، عکس یا متن بفرستید؛ اینجا ذخیره می‌شود و در نسخهٔ وب در دسترس است.\n"
        "از دکمه‌های زیر برای دیدن و مدیریت کتابخانه استفاده کنید.",
        reply_markup=main_menu_keyboard(message.from_user.id),
    )


@tg_client.on_message(filters.command("help") & filters.private)
async def help_command(client, message: Message):
    """Show help message."""
    await message.reply(HELP_TEXT, reply_markup=main_menu_keyboard(message.from_user.id))


@tg_client.on_message(filters.command("myfiles") & filters.private)
async def myfiles_command(client, message: Message):
    """List user's recent files."""
    async with async_session() as db:
        result = await db.execute(
            select(File)
            .where(File.user_id == (
                select(User.id).where(User.telegram_id == message.from_user.id).scalar_subquery()
            ))
            .order_by(File.created_at.desc())
            .limit(10)
        )
        files = result.scalars().all()
    
    text, keyboard = recent_files_view(files, message.from_user.id)
    await message.reply(text, reply_markup=keyboard)


@tg_client.on_message(filters.command("folders") & filters.private)
async def folders_command(client, message: Message):
    """Show folder structure."""
    async with async_session() as db:
        # Get user
        user_result = await db.execute(
            select(User).where(User.telegram_id == message.from_user.id)
        )
        user = user_result.scalar_one_or_none()
        
        if not user:
            await message.reply("Please use /start first.")
            return
        
        # Get root folders
        result = await db.execute(
            select(Folder)
            .where(Folder.user_id == user.id, Folder.parent_id.is_(None))
            .order_by(Folder.name)
        )
        folders = result.scalars().all()
    
    if not folders:
        await message.reply(
            "📁 هنوز پوشه‌ای ندارید. از دکمهٔ زیر یکی بسازید.",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("➕ ساخت پوشه", callback_data="create_folder")]
            ])
        )
        return
    
    buttons = []
    for f in folders:
        buttons.append([
            InlineKeyboardButton(f"📂 {f.name}", callback_data=f"folder:{f.id}")
        ])
    buttons.append([InlineKeyboardButton("➕ ساخت پوشه", callback_data="create_folder")])
    
    await message.reply(
        "📁 **پوشه‌های شما**",
        reply_markup=InlineKeyboardMarkup(buttons)
    )


@tg_client.on_message(filters.command("newfolder") & filters.private)
async def newfolder_command(client, message: Message):
    """Create a new folder."""
    if len(message.command) < 2:
        await message.reply("Usage: /newfolder <folder_name>")
        return
    
    folder_name = " ".join(message.command[1:]).strip()
    if not folder_name or len(folder_name) > 255:
        await message.reply("نام پوشه باید بین ۱ تا ۲۵۵ نویسه باشد.")
        return
    
    async with async_session() as db:
        # Get user
        user_result = await db.execute(
            select(User).where(User.telegram_id == message.from_user.id)
        )
        user = user_result.scalar_one_or_none()
        
        if not user:
            await message.reply("Please use /start first.")
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
            await message.reply(f"❌ Folder **{folder_name}** already exists.")
            return
        
        # Create folder
        folder = Folder(user_id=user.id, name=folder_name)
        db.add(folder)
        await db.commit()
    
    await message.reply(f"✅ Folder **{folder_name}** created!")


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
        "🌐 **نسخهٔ وب TelePlay**\n\n"
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
        
        await status_msg.edit(
            response,
            reply_markup=InlineKeyboardMarkup([
                [
                    InlineKeyboardButton("✏️ تغییر نام", callback_data=f"renamefile:{file.id}"),
                    InlineKeyboardButton("📂 انتقال", callback_data=f"move:{file.id}"),
                ],
                [
                    InlineKeyboardButton("🗑 حذف", callback_data=f"delfile:{file.id}"),
                    get_web_app_button(message.from_user.id, "🌐 نسخهٔ وب"),
                ],
            ])
        )
        
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
        await message.reply(
            f"📝 در کتابخانه ذخیره شد: {title}",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("✏️ تغییر نام", callback_data=f"renamefile:{note.id}"),
                 InlineKeyboardButton("📂 انتقال", callback_data=f"move:{note.id}")],
                [InlineKeyboardButton("🗑 حذف", callback_data=f"delfile:{note.id}"),
                 get_web_app_button(message.from_user.id, "🌐 نسخهٔ وب")],
            ]),
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
    
    if data == "logout_all_confirm":
        # Perform global logout
        async with async_session() as db:
            result = await db.execute(select(User).where(User.telegram_id == callback.from_user.id))
            user = result.scalar_one_or_none()
            
            if user:
                user.auth_version += 1
                await db.commit()
                await callback.message.edit(
                    "✅ از همهٔ دستگاه‌ها خارج شدید."
                )
            else:
                await callback.answer("User not found", show_alert=True)
        await callback.answer()
        
    elif data == "logout_all_cancel":
        # Cancel logout
        await callback.message.edit("انصراف داده شد؛ نشست‌ها فعال ماندند.")
        await callback.answer()

    elif data == "get_web_link":
        if settings.web_base_url.startswith("https://"):
            token = create_access_token(callback.from_user.id)
            web_url = f"{settings.web_base_url}/auth?token={token}"
            await callback.message.reply(
                "🌐 نسخهٔ وب TelePlay\nلینک را خصوصی نگه دارید:\n"
                f"{web_url}",
                reply_markup=InlineKeyboardMarkup([
                    [get_web_app_button(callback.from_user.id, "🌐 باز کردن نسخهٔ وب")]
                ])
            )
        else:
            await callback.message.reply(local_web_instructions())
        await callback.answer()
        
    elif data == "show_files":
        # Show recent files similar to /myfiles command
        async with async_session() as db:
            result = await db.execute(
                select(File)
                .where(File.user_id == (
                    select(User.id).where(User.telegram_id == callback.from_user.id).scalar_subquery()
                ))
                .order_by(File.created_at.desc())
                .limit(10)
            )
            files = result.scalars().all()
        
        text, keyboard = recent_files_view(files, callback.from_user.id)
        await callback.message.edit(text, reply_markup=keyboard)
        await callback.answer()

    elif data == "show_help":
        await callback.message.edit(HELP_TEXT, reply_markup=main_menu_keyboard(callback.from_user.id))
        await callback.answer()

    elif data.startswith("openfile:"):
        file_id = int(data.split(":")[1])
        async with async_session() as db:
            file = (await db.execute(owned_file(file_id, callback.from_user.id))).scalar_one_or_none()
        if file is None:
            await callback.answer("File not found", show_alert=True)
            return
        icon = {"video": "🎬", "audio": "🎵", "document": "📄", "image": "🖼", "text": "📝"}.get(file.file_type, "📎")
        await callback.message.reply(
            f"{icon} **{file.file_name}**\n📦 {format_size(file.file_size)}",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("✏️ تغییر نام", callback_data=f"renamefile:{file.id}"),
                 InlineKeyboardButton("📂 انتقال", callback_data=f"move:{file.id}")],
                [InlineKeyboardButton("🗑 حذف", callback_data=f"delfile:{file.id}"),
                 get_web_app_button(callback.from_user.id, "🌐 نسخهٔ وب")],
            ]),
        )
        await callback.answer()
        
    elif data == "create_folder" or data.startswith("create_folder:"):
        # Interactive folder creation using listener
        parent_id = int(data.split(":")[1]) if ":" in data else None
        if parent_id is not None:
            async with async_session() as db:
                parent = (await db.execute(owned_folder(parent_id, callback.from_user.id))).scalar_one_or_none()
            if parent is None:
                await callback.answer("Folder not found", show_alert=True)
                return
        pending_input_chats.add(callback.message.chat.id)
        await callback.message.reply(
            "📁 نام پوشهٔ جدید را بفرستید.\nبرای انصراف /cancel را بفرستید."
        )
        await callback.answer()
        
        try:
            # Wait for user's reply (60 second timeout)
            reply = await client.wait_for_message(
                chat_id=callback.message.chat.id,
                timeout=60
            )
            
            if reply.text and reply.text.startswith("/cancel"):
                await reply.reply("❌ Folder creation cancelled.")
                return
            
            folder_name = reply.text.strip() if reply.text else None
            
            if not folder_name or len(folder_name) > 255:
                await reply.reply("❌ نام پوشه باید بین ۱ تا ۲۵۵ نویسه باشد.")
                return
            
            # Create folder
            async with async_session() as db:
                user_result = await db.execute(
                    select(User).where(User.telegram_id == callback.from_user.id)
                )
                user = user_result.scalar_one_or_none()
                
                if not user:
                    await reply.reply("Please use /start first.")
                    return

                if parent_id is not None:
                    parent = (await db.execute(owned_folder(parent_id, callback.from_user.id))).scalar_one_or_none()
                    if parent is None:
                        await reply.reply("❌ Parent folder no longer exists.")
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
                    await reply.reply(f"❌ Folder **{folder_name}** already exists.")
                    return
                
                folder = Folder(user_id=user.id, parent_id=parent_id, name=folder_name)
                db.add(folder)
                await db.commit()
            
            await reply.reply(f"✅ Folder **{folder_name}** created!")
            
        except Exception as e:
            if "timeout" in str(e).lower():
                await callback.message.reply("⏱ Timed out. Please try again.")
            else:
                await callback.message.reply(f"❌ Error: {str(e)}")
        finally:
            pending_input_chats.discard(callback.message.chat.id)
        
    elif data.startswith("folder:"):
        folder_id = int(data.split(":")[1])
        async with async_session() as db:
            # Get folder
            result = await db.execute(owned_folder(folder_id, callback.from_user.id))
            folder = result.scalar_one_or_none()
            
            if not folder:
                await callback.answer("Folder not found", show_alert=True)
                return
            
            # Get files in folder
            files_result = await db.execute(
                select(File).where(File.folder_id == folder_id, File.user_id == folder.user_id)
                .order_by(File.created_at.desc()).limit(10)
            )
            files = files_result.scalars().all()
            children = (await db.execute(select(Folder).where(
                Folder.parent_id == folder_id, Folder.user_id == folder.user_id
            ).order_by(Folder.name).limit(20))).scalars().all()
        text = f"📂 **{folder.name}**\nپوشه‌ها: {len(children)} · موارد اخیر: {len(files)}"
        if not children and not files:
            text += "\n\nاین پوشه خالی است."
        icons = {"video": "🎬", "audio": "🎵", "document": "📄", "image": "🖼", "text": "📝"}
        buttons = [[InlineKeyboardButton(f"📂 {child.name[:36]}", callback_data=f"folder:{child.id}")] for child in children]
        buttons.extend([
            [InlineKeyboardButton(f"{icons.get(file.file_type, '📎')} {file.file_name[:36]}", callback_data=f"openfile:{file.id}")]
            for file in files
        ])
        buttons.extend([
            [
                InlineKeyboardButton("✏️ تغییر نام", callback_data=f"renamefolder:{folder_id}"),
                InlineKeyboardButton("📂 انتقال", callback_data=f"movefolder:{folder_id}"),
                InlineKeyboardButton("🗑 حذف", callback_data=f"delfolder:{folder_id}"),
            ],
            [InlineKeyboardButton("➕ زیرپوشه", callback_data=f"create_folder:{folder_id}")],
            [InlineKeyboardButton("↩️ بازگشت", callback_data=f"folder:{folder.parent_id}" if folder.parent_id else "back_folders")],
        ])
        
        await callback.message.edit(text, reply_markup=InlineKeyboardMarkup(buttons))
        await callback.answer()
        
    elif data == "back_folders":
        # Go back to folder list
        async with async_session() as db:
            user_result = await db.execute(
                select(User).where(User.telegram_id == callback.from_user.id)
            )
            user = user_result.scalar_one_or_none()
            
            if not user:
                await callback.answer("Please use /start first", show_alert=True)
                return
            
            result = await db.execute(
                select(Folder)
                .where(Folder.user_id == user.id, Folder.parent_id.is_(None))
                .order_by(Folder.name)
            )
            folders = result.scalars().all()
        
        if not folders:
            await callback.message.edit(
                "📁 هنوز پوشه‌ای ندارید. از دکمهٔ زیر یکی بسازید.",
                reply_markup=InlineKeyboardMarkup([
                    [InlineKeyboardButton("➕ ساخت پوشه", callback_data="create_folder")]
                ])
            )
        else:
            buttons = []
            for f in folders:
                buttons.append([
                    InlineKeyboardButton(f"📂 {f.name}", callback_data=f"folder:{f.id}")
                ])
            buttons.append([InlineKeyboardButton("➕ ساخت پوشه", callback_data="create_folder")])
            
            await callback.message.edit("📁 **پوشه‌های شما**", reply_markup=InlineKeyboardMarkup(buttons))
        
        await callback.answer()
        
    elif data.startswith("movefolder:"):
        folder_id = int(data.split(":")[1])
        async with async_session() as db:
            folder = (await db.execute(owned_folder(folder_id, callback.from_user.id))).scalar_one_or_none()
            if folder is None:
                await callback.answer("Folder not found", show_alert=True)
                return
            folders = (await db.execute(select(Folder).where(
                Folder.user_id == folder.user_id, Folder.id != folder_id
            ).order_by(Folder.name))).scalars().all()
        buttons = [[InlineKeyboardButton(f"📂 {target.name[:36]}", callback_data=f"folderto:{folder_id}:{target.id}")] for target in folders[:30]]
        buttons.append([InlineKeyboardButton("🏠 ریشه", callback_data=f"folderto:{folder_id}:0")])
        buttons.append([InlineKeyboardButton("↩️ بازگشت", callback_data=f"folder:{folder_id}")])
        await callback.message.edit("📂 مقصد پوشه را انتخاب کنید:", reply_markup=InlineKeyboardMarkup(buttons))
        await callback.answer()

    elif data.startswith("folderto:"):
        _, source_text, target_text = data.split(":")
        folder_id, target_id = int(source_text), int(target_text)
        async with async_session() as db:
            folder = (await db.execute(owned_folder(folder_id, callback.from_user.id))).scalar_one_or_none()
            target = (await db.execute(owned_folder(target_id, callback.from_user.id))).scalar_one_or_none() if target_id else None
            if folder is None or (target_id and target is None):
                await callback.answer("Folder not found", show_alert=True)
                return
            ancestor = target
            while ancestor is not None:
                if ancestor.id == folder_id:
                    await callback.answer("Cannot move into a subfolder", show_alert=True)
                    return
                ancestor = (await db.execute(owned_folder(ancestor.parent_id, callback.from_user.id))).scalar_one_or_none() if ancestor.parent_id else None
            duplicate = (await db.execute(select(Folder.id).where(
                Folder.user_id == folder.user_id, Folder.parent_id == (target_id or None),
                Folder.name == folder.name, Folder.id != folder_id
            ))).scalar_one_or_none()
            if duplicate is not None:
                await callback.answer("پوشه‌ای با همین نام در مقصد هست.", show_alert=True)
                return
            folder.parent_id = target_id or None
            await db.commit()
        await callback.message.edit("✅ پوشه منتقل شد.")
        await callback.answer()

    elif data.startswith("move:"):
        file_id = int(data.split(":")[1])
        
        async with async_session() as db:
            # Get user
            user_result = await db.execute(
                select(User).where(User.telegram_id == callback.from_user.id)
            )
            user = user_result.scalar_one_or_none()
            
            if not user:
                await callback.answer("Please use /start first", show_alert=True)
                return

            file = (await db.execute(owned_file(file_id, callback.from_user.id))).scalar_one_or_none()
            if file is None:
                await callback.answer("File not found", show_alert=True)
                return
            
            # Get folders
            folders_result = await db.execute(
                select(Folder).where(Folder.user_id == user.id).order_by(Folder.name)
            )
            folders = folders_result.scalars().all()
        
        if not folders:
            await callback.answer("هنوز پوشه‌ای ندارید. با /newfolder یکی بسازید.", show_alert=True)
            return
        
        buttons = []
        for f in folders:
            buttons.append([
                InlineKeyboardButton(f"📂 {f.name}", callback_data=f"moveto:{file_id}:{f.id}")
            ])
        buttons.append([InlineKeyboardButton("🏠 ریشه", callback_data=f"moveto:{file_id}:0")])
        
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
                    await callback.answer("Folder not found", show_alert=True)
                    return
            
            if file:
                file.folder_id = folder_id
                await db.commit()
                await callback.answer("✅ فایل منتقل شد.", show_alert=True)
            else:
                await callback.answer("File not found", show_alert=True)
                
    # ============== New File Management Callbacks ==============
    
    elif data.startswith("renamefile:"):
        file_id = int(data.split(":")[1])
        
        async with async_session() as db:
            result = await db.execute(owned_file(file_id, callback.from_user.id))
            file = result.scalar_one_or_none()
            
            if not file:
                await callback.answer("File not found", show_alert=True)
                return
            
            current_name = file.file_name
        
        pending_input_chats.add(callback.message.chat.id)
        await callback.message.reply(
            f"✏️ نام فعلی: {current_name}\nنام جدید را بفرستید. برای انصراف /cancel را بفرستید."
        )
        await callback.answer()
        
        try:
            reply = await client.wait_for_message(
                chat_id=callback.message.chat.id,
                timeout=60
            )
            
            if reply.text and reply.text.startswith("/cancel"):
                await reply.reply("❌ Rename cancelled.")
                return
            
            new_name = reply.text.strip() if reply.text else None
            
            if not new_name or len(new_name) > 255:
                await reply.reply("❌ نام فایل باید بین ۱ تا ۲۵۵ نویسه باشد.")
                return
            
            async with async_session() as db:
                result = await db.execute(owned_file(file_id, callback.from_user.id))
                file = result.scalar_one_or_none()
                
                if file:
                    file.file_name = sanitize_filename(new_name)
                    await db.commit()
                    await reply.reply(f"✅ نام فایل به {new_name} تغییر کرد.")
                else:
                    await reply.reply("❌ File not found.")
                    
        except Exception as e:
            if "timeout" in str(e).lower():
                await callback.message.reply("⏱ Timed out. Please try again.")
        finally:
            pending_input_chats.discard(callback.message.chat.id)
    
    elif data.startswith("delfile:"):
        file_id = int(data.split(":")[1])
        
        async with async_session() as db:
            result = await db.execute(owned_file(file_id, callback.from_user.id))
            file = result.scalar_one_or_none()
            
            if not file:
                await callback.answer("File not found", show_alert=True)
                return
                
            file_name = file.file_name
        
        # Ask for confirmation
        await callback.message.edit(
            f"🗑 فایل «{file_name}» حذف شود؟\nاین کار بازگشت‌پذیر نیست.",
            reply_markup=InlineKeyboardMarkup([
                [
                    InlineKeyboardButton("🗑 حذف فایل", callback_data=f"confirmdelfile:{file_id}"),
                    InlineKeyboardButton("انصراف", callback_data="canceldel"),
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
                await callback.answer("File not found", show_alert=True)
                return
            
            file_name = file.file_name
            channel_msg_id = file.channel_message_id
            
            if not await delete_from_storage_channel(channel_msg_id):
                await callback.answer("Could not delete from storage. Try again.", show_alert=True)
                return
            await db.delete(file)
            await db.commit()
        
        await callback.message.edit(f"✅ فایل «{file_name}» حذف شد.")
        await callback.answer("File deleted", show_alert=True)
        
    elif data.startswith("renamefolder:"):
        folder_id = int(data.split(":")[1])
        
        async with async_session() as db:
            result = await db.execute(owned_folder(folder_id, callback.from_user.id))
            folder = result.scalar_one_or_none()
            
            if not folder:
                await callback.answer("Folder not found", show_alert=True)
                return
            
            current_name = folder.name
        
        pending_input_chats.add(callback.message.chat.id)
        await callback.message.reply(
            f"✏️ نام فعلی: {current_name}\nنام جدید را بفرستید. برای انصراف /cancel را بفرستید."
        )
        await callback.answer()
        
        try:
            reply = await client.wait_for_message(
                chat_id=callback.message.chat.id,
                timeout=60
            )
            
            if reply.text and reply.text.startswith("/cancel"):
                await reply.reply("❌ Rename cancelled.")
                return
            
            new_name = reply.text.strip() if reply.text else None
            
            if not new_name or len(new_name) > 255:
                await reply.reply("❌ نام پوشه باید بین ۱ تا ۲۵۵ نویسه باشد.")
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
                        await reply.reply("❌ پوشه‌ای با همین نام در این محل هست.")
                        return
                    folder.name = new_name
                    await db.commit()
                    await reply.reply(f"✅ نام پوشه به {new_name} تغییر کرد.")
                else:
                    await reply.reply("❌ Folder not found.")
                    
        except Exception as e:
            if "timeout" in str(e).lower():
                await callback.message.reply("⏱ Timed out. Please try again.")
        finally:
            pending_input_chats.discard(callback.message.chat.id)
    
    elif data.startswith("delfolder:"):
        folder_id = int(data.split(":")[1])
        
        async with async_session() as db:
            result = await db.execute(owned_folder(folder_id, callback.from_user.id))
            folder = result.scalar_one_or_none()
            
            if not folder:
                await callback.answer("Folder not found", show_alert=True)
                return
            
            folder_name = folder.name
            
        text = (
            f"🗑 **حذف پوشهٔ {folder_name}**\n\n"
            "با محتوای آن چه کنیم؟\n"
            "📁 نگه‌داشتن: فایل‌ها و زیرپوشه‌ها یک سطح بالاتر می‌روند.\n"
            "🗑 حذف کامل: تمام محتوا هم پاک می‌شود."
        )
        
        await callback.message.edit(
            text,
            reply_markup=InlineKeyboardMarkup([
                [
                    InlineKeyboardButton("📁 نگه‌داشتن محتوا", callback_data=f"confirmdelfolder:{folder_id}:keep"),
                ],
                [InlineKeyboardButton("🗑 حذف کامل", callback_data=f"confirmdelfolder:{folder_id}:delete")],
                [InlineKeyboardButton("انصراف", callback_data="back_folders")]
            ])
        )
        await callback.answer()
        
    elif data.startswith("confirmdelfolder:"):
        parts = data.split(":")
        folder_id = int(parts[1])
        mode = parts[2] if len(parts) > 2 else "keep"
        if mode not in ("keep", "delete"):
            await callback.answer("Invalid deletion choice", show_alert=True)
            return
        
        async with async_session() as db:
            result = await db.execute(owned_folder(folder_id, callback.from_user.id))
            folder = result.scalar_one_or_none()
            
            if not folder:
                await callback.answer("Folder not found", show_alert=True)
                return
            
            folder_name = folder.name
            
            from fastapi import HTTPException
            from .routers.folders import delete_folder_contents
            try:
                await delete_folder_contents(db, folder, mode == "delete")
                await db.commit()
            except HTTPException:
                await db.rollback()
                await callback.answer("Storage deletion failed. Please try again.", show_alert=True)
                return
        
        await callback.message.edit(f"✅ پوشهٔ «{folder_name}» حذف شد.")
        await callback.answer("پوشه حذف شد.", show_alert=True)
    
    elif data.startswith("sharefile:"):
        file_id = int(data.split(":")[1])
        
        async with async_session() as db:
            # Verify ownership
            user_result = await db.execute(
                select(User).where(User.telegram_id == callback.from_user.id)
            )
            user = user_result.scalar_one_or_none()
            
            if not user:
                await callback.answer("Please use /start first", show_alert=True)
                return
            
            result = await db.execute(
                select(File).where(File.id == file_id, File.user_id == user.id)
            )
            file = result.scalar_one_or_none()
            
            if not file:
                await callback.answer("File not found", show_alert=True)
                return
            
            # Generate public hash
            file.public_hash = secrets.token_hex(16)
            await db.commit()
            await db.refresh(file)
            
            public_url = f"{settings.web_base_url}/api/stream/s/{file.public_hash}"
        
        await callback.message.reply(
            "🔗 لینک عمومی ساخته شد. هر کسی که آن را داشته باشد به فایل دسترسی دارد:\n"
            f"{public_url}",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("🔒 لغو اشتراک", callback_data=f"unsharefile:{file_id}")]
            ])
        )
        await callback.answer("لینک ساخته شد.", show_alert=True)
    
    elif data.startswith("unsharefile:"):
        file_id = int(data.split(":")[1])
        
        async with async_session() as db:
            # Verify ownership
            user_result = await db.execute(
                select(User).where(User.telegram_id == callback.from_user.id)
            )
            user = user_result.scalar_one_or_none()
            
            if not user:
                await callback.answer("Please use /start first", show_alert=True)
                return
            
            result = await db.execute(
                select(File).where(File.id == file_id, File.user_id == user.id)
            )
            file = result.scalar_one_or_none()
            
            if not file:
                await callback.answer("File not found", show_alert=True)
                return
            
            file.public_hash = None
            await db.commit()
        
        await callback.message.reply(
            "🔒 دسترسی از طریق لینک عمومی لغو شد.",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("🔗 ساخت لینک جدید", callback_data=f"sharefile:{file_id}")]
            ])
        )
        await callback.answer("اشتراک لغو شد.", show_alert=True)
    
    elif data == "canceldel":
        await callback.message.edit("حذف لغو شد.")
        await callback.answer()


# ============== File Action Command ==============

@tg_client.on_message(filters.command("file") & filters.private)
async def file_command(client, message: Message):
    """Manage a specific file by ID."""
    if len(message.command) < 2:
        await message.reply("Usage: /file <file_id>")
        return
    
    try:
        file_id = int(message.command[1])
    except ValueError:
        await message.reply("❌ Invalid file ID.")
        return
    
    async with async_session() as db:
        # Get user
        user_result = await db.execute(
            select(User).where(User.telegram_id == message.from_user.id)
        )
        user = user_result.scalar_one_or_none()
        
        if not user:
            await message.reply("Please use /start first.")
            return
        
        # Get file
        result = await db.execute(
            select(File).where(File.id == file_id, File.user_id == user.id)
        )
        file = result.scalar_one_or_none()
    
    if not file:
        await message.reply("❌ File not found or you don't have access.")
        return
    
    emoji = {"video": "🎬", "audio": "🎵", "document": "📄", "image": "🖼", "text": "📝"}.get(file.file_type, "📎")
    
    text = (
        f"{emoji} **{file.file_name}**\n\n"
        f"📦 حجم: {format_size(file.file_size)}\n"
    )
    
    if file.duration:
        text += f"⏱ مدت: {format_duration(file.duration)}\n"
    
    if file.public_hash:
        public_url = f"{settings.web_base_url}/api/stream/s/{file.public_hash}"
        text += f"\n🔗 لینک عمومی:\n{public_url}\n"
        share_btn = InlineKeyboardButton("🔒 لغو اشتراک", callback_data=f"unsharefile:{file.id}")
    else:
        share_btn = InlineKeyboardButton("🔗 اشتراک", callback_data=f"sharefile:{file.id}")
    
    await message.reply(
        text,
        reply_markup=InlineKeyboardMarkup([
            [
                InlineKeyboardButton("✏️ تغییر نام", callback_data=f"renamefile:{file.id}"),
                InlineKeyboardButton("📂 انتقال", callback_data=f"move:{file.id}"),
            ],
            [
                InlineKeyboardButton("🗑 حذف", callback_data=f"delfile:{file.id}"),
                share_btn,
            ],
        ])
    )


@tg_client.on_message(filters.command("deletefolder") & filters.private)
async def deletefolder_command(client, message: Message):
    """Delete a folder by name."""
    if len(message.command) < 2:
        await message.reply("روش استفاده: /deletefolder نام‌پوشه")
        return
    
    folder_name = " ".join(message.command[1:])
    
    async with async_session() as db:
        # Get user
        user_result = await db.execute(
            select(User).where(User.telegram_id == message.from_user.id)
        )
        user = user_result.scalar_one_or_none()
        
        if not user:
            await message.reply("Please use /start first.")
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
        await message.reply("چند پوشه با این نام دارید. برای انتخاب دقیق، /folders را باز کنید.")
        return
    
    if not folder:
        await message.reply(f"❌ پوشهٔ «{folder_name}» پیدا نشد.")
        return
    
    # Show confirmation
    await message.reply(
        f"🗑 حذف پوشهٔ «{folder_name}»؟\n\n"
        "محتوا نگه داشته شود یا همه‌چیز حذف شود؟",
        reply_markup=InlineKeyboardMarkup([
            [
                InlineKeyboardButton("📁 نگه‌داشتن محتوا", callback_data=f"confirmdelfolder:{folder.id}:keep"),
            ],
            [InlineKeyboardButton("🗑 حذف کامل", callback_data=f"confirmdelfolder:{folder.id}:delete")],
            [InlineKeyboardButton("انصراف", callback_data="canceldel")],
        ])
    )

