import React from 'react';
import { recoverApplication } from '../lib/appRecovery';

type State = { failed: boolean; errorId: string };

export default class AppErrorBoundary extends React.Component<React.PropsWithChildren, State> {
    state: State = { failed: false, errorId: '' };

    static getDerivedStateFromError(): State {
        return { failed: true, errorId: `UI-${Date.now().toString(36).toUpperCase()}` };
    }

    componentDidCatch(error: unknown, info: React.ErrorInfo) {
        console.error('[Komod] UI recovery boundary', error);
        const token=localStorage.getItem('access_token');
        if(!token)return;
        const value=error instanceof Error?error:new Error(String(error));
        void fetch('/api/accounts/client-errors',{
            method:'POST',
            headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},
            body:JSON.stringify({error_id:this.state.errorId,message:value.message,path:window.location.pathname,stack:`${value.stack||''}\n${info.componentStack||''}`}),
            keepalive:true,
        }).then(async response=>{if(!response.ok)return;const data=await response.json();if(data.error_id&&data.error_id!==this.state.errorId)this.setState({errorId:data.error_id})}).catch(()=>undefined);
    }

    private recover(path?: string) {
        void recoverApplication(path);
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
                    <code dir="ltr" className="mt-3 inline-block rounded-lg bg-black/20 px-2 py-1 text-[11px] text-dark-400">{this.state.errorId}</code>
                    <div className="mt-5 grid grid-cols-2 gap-2">
                        <button className="rounded-2xl bg-primary-500 px-4 py-3 text-sm font-semibold text-white" onClick={() => this.recover()}>تلاش دوباره</button>
                        <button className="rounded-2xl bg-white/[.07] px-4 py-3 text-sm font-semibold" onClick={() => this.recover('/')}>بازگردانی کمد</button>
                    </div>
                </section>
            </main>
        );
    }
}
