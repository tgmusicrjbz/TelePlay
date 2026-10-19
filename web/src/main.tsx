import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import { applyAppearanceMode, applyTheme, getStoredAppearanceMode, getStoredTheme } from './lib/theme'
import AppErrorBoundary from './components/AppErrorBoundary'

applyAppearanceMode(getStoredAppearanceMode())
applyTheme(getStoredTheme())

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 1000 * 60 * 5, // 5 minutes
            retry: 1,
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
