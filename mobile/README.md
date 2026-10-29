# اپ اندروید کمد

این پوشه نسخهٔ موبایل رابط اصلی کمد را با Capacitor بسته‌بندی می‌کند. پروژهٔ قدیمی Kotlin در پوشهٔ `android/` مستقل باقی مانده و این نسخه در `mobile/android/` ساخته می‌شود.

## ساخت نسخهٔ آزمایشی

پیش‌نیازها: Node.js 22، JDK 17 و Android SDK.

```powershell
cd mobile
npm install
npm run android:debug
```

اگر دسترسی Gradle به مخزن Google از شبکه محدود بود، می‌توان فقط برای همان ساخت یک آینه تعیین کرد:

```powershell
$env:ANDROID_MAVEN_MIRROR='https://maven.aliyun.com/repository/google'
npm run android:debug
```

فایل APK در مسیر زیر ساخته می‌شود:

```text
mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

برای بازکردن پروژه در Android Studio:

```powershell
npm run android:open
```

## انتشار

شناسهٔ دائمی برنامه `ir.rjbzmhd.komod` است. بعد از اولین انتشار آن را تغییر ندهید. برای Google Play خروجی AAB لازم است:

```powershell
npm run android:bundle
```

نسخهٔ release باید با upload key امضا شود. فایل keystore و رمزهای آن نباید وارد Git شوند. استفاده از Play App Signing پیشنهاد می‌شود.

```powershell
$env:KOMOD_VERSION_CODE='2'
$env:KOMOD_VERSION_NAME='1.0.1'
$env:KOMOD_RELEASE_STORE_FILE='C:\secure\komod-upload.jks'
$env:KOMOD_RELEASE_STORE_PASSWORD='...'
$env:KOMOD_RELEASE_KEY_ALIAS='komod-upload'
$env:KOMOD_RELEASE_KEY_PASSWORD='...'
npm run android:bundle
```

در هر انتشار `KOMOD_VERSION_CODE` باید از نسخهٔ قبلی بزرگ‌تر باشد. شناسهٔ برنامه و کلید امضا باید ثابت بمانند. رمزها را در فایل‌های پروژه ذخیره نکنید.

## چه زمانی نسخهٔ اندروید باید به‌روز شود؟

- تغییرات بک‌اند و داده‌ها، تا وقتی API سازگار بماند: بدون انتشار APK جدید.
- تغییرات رابط React، دارایی‌های آفلاین یا افزونه‌های بومی: اجرای sync، افزایش versionCode و انتشار نسخهٔ جدید.
- تغییر آدرس سرور: مقدار `VITE_API_ORIGIN` در `web/.env.android` و سپس ساخت نسخهٔ جدید.
