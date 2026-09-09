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
                // 竖屏声明（系统级默认锁，非全屏 PWA 永远竖屏）。全屏期间由运行时
                // screen.orientation.lock() 覆盖（优先级高于 manifest），配合播放器
                // 控制栏的"旋转屏幕"按钮手动切换横竖屏（不依赖传感器）。
                // ⚠️ 实测（2026-09）：此声明会使 Android PWA 的 devicemotion 变空壳事件
                // （数据全 null），故方向控制必须用手动按钮而非重力驱动。
                orientation: 'portrait',
                start_url: '/',
                scope: '/',
                lang: 'zh-CN',
                categories: ['entertainment', 'media', 'video'],
                icons: [
                    // PNG 多尺寸：系统小图标（任务栏/标签页/书签/通知/Windows 磁贴）需要 PNG，
                    // 仅有 SVG 时小尺寸场景会被浏览器降级为标题首字母占位（如显示 "M"）
                    { src: '/icons/icon-16x16.png', sizes: '16x16', type: 'image/png' },
                    { src: '/icons/icon-32x32.png', sizes: '32x32', type: 'image/png' },
                    { src: '/icons/icon-48x48.png', sizes: '48x48', type: 'image/png' },
                    { src: '/icons/icon-96x96.png', sizes: '96x96', type: 'image/png' },
                    { src: '/icons/icon-128x128.png', sizes: '128x128', type: 'image/png' },
                    { src: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
                    { src: '/icons/icon-256x256.png', sizes: '256x256', type: 'image/png' },
                    { src: '/icons/icon-384x384.png', sizes: '384x384', type: 'image/png' },
                    { src: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png' },
                    {
                        src: '/icons/icon-maskable-512x512.png',
                        sizes: '512x512',
                        type: 'image/png',
                        purpose: 'maskable',
                    },
                    // SVG（现代浏览器高 DPI 兜底）
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
                // SW 更新后立即接管所有已打开的页面（否则新 SW 不控制旧页面，
                // 缩略图 /thumb 等依赖 SW 服务的请求会落到后端 404）
                clientsClaim: true,
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
        // 警告阈值按 gzip 视角设定：500KB 原始字节经 gzip 后约 155KB（仍在正常范围），
        // 600KB 阈值只对真正异常的 chunk 报警；VHS 剔除后已知最大 chunk 为 video.js 核心
        chunkSizeWarningLimit: 600,
    },
    resolve: {
        alias: [
            { find: '@', replacement: resolve(__dirname, 'src') },
            // 用 video.js 官方 core 构建（dist/alt/video.core.js）替代默认入口：
            // 默认 dist/video.es.js 物理捆绑 VHS（HLS/DASH 引擎，~400KB），本站只播
            // 本地文件流用不到；core 构建无 VHS 且包含全部常用 API，chunk 703KB→约300KB。
            // 正则 ^video\.js$ 只替换裸导入，不影响 video.js/dist/... 子路径（CSS 等）。
            // 若未来需要播 m3u8/mpd 流，删除本条 alias 还原默认入口即可。
            { find: /^video\.js$/, replacement: resolve(__dirname, 'node_modules/video.js/dist/alt/video.core.js') },
        ],
    },
    server: {
        port: 5173,
        https: process.env.SSL_KEY && process.env.SSL_CERT
            ? {
                key: fs.readFileSync(process.env.SSL_KEY),
                cert: fs.readFileSync(process.env.SSL_CERT),
            }
            : undefined,
        proxy: {
            '/api': {
                // 后端地址：默认宿主机的 443（docker 映射 443:3000）；
                // 如后端跑在其它端口（如本地 tsx dev），用 VITE_API_PROXY 覆盖
                target: process.env.VITE_API_PROXY ? String(process.env.VITE_API_PROXY) : 'https://127.0.0.1:443',
                changeOrigin: true,
                secure: false,
            },
        },
        host: true
    },
});
