import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import PWAProvider from './components/layout/PWAProvider';
import { queryClient } from './queryClient';
import { requestPersistentStorage } from './utils/storage';
import 'video.js/dist/video-js.css';
import './stores/auth'; // 初始化 auth
import './stores/theme'; // 初始化主题（data-theme + 本地缓存）
import './i18n'; // 初始化国际化

// 启动时申请持久化存储，保护缩略图缓存不被浏览器清理
requestPersistentStorage();

ReactDOM.createRoot(document.getElementById('app')!).render(
    <QueryClientProvider client={queryClient}>
        <PWAProvider>
            <RouterProvider router={router} />
        </PWAProvider>
    </QueryClientProvider>
);
