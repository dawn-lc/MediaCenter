import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
    plugins: [
        react(),
        VitePWA({
            registerType: 'autoUpdate',
            includeAssets: ['favicon.svg'],
            manifest: {
                name: 'MediaCenter - 流媒体中心',
                short_name: 'MediaCenter',
                description: '高效的流媒体管理与播放平台',
                theme_color: '#6c5ce7',
                background_color: '#0f0f1a',
                display: 'standalone',
                display_override: ['window-controls-overlay', 'standalone'],
                orientation: 'any',
                start_url: '/',
                scope: '/',
                lang: 'zh-CN',
                categories: ['entertainment', 'media', 'video'],
                icons: [
                    {
                        src: '/icons/icon-192x192.svg',
                        sizes: '192x192',
                        type: 'image/svg+xml',
                    },
                    {
                        src: '/icons/icon-512x512.svg',
                        sizes: '512x512',
                        type: 'image/svg+xml',
                    },
                    {
                        src: '/icons/icon-512x512.svg',
                        sizes: '512x512',
                        type: 'image/svg+xml',
                        purpose: 'any',
                    },
                    {
                        src: '/icons/icon-maskable.svg',
                        sizes: '512x512',
                        type: 'image/svg+xml',
                        purpose: 'maskable',
                    },
                ],
                screenshots: [],
                shortcuts: [
                    {
                        name: '上传媒体',
                        short_name: '上传',
                        description: '上传新的媒体文件',
                        url: '/upload',
                        icons: [{ src: '/icons/icon-192x192.svg', sizes: '192x192' }],
                    },
                ],
            },
            workbox: {
                globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,webmanifest}'],
                navigateFallback: '/offline.html',
                navigateFallbackDenylist: [/^\/api\//],
                runtimeCaching: [
                    // API 请求：纯网络（不缓存）
                    {
                        urlPattern: /\/api\//i,
                        handler: 'NetworkOnly',
                    },
                    // 媒体文件：纯网络（不缓存大文件）
                    {
                        urlPattern: /\.(?:mp4|webm|ogg|mkv|mp3|wav|flac|m3u8|ts)($|\?)/i,
                        handler: 'NetworkOnly',
                    },
                    // 图片资源：Stale-While-Revalidate
                    {
                        urlPattern: /\.(?:jpg|jpeg|png|gif|webp|svg|ico|avif)($|\?)/i,
                        handler: 'StaleWhileRevalidate',
                        options: {
                            cacheName: 'images',
                            expiration: {
                                maxEntries: 100,
                                maxAgeSeconds: 60 * 60 * 24 * 30, // 30天
                            },
                            cacheableResponse: {
                                statuses: [0, 200],
                            },
                        },
                    },
                    // 字体文件：缓存优先
                    {
                        urlPattern: /\.(?:woff|woff2|ttf|eot)($|\?)/i,
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'fonts',
                            expiration: {
                                maxEntries: 20,
                                maxAgeSeconds: 60 * 60 * 24 * 365, // 1年
                            },
                        },
                    },
                ],
                skipWaiting: true,
                clientsClaim: true,
                cleanupOutdatedCaches: true,
            },
            selfDestroying: process.env.NODE_ENV === 'development',
        }),
    ],
    root: '.',
    base: '/',
    build: {
        outDir: resolve(__dirname, '..', 'dist', 'public'),
        emptyOutDir: true,
        sourcemap: false,
    },
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src'),
        },
    },
    server: {
        port: 5173,
        proxy: {
            '/api': {
                target: 'http://localhost:3000',
                changeOrigin: true,
            },
        },
    },
});
