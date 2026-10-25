# راهنمای Migration دیتابیس کمد

Schema دیتابیس با Alembic نسخه‌بندی می‌شود. برنامه هنگام Startup فقط نسخه را بررسی می‌کند و هیچ `ALTER TABLE` مستقیمی اجرا نمی‌کند.

## اجرای Migration

از پوشه `backend`:

```powershell
.\.venv\Scripts\python.exe -m alembic upgrade head
```

Dockerfileهای پروژه این دستور را پیش از اجرای Uvicorn به‌صورت خودکار اجرا می‌کنند. در PostgreSQL یک Advisory Lock تراکنشی اجازه نمی‌دهد دو Deploy هم‌زمان Migration را اجرا کنند.

## ساخت Migration تازه

پس از تغییر Modelها:

```powershell
.\.venv\Scripts\python.exe -m alembic revision --autogenerate -m "describe change"
.\.venv\Scripts\python.exe -m alembic check
```

فایل تولیدشده را حتماً بازبینی کن؛ به‌خصوص حذف ستون، تغییر نوع و Constraintها نباید بدون برنامه بازیابی اجرا شوند.

## بررسی وضعیت

```powershell
.\.venv\Scripts\python.exe -m alembic current
.\.venv\Scripts\python.exe -m alembic heads
.\.venv\Scripts\python.exe -m alembic history --verbose
```

## بازگشت

برای بازگشت یک Revision:

```powershell
.\.venv\Scripts\python.exe -m alembic downgrade -1
```

پیش از Downgrade روی Production، با ابزار Backup پروژه نسخه ایمنی بگیر. Downgrade مربوط به Baseline کل Schema را حذف می‌کند و فقط برای دیتابیس آزمایشی خالی مناسب است.

## دیتابیس‌های قدیمی

Baseline فعلی دیتابیس موجود را بدون پاک‌کردن داده می‌پذیرد، به شرطی که همه جدول‌ها و ستون‌های Modelهای فعلی وجود داشته باشند. اگر ستونی کم باشد Migration عمداً متوقف می‌شود تا دیتابیس ناقص به‌اشتباه Current علامت نخورد. در این حالت ابتدا نسخه قبلی برنامه را یک بار اجرا و Backup تهیه کن، سپس دوباره `upgrade head` را اجرا کن.
