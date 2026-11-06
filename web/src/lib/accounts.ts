import type { AuthResponse, User } from './api';
import { clearAccessToken, getAccessToken, setAccessToken } from './authSession';

export interface SavedAccount {
    telegramId: number;
    user: User;
    /** Only present while migrating data written by builds before 3509c90. */
    accessToken?: string;
    refreshToken?: string;
    savedAt: string;
}

const KEY = 'komod-saved-accounts';

export function savedAccounts(): SavedAccount[] {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); }
    catch { return []; }
}

export function saveAuthenticatedAccount(auth: AuthResponse): void {
    const next: SavedAccount = {
        telegramId: auth.user.telegram_id,
        user: auth.user,
        ...(auth.refresh_token ? { refreshToken: auth.refresh_token } : {}),
        savedAt: new Date().toISOString(),
    };
    localStorage.setItem(KEY, JSON.stringify([next, ...savedAccounts().filter(item => item.telegramId !== next.telegramId)]));
    setAccessToken(auth.access_token);
    if (auth.refresh_token) localStorage.setItem('refresh_token', auth.refresh_token);
    else localStorage.removeItem('refresh_token');
    localStorage.setItem('user', JSON.stringify(auth.user));
    localStorage.setItem('komod-current-account', String(auth.user.telegram_id));
    localStorage.removeItem('komod-active-workspace');
    localStorage.removeItem('komod-active-workspace-permission');
}

export function syncCurrentAccount(user: User): void {
    const accessToken = getAccessToken();
    if (!accessToken) return;
    const next: SavedAccount = { telegramId: user.telegram_id, user, refreshToken: localStorage.getItem('refresh_token') || undefined, savedAt: new Date().toISOString() };
    localStorage.setItem(KEY, JSON.stringify([next, ...savedAccounts().filter(item => item.telegramId !== user.telegram_id)]));
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('komod-current-account', String(user.telegram_id));
}

export function updateCurrentAccountTokens(accessToken: string, refreshToken?: string): void {
    setAccessToken(accessToken);
    const currentId = Number(localStorage.getItem('komod-current-account'));
    const accounts = savedAccounts();
    const index = accounts.findIndex(item => item.telegramId === currentId);
    if (index < 0) return;
    accounts[index] = {
        ...accounts[index],
        refreshToken: refreshToken || accounts[index].refreshToken,
        savedAt: new Date().toISOString(),
    };
    localStorage.setItem(KEY, JSON.stringify(accounts));
}

export function clearCurrentAccountLegacyRefreshToken(): void {
    const currentId = Number(localStorage.getItem('komod-current-account'));
    localStorage.removeItem('refresh_token');
    localStorage.setItem(KEY, JSON.stringify(savedAccounts().map(item => {
        if (item.telegramId !== currentId) return item;
        const safeAccount = { ...item };
        delete safeAccount.refreshToken;
        return safeAccount;
    })));
}

export function clearCurrentAccountSession(): void {
    clearAccessToken();
    const currentId = Number(localStorage.getItem('komod-current-account'));
    localStorage.setItem(KEY, JSON.stringify(savedAccounts().map(item =>
        item.telegramId === currentId ? { ...item, accessToken: undefined, refreshToken: undefined } : item
    )));
}

export function activateAccount(account: SavedAccount): void {
    clearAccessToken();
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
    if (getAccessToken()) return true;
    const currentId = Number(localStorage.getItem('komod-current-account'));
    const account = savedAccounts().find(item => item.telegramId === currentId) || savedAccounts()[0];
    const legacyAccessToken = localStorage.getItem('access_token') || account?.accessToken;
    if (!legacyAccessToken) return false;
    setAccessToken(legacyAccessToken);
    if (account.refreshToken) localStorage.setItem('refresh_token', account.refreshToken);
    localStorage.setItem('user', JSON.stringify(account.user));
    localStorage.setItem('komod-current-account', String(account.telegramId));
    localStorage.setItem(KEY, JSON.stringify(savedAccounts().map(item => {
        const migrated = { ...item };
        delete migrated.accessToken;
        return migrated;
    })));
    return true;
}

export function forgetAccount(telegramId: number): void {
    localStorage.setItem(KEY, JSON.stringify(savedAccounts().filter(item => item.telegramId !== telegramId)));
}
