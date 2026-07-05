import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import 'video.js/dist/video-js.css';
import './stores/auth'; // 初始化 auth
import './i18n'; // 初始化国际化

ReactDOM.createRoot(document.getElementById('app')!).render(
    <BrowserRouter>
        <App />
    </BrowserRouter>
);
