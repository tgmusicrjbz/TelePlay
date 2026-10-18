import React from 'react';

type State = { failed: boolean };

export default class AppErrorBoundary extends React.Component<React.PropsWithChildren, State> {
    state: State = { failed: false };

    static getDerivedStateFromError(): State {
        return { failed: true };
    }

    componentDidCatch(error: unknown) {
        console.error('[Komod] UI recovery boundary', error);
    }

    render() {
        if (!this.state.failed) return this.props.children;
        const offline = !navigator.onLine || localStorage.getItem('komod-force-offline') === '1';
        return (
            <main dir="rtl" className="flex min-h-dvh items-center justify-center bg-dark-950 p-5 text-white">
                <section className="w-full max-w-md rounded-3xl border border-white/10 bg-dark-900 p-6 text-center shadow-2xl">
                    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-500/15 text-2xl">{offline ? '📴' : '🧰'}</div>
                    <h1 className="text-lg font-bold">{offline ? 'این بخش آفلاین آماده نشد' : 'این بخش درست باز نشد'}</h1>
                    <p className="mt-2 text-sm leading-7 text-dark-300">{offline ? 'اطلاعات ذخیره‌شده روی دستگاه سالمه. یک‌بار برنامه رو دوباره باز کن.' : 'برنامه رو دوباره باز کن؛ اطلاعاتت حذف نمی‌شه.'}</p>
                    <div className="mt-5 grid grid-cols-2 gap-2">
                        <button className="rounded-2xl bg-primary-500 px-4 py-3 text-sm font-semibold text-white" onClick={() => window.location.reload()}>تلاش دوباره</button>
                        <button className="rounded-2xl bg-white/[.07] px-4 py-3 text-sm font-semibold" onClick={() => window.location.assign('/')}>رفتن به کمد</button>
                    </div>
                </section>
            </main>
        );
    }
}
