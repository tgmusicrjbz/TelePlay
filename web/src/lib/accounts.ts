import type { AuthResponse, User } from './api';

export interface SavedAccount {
    telegramId: number;
    user: User;
    accessToken: string;
    refreshToken?: string;
    savedAt: string;
}

const KEY = 'komod-saved-accounts';

export function savedAccounts(): SavedAccount[] {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); }
    catch { return []; }
}

export function saveAuthenticatedAccount(auth: AuthResponse): void {
    const next: SavedAccount = { telegramId: auth.user.telegram_id, user: auth.user, accessToken: auth.access_token, refreshToken: auth.refresh_token, savedAt: new Date().toISOString() };
    localStorage.setItem(KEY, JSON.stringify([next, ...savedAccounts().filter(item => item.telegramId !== next.telegramId)]));
    localStorage.setItem('access_token', auth.access_token);
    localStorage.setItem('refresh_token', auth.refresh_token);
    localStorage.removeItem('komod-active-workspace');
}

export function syncCurrentAccount(user: User): void {
    const accessToken = localStorage.getItem('access_token');
    if (!accessToken) return;
    const next: SavedAccount = { telegramId: user.telegram_id, user, accessToken, refreshToken: localStorage.getItem('refresh_token') || undefined, savedAt: new Date().toISOString() };
    localStorage.setItem(KEY, JSON.stringify([next, ...savedAccounts().filter(item => item.telegramId !== user.telegram_id)]));
}

export function activateAccount(account: SavedAccount): void {
    localStorage.setItem('access_token', account.accessToken);
    if (account.refreshToken) localStorage.setItem('refresh_token', account.refreshToken); else localStorage.removeItem('refresh_token');
    localStorage.removeItem('komod-active-workspace');
    window.location.href = '/';
}

export function forgetAccount(telegramId: number): void {
    localStorage.setItem(KEY, JSON.stringify(savedAccounts().filter(item => item.telegramId !== telegramId)));
}
