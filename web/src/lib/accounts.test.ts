import { beforeEach, describe, expect, it } from 'vitest';
import { clearCurrentAccountLegacyRefreshToken, saveAuthenticatedAccount, savedAccounts } from './accounts';
import type { AuthResponse, User } from './api';

const user = (telegramId: number): User => ({
    id: telegramId,
    telegram_id: telegramId,
    first_name: `user-${telegramId}`,
    is_active: true,
    is_admin: false,
    can_use_monitors: false,
    can_create_rooms: false,
    created_at: '2026-01-01T00:00:00Z',
    last_active: '2026-01-01T00:00:00Z',
});

describe('account refresh-token migration', () => {
    beforeEach(() => localStorage.clear());

    it('does not persist refresh credentials returned to a modern client', () => {
        const auth: AuthResponse = { access_token: 'access', user: user(11) };
        saveAuthenticatedAccount(auth);

        expect(localStorage.getItem('refresh_token')).toBeNull();
        expect(savedAccounts()[0]).not.toHaveProperty('refreshToken');
    });

    it('removes only the current legacy token after its cookie is established', () => {
        localStorage.setItem('komod-current-account', '11');
        localStorage.setItem('refresh_token', 'legacy-current');
        localStorage.setItem('komod-saved-accounts', JSON.stringify([
            { telegramId: 11, user: user(11), accessToken: 'a', refreshToken: 'legacy-current', savedAt: 'now' },
            { telegramId: 22, user: user(22), accessToken: 'b', refreshToken: 'legacy-other', savedAt: 'now' },
        ]));

        clearCurrentAccountLegacyRefreshToken();

        expect(localStorage.getItem('refresh_token')).toBeNull();
        expect(savedAccounts().find(item => item.telegramId === 11)).not.toHaveProperty('refreshToken');
        expect(savedAccounts().find(item => item.telegramId === 22)?.refreshToken).toBe('legacy-other');
    });
});
