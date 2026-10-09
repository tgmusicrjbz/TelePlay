/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    darkMode: 'class',
    theme: {
        extend: {
            fontFamily: {
                sans: ['Vazirmatn', 'system-ui', 'sans-serif'],
            },
            colors: {
                white: 'rgb(var(--app-white) / <alpha-value>)',
                primary: {
                    50: 'rgb(var(--primary-50) / <alpha-value>)',
                    100: 'rgb(var(--primary-100) / <alpha-value>)',
                    200: 'rgb(var(--primary-200) / <alpha-value>)',
                    300: 'rgb(var(--primary-300) / <alpha-value>)',
                    400: 'rgb(var(--primary-400) / <alpha-value>)',
                    500: 'rgb(var(--primary-500) / <alpha-value>)',
                    600: 'rgb(var(--primary-600) / <alpha-value>)',
                    700: 'rgb(var(--primary-700) / <alpha-value>)',
                    800: 'rgb(var(--primary-800) / <alpha-value>)',
                    900: 'rgb(var(--primary-900) / <alpha-value>)',
                    950: 'rgb(var(--primary-950) / <alpha-value>)',
                },
                dark: {
                    50: 'rgb(var(--dark-50) / <alpha-value>)',
                    100: 'rgb(var(--dark-100) / <alpha-value>)',
                    200: 'rgb(var(--dark-200) / <alpha-value>)',
                    300: 'rgb(var(--dark-300) / <alpha-value>)',
                    400: 'rgb(var(--dark-400) / <alpha-value>)',
                    500: 'rgb(var(--dark-500) / <alpha-value>)',
                    600: 'rgb(var(--dark-600) / <alpha-value>)',
                    700: 'rgb(var(--dark-700) / <alpha-value>)',
                    800: 'rgb(var(--dark-800) / <alpha-value>)',
                    850: 'rgb(var(--dark-850) / <alpha-value>)',
                    900: 'rgb(var(--dark-900) / <alpha-value>)',
                    950: 'rgb(var(--dark-950) / <alpha-value>)',
                }
            },
            animation: {
                'fade-in': 'fadeIn 0.2s ease-out',
                'slide-up': 'slideUp 0.3s ease-out',
                'slide-in-right': 'slideInRight 0.3s ease-out',
                'scale-in': 'scaleIn 0.2s ease-out',
                'pulse-subtle': 'pulseSubtle 2s ease-in-out infinite',
                'glow': 'glow 2s ease-in-out infinite',
                'shimmer': 'shimmer 2s linear infinite',
            },
            keyframes: {
                fadeIn: {
                    '0%': { opacity: '0' },
                    '100%': { opacity: '1' },
                },
                slideUp: {
                    '0%': { opacity: '0', transform: 'translateY(10px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                },
                slideInRight: {
                    '0%': { opacity: '0', transform: 'translateX(20px)' },
                    '100%': { opacity: '1', transform: 'translateX(0)' },
                },
                scaleIn: {
                    '0%': { opacity: '0', transform: 'scale(0.95)' },
                    '100%': { opacity: '1', transform: 'scale(1)' },
                },
                pulseSubtle: {
                    '0%, 100%': { opacity: '1' },
                    '50%': { opacity: '0.8' },
                },
                glow: {
                    '0%, 100%': { boxShadow: '0 0 20px rgb(var(--primary-500) / 0.3)' },
                    '50%': { boxShadow: '0 0 30px rgb(var(--primary-500) / 0.5)' },
                },
                shimmer: {
                    '0%': { backgroundPosition: '-200% 0' },
                    '100%': { backgroundPosition: '200% 0' },
                },
            },
            backdropBlur: {
                xs: '2px',
            },
            boxShadow: {
                'glow': '0 0 20px rgb(var(--primary-500) / 0.3)',
                'glow-lg': '0 0 40px rgb(var(--primary-500) / 0.4)',
                'inner-glow': 'inset 0 0 20px rgb(var(--primary-500) / 0.1)',
            },
        },
    },
    plugins: [],
}

