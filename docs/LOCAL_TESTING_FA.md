# تست محلی بدون درگیرکردن Railway

این روش فقط روی کامپیوتر خودت اجرا می‌شود. دیتابیس Railway، ربات، کانال ذخیره‌سازی و صف‌های در حال اجرای Railway را لمس نمی‌کند.

## ۱. ساخت فایل تنظیمات محلی

در پوشهٔ `backend` یک فایل به نام `.env` بساز یا مقدارهای زیر را در همان فایل موقتاً جایگزین کن. مقدارهای تلگرام در این حالت فقط برای عبور از اعتبارسنجی تنظیمات هستند و استفاده نمی‌شوند.

```env
KOMOD_LOCAL_DEV=true
DATABASE_URL=sqlite:///./data/komod-local.sqlite
WEB_BASE_URL=http://localhost:5173
JWT_SECRET=local-only-change-this-secret
TELEGRAM_API_ID=12345
TELEGRAM_API_HASH=local-development-only
TELEGRAM_BOT_TOKEN=000000:local-development-only
TELEGRAM_STORAGE_CHANNEL_ID=-1001234567890
```

اگر `.env` فعلی حاوی اطلاعات Railway است، پیش از این کار یک کپی امن از آن نگه دار. فایل دیتابیس محلی در `backend/data/komod-local.sqlite` ساخته می‌شود و با Railway ارتباط ندارد.

## ۲. اجرای API محلی

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --port 8000
```

صفحهٔ بررسی API در `http://localhost:8000/docs` باز می‌شود. در Log باید پیام `Local development mode is active` را ببینی.

## ۳. اجرای رابط وب

در یک ترمینال دیگر:

```powershell
cd web
npm run dev
```

آدرس `http://localhost:5173` را باز کن. Vite درخواست‌های `/api` را به API محلی روی پورت ۸۰۰۰ می‌فرستد.

برای بررسی ظاهری و PWA نیازی به ورود واقعی نیست. برای آزمودن جریان‌های نیازمند حساب، ابتدا از نسخهٔ Railway پشتیبان حساب بگیر و فقط همان نسخه را در محیط محلی بازیابی کن؛ هرگز `DATABASE_URL` محلی را به دیتابیس Railway تغییر نده.

## ۴. بررسی سریع پیش از Push

```powershell
cd web
npm run lint
npm run build
npm run verify:bundle
npm run verify:offline

cd ..\backend
.\.venv\Scripts\python.exe -m compileall -q app scripts tests
```

## Push به GitHub

پیغام `Failed to connect to github.com port 443` شبکه‌ای است و به کد یا Repository مربوط نیست. بعد از وصل‌شدن VPN یا Proxy مورد استفادهٔ Git، این را بررسی کن:

```powershell
Test-NetConnection github.com -Port 443
git push origin HEAD
```

اگر Proxy محلی داری، Git را با همان آدرس و پورت Proxy تنظیم کن:

```powershell
git config --global http.proxy http://127.0.0.1:PORT
git config --global https.proxy http://127.0.0.1:PORT
```

پس از پایان کار، تنظیم را پاک کن:

```powershell
git config --global --unset-all http.proxy
git config --global --unset-all https.proxy
```
