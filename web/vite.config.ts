import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
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
            const manifestPath = path.join(outputDirectory, '.vite', 'manifest.json')
            const indexPath = path.join(outputDirectory, 'index.html')
            const assets = (await filesUnder(assetsDirectory))
                .map(file => `/${path.relative(outputDirectory, file).replace(/\\/g, '/')}`)
                // Modern browsers supported by the PWA use WOFF2. Do not
                // precache duplicate WOFF fallbacks for every KaTeX font.
                .filter(file => /\.(?:js|css|woff2|png|jpe?g|webp|svg)$/i.test(file))
                .sort()
            type ManifestChunk = {
                file: string
                name?: string
                css?: string[]
                assets?: string[]
                imports?: string[]
                isEntry?: boolean
            }
            const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, ManifestChunk>
            const core = new Set<string>()
            const visited = new Set<string>()
            const collectStaticImports = (key: string) => {
                if (visited.has(key)) return
                visited.add(key)
                const chunk = manifest[key]
                if (!chunk) return
                core.add(`/${chunk.file}`)
                chunk.css?.forEach(file => core.add(`/${file}`))
                chunk.assets?.forEach(file => core.add(`/${file}`))
                chunk.imports?.forEach(collectStaticImports)
            }
            // FileBrowser is the authenticated app shell even though React
            // loads it dynamically to keep login/public routes fast.
            Object.entries(manifest)
                .filter(([, chunk]) => chunk.isEntry || chunk.name === 'FileBrowser')
                .forEach(([key]) => collectStaticImports(key))
            const coreAssets = [...core].filter(file => assets.includes(file)).sort()
            const optionalAssets = assets.filter(file => !core.has(file))
            const indexHtml = await readFile(indexPath, 'utf8')
            const worker = await readFile(workerPath, 'utf8')
            const buildId = createHash('sha256')
                .update(indexHtml)
                .update(worker)
                .update(assets.join('\n'))
                .digest('hex')
                .slice(0, 12)
            await writeFile(
                workerPath,
                worker
                    .replace('__KOMOD_BUILD_ID__', buildId)
                    .replace('/*__KOMOD_CORE_BUILD_ASSETS__*/ []', JSON.stringify(coreAssets))
                    .replace('/*__KOMOD_OPTIONAL_BUILD_ASSETS__*/ []', JSON.stringify(optionalAssets)),
                'utf8',
            )
        },
    }
}

export default defineConfig({
    plugins: [react(), injectOfflineBuildAssets()],
    build: {
        manifest: true,
        rollupOptions: {
            output: {
                manualChunks: {
                    'react-vendor': ['react', 'react-dom', 'react-router-dom'],
                    'data-vendor': ['axios', '@tanstack/react-query', 'zustand'],
                    'interaction-vendor': ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
                    'markdown-vendor': ['katex'],
                    'markdown-parser': ['react-markdown', 'remark-gfm', 'remark-breaks'],
                    'markdown-math': ['remark-math', 'rehype-katex'],
                    'icons-vendor': ['lucide-react'],
                },
            },
        },
    },
    server: {
        // 3000 is commonly occupied by local VPN/proxy software on Windows.
        port: 5173,
        proxy: {
            '/api': {
                target: 'http://localhost:8000',
                changeOrigin: true,
            },
        },
    },
})
