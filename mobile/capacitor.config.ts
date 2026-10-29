import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
    appId: 'ir.rjbzmhd.komod',
    appName: 'کمد',
    webDir: '../web/dist',
    server: {
        androidScheme: 'https',
    },
    android: {
        backgroundColor: '#050819',
        allowMixedContent: false,
    },
};

export default config;
