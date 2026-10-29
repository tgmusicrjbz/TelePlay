interface CapacitorRuntime {
    isNativePlatform?: () => boolean;
    getPlatform?: () => string;
}

declare global {
    interface Window {
        Capacitor?: CapacitorRuntime;
    }
}

export const isNativeApp = () => Boolean(window.Capacitor?.isNativePlatform?.());

