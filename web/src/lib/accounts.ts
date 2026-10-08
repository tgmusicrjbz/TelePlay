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
    localStorage.setItem('user', JSON.stringify(auth.user));
    localStorage.setItem('komod-current-account', String(auth.user.telegram_id));
    localStorage.removeItem('komod-active-workspace');
    localStorage.removeItem('komod-active-workspace-permission');
}

export function syncCurrentAccount(user: User): void {
    const accessToken = localStorage.getItem('access_token');
    if (!accessToken) return;
    const next: SavedAccount = { telegramId: user.telegram_id, user, accessToken, refreshToken: localStorage.getItem('refresh_token') || undefined, savedAt: new Date().toISOString() };
    localStorage.setItem(KEY, JSON.stringify([next, ...savedAccounts().filter(item => item.telegramId !== user.telegram_id)]));
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('komod-current-account', String(user.telegram_id));
}

export function activateAccount(account: SavedAccount): void {
    localStorage.setItem('access_token', account.accessToken);
    if (account.refreshToken) localStorage.setItem('refresh_token', account.refreshToken); else localStorage.removeItem('refresh_token');
    localStorage.setItem('user', JSON.stringify(account.user));
    localStorage.setItem('komod-current-account', String(account.telegramId));
    localStorage.removeItem('komod-active-workspace');
    localStorage.removeItem('komod-active-workspace-permission');
    localStorage.setItem('komod-manual-account', String(account.telegramId));
    window.location.href = '/';
}

export function cachedCurrentUser(): User | undefined {
    try {
        const raw = localStorage.getItem('user');
        if (raw) return JSON.parse(raw) as User;
    } catch { /* fall back to the saved account below */ }
    const currentId = Number(localStorage.getItem('komod-current-account'));
    const account = savedAccounts().find(item => item.telegramId === currentId) || savedAccounts()[0];
    return account?.user;
}

export function restoreSavedSession(): boolean {
    if (localStorage.getItem('access_token')) return true;
    const currentId = Number(localStorage.getItem('komod-current-account'));
    const account = savedAccounts().find(item => item.telegramId === currentId) || savedAccounts()[0];
    if (!account?.accessToken) return false;
    localStorage.setItem('access_token', account.accessToken);
    if (account.refreshToken) localStorage.setItem('refresh_token', account.refreshToken);
    localStorage.setItem('user', JSON.stringify(account.user));
    localStorage.setItem('komod-current-account', String(account.telegramId));
    return true;
}

export function forgetAccount(telegramId: number): void {
    localStorage.setItem(KEY, JSON.stringify(savedAccounts().filter(item => item.telegramId !== telegramId)));
}
