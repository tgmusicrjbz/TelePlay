import { beforeEach, describe, expect, it } from 'vitest';
import { saveAuthenticatedAccount } from './accounts';
import type { AuthResponse } from './api';

describe('login session persistence', () => {
    beforeEach(() => localStorage.clear());

    it('stores both tokens where the API client reads them after login', () => {
        const auth: AuthResponse = {
            access_token: 'access-token',
            refresh_token: 'refresh-token',
            user: {
                id: 1,
                telegram_id: 123,
                username: 'mahdi',
                first_name: 'Mahdi',
                last_name: null,
                created_at: '2026-01-01T00:00:00Z',
                last_active: '2026-01-01T00:00:00Z',
            },
        };

        saveAuthenticatedAccount(auth);

        expect(localStorage.getItem('access_token')).toBe('access-token');
        expect(localStorage.getItem('refresh_token')).toBe('refresh-token');
        expect(localStorage.getItem('komod-current-account')).toBe('123');
    });
});
