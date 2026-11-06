/** Access credentials that must live only for the lifetime of this page. */
let accessToken: string | null = null;

export const getAccessToken = (): string | null => accessToken;
export const hasAccessToken = (): boolean => Boolean(accessToken);

export function setAccessToken(token: string | null | undefined): void {
    accessToken = token || null;
    // Remove values left by older builds as soon as the app sees them.
    localStorage.removeItem('access_token');
    window.dispatchEvent(new CustomEvent('komod-access-token-changed'));
}

export function clearAccessToken(): void {
    setAccessToken(null);
}
