import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { VitePWA } from 'vite-plugin-pwa';
import fs from 'fs';
// 从项目根目录加载 .env
import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: resolve(__dirname, '..', '.env') });
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
                globIgnores: ['**/offline.html'],
                runtimeCaching: [
                    // 媒体文件：纯网络（不缓存大文件）
                    {
                        urlPattern: /\.(?:mp4|webm|ogg|mkv|mp3|wav|flac|m3u8|ts)($|\?)/i,
                        handler: 'NetworkOnly',
                    },
                    // 缩略图：缓存优先（由服务端生成或客户端生成后写入缓存）
                    {
                        urlPattern: /\/thumb($|\?)/i,
                        handler: 'CacheFirst',
                        options: {
                            cacheName: 'thumbnails',
                            expiration: {
                                maxEntries: 200,
                                maxAgeSeconds: 60 * 60 * 24 * 365, // 1年
                            },
                            cacheableResponse: {
                                statuses: [0, 200],
                            },
                        },
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
        https: {
            key: fs.readFileSync(process.env.SSL_KEY!),
            cert: fs.readFileSync(process.env.SSL_CERT!),
        },
        proxy: {
            '/api': {
                target: `https://127.0.0.1${process.env.PORT ? `:${process.env.PORT}` : ""}`,
                changeOrigin: true,
                secure: false,
            },
        },
        host: true
    },
});
