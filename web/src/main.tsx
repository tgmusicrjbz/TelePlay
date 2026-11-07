import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import { applyAppearanceMode, applyTheme, getStoredAppearanceMode, getStoredTheme } from './lib/theme'
import AppErrorBoundary from './components/AppErrorBoundary'
import { isEffectivelyOnline } from './lib/connectivity'

applyAppearanceMode(getStoredAppearanceMode())
applyTheme(getStoredTheme())

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 1000 * 60 * 5, // 5 minutes
            gcTime: 1000 * 60 * 30,
            retry: (failureCount, error: any) => {
                const status = Number(error?.response?.status || 0)
                return isEffectivelyOnline() && failureCount < 1 && (!status || status === 429 || status >= 500)
            },
            // Telegram WebView fires focus repeatedly while sheets and native
            // pickers open. Mutations already invalidate affected queries, so
            // refetching every visible query on each focus only creates bursts.
            refetchOnWindowFocus: false,
            refetchOnReconnect: true,
        },
    },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <QueryClientProvider client={queryClient}>
            <AppErrorBoundary>
                <BrowserRouter>
                    <App />
                </BrowserRouter>
            </AppErrorBoundary>
        </QueryClientProvider>
    </React.StrictMode>,
)
window.requestAnimationFrame(() => {
    if (document.getElementById('root')?.childElementCount) window.dispatchEvent(new Event('komod-app-ready'))
})
