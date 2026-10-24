<#
Run the local API against the primary PostgreSQL database without competing
with Railway's Telegram and background workers.

The first run asks for DATABASE_URL without echoing it and writes it only to
backend/.env.local, which is ignored by Git.
#>
[CmdletBinding()]
param(
    [switch]$ConfigureOnly,
    [switch]$ResetDatabaseConnection
)

$ErrorActionPreference = 'Stop'
$backendRoot = Split-Path -Parent $PSScriptRoot
$localEnvPath = Join-Path $backendRoot '.env.local'

function Get-DotEnvValue {
    param([string]$Path, [string]$Name)
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    $match = Get-Content -LiteralPath $Path | Where-Object { $_ -match "^$([regex]::Escape($Name))=(.*)$" } | Select-Object -Last 1
    if (-not $match) { return $null }
    return ($match -replace "^$([regex]::Escape($Name))=", '').Trim()
}

function Test-PostgreSqlUrl {
    param([string]$Value)
    return -not [string]::IsNullOrWhiteSpace($Value) -and $Value -match '^postgresql(?:\+asyncpg)?://'
}

if ($ResetDatabaseConnection -and (Test-Path -LiteralPath $localEnvPath)) {
    Remove-Item -LiteralPath $localEnvPath -Force
}

$databaseUrl = Get-DotEnvValue -Path $localEnvPath -Name 'DATABASE_URL'
if (-not (Test-PostgreSqlUrl -Value $databaseUrl)) {
    Write-Host ''
    Write-Host 'آدرس PostgreSQL اصلی را وارد کن. هنگام Paste کردن نمایش داده نمی‌شود.' -ForegroundColor Cyan
    $secureUrl = Read-Host -Prompt 'DATABASE_URL' -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureUrl)
    try {
        $databaseUrl = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer).Trim()
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }

    if (-not (Test-PostgreSqlUrl -Value $databaseUrl)) {
        throw 'DATABASE_URL باید با postgresql:// یا postgresql+asyncpg:// شروع شود.'
    }

    @(
        '# Created locally by start-primary-db-local.ps1. Never commit this file.',
        'KOMOD_LOCAL_DEV=true',
        "DATABASE_URL=$databaseUrl",
        'WEB_BASE_URL=http://localhost:5173'
    ) | Set-Content -LiteralPath $localEnvPath -Encoding utf8

    Write-Host 'تنظیمات اتصال محلی ذخیره شد.' -ForegroundColor Green
}

if ($ConfigureOnly) { return }

Set-Location $backendRoot
$env:KOMOD_LOCAL_DEV = 'true'
$env:WEB_BASE_URL = 'http://localhost:5173'
$env:PORT = '8000'

if (-not (Test-Path -LiteralPath '.\.venv\Scripts\python.exe')) {
    throw 'محیط Python پیدا نشد. ابتدا .venv را در پوشه backend بساز.'
}

Write-Host 'API محلی با دیتابیس اصلی اجرا می‌شود؛ Workerها فقط روی Railway فعال‌اند.' -ForegroundColor Yellow
& .\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
