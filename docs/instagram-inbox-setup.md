# راه‌اندازی دریافت پست اینستاگرام در کمد

این اتصال از API رسمی Meta و Webhook استفاده می‌کند. حساب مقصد اینستاگرام باید Professional از نوع Business یا Creator باشد.

## تنظیم Meta

1. در Meta for Developers یک Business App بساز و محصول Instagram را با حالت **Instagram API with Instagram Login** اضافه کن.
2. حساب Professional اینستاگرام را به برنامه وصل کن.
3. دسترسی‌های `instagram_business_basic` و `instagram_business_manage_messages` را فعال کن.
4. در بخش Webhooks این مقادیر را وارد کن:
   - Callback URL: `https://komod.rjbzmhd.ir/api/instagram/webhook`
   - Verify token: یک رشته تصادفی که خودت می‌سازی و عین همان را در Railway می‌گذاری.
5. فیلد `messages` را برای حساب اینستاگرام Subscribe کن.
6. یک User Access Token برای همان حساب Professional بگیر. برای استفاده بلندمدت، توکن کوتاه‌مدت را با روش رسمی Meta به Long-Lived Token تبدیل کن.
7. شناسه عددی Instagram Professional Account را بردار؛ نام کاربری مثل `@example` کافی نیست.

## متغیرهای Railway

```env
INSTAGRAM_APP_SECRET=app-secret-from-meta
INSTAGRAM_WEBHOOK_VERIFY_TOKEN=a-long-random-value-you-created
INSTAGRAM_ACCESS_TOKEN=instagram-user-access-token
INSTAGRAM_ACCOUNT_ID=numeric-instagram-professional-account-id
INSTAGRAM_GRAPH_VERSION=v26.0
```

`INSTAGRAM_ACCESS_TOKEN` و `INSTAGRAM_ACCOUNT_ID` برای پاسخ خودکار حاوی کد اتصال لازم‌اند. دریافت Webhook با دو مقدار اول فعال می‌شود، ولی بهتر است هر چهار مقدار تنظیم شوند.

پس از افزودن متغیرها، نسخه جدید را Deploy کن. فرمان شروع Backend خودش `alembic upgrade head` را اجرا می‌کند و جدول‌های لازم را می‌سازد.

## جریان استفاده

1. شخص یک پست یا Reel را در دایرکت برای پیج متصل می‌فرستد.
2. کمد یک کد اتصال برای او در همان دایرکت می‌فرستد.
3. شخص در ربات تلگرام این دستور را می‌فرستد: `/instagram CODE`
4. مدیر در **تنظیمات ← دریافت از اینستاگرام** حساب را بررسی و تأیید می‌کند.
5. همان پست منتظر و پست‌های بعدی وارد صف دانلود می‌شوند و در تلگرام برای همان شخص ارسال می‌شوند.

مدیر می‌تواند اتصال را بدون دستور ربات هم انجام دهد: در پنل، حساب تلگرام مقصد را انتخاب و سپس دسترسی را تأیید کند.

## انتشار برای افراد دیگر

در حالت Development فقط حساب‌ها و تسترهای دارای نقش در Meta App قابل آزمایش‌اند. برای استفاده افراد عادی باید برنامه را Live کنی و دسترسی پیام‌ها را در App Review با Advanced Access تأیید بگیری. گفتگو نیز باید با پیام کاربر به حساب Professional آغاز شود.

پست خصوصی، حذف‌شده یا پستی که سرویس دانلود فعلی نتواند بخواند ممکن است ارسال نشود. رویداد تکراری Meta دوباره وارد صف نمی‌شود.
