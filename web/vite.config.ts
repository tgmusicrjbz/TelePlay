import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

async function filesUnder(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true })
    const nested = await Promise.all(entries.map(async entry => {
        const target = path.join(directory, entry.name)
        return entry.isDirectory() ? filesUnder(target) : [target]
    }))
    return nested.flat()
}

function injectOfflineBuildAssets() {
    return {
        name: 'komod-offline-build-assets',
        apply: 'build' as const,
        async closeBundle() {
            const outputDirectory = path.resolve(__dirname, 'dist')
            const workerPath = path.join(outputDirectory, 'sw.js')
            const assetsDirectory = path.join(outputDirectory, 'assets')
            const assets = (await filesUnder(assetsDirectory))
                .map(file => `/${path.relative(outputDirectory, file).replace(/\\/g, '/')}`)
                .filter(file => /\.(?:js|css|woff2?|png|jpe?g|webp|svg)$/i.test(file))
                .sort()
            const worker = await readFile(workerPath, 'utf8')
            await writeFile(
                workerPath,
                worker.replace('/*__KOMOD_BUILD_ASSETS__*/ []', JSON.stringify(assets)),
                'utf8',
            )
        },
    }
}

export default defineConfig({
    plugins: [react(), injectOfflineBuildAssets()],
    server: {
        port: 3000,
        proxy: {
            '/api': {
                target: 'http://localhost:8000',
                changeOrigin: true,
            },
        },
    },
})
