import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import PWAProvider from './components/PWAProvider';
import { requestPersistentStorage } from './utils/storage';
import 'video.js/dist/video-js.css';
import './stores/auth'; // 初始化 auth
import './i18n'; // 初始化国际化

// 启动时申请持久化存储，保护缩略图缓存不被浏览器清理
requestPersistentStorage();

ReactDOM.createRoot(document.getElementById('app')!).render(
    <BrowserRouter>
        <PWAProvider>
            <App />
        </PWAProvider>
    </BrowserRouter>
);
