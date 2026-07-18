import { useCallback, useRef, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Toaster, toast, useSonner } from 'sonner';
import Navbar from './components/Navbar';
import ConfirmDialog from './components/ConfirmDialog';
import HomePage from './pages/HomePage';
import PlayerPage from './pages/PlayerPage';
import UploadPage from './pages/UploadPage';
import EditMediaPage from './pages/EditMediaPage';
import AdminPage from './pages/AdminPage';
import TagsPage from './pages/TagsPage';
import AuthorsPage from './pages/AuthorsPage';
import UsersPage from './pages/UsersPage';
import { TOAST_GAP } from './config';
import './styles/index.css';

export default function App() {
    const { toasts } = useSonner();
    const toastsRef = useRef(toasts);
    toastsRef.current = toasts;

    // 全局：浏览器前进/后退时恢复滚动位置
    useEffect(() => {
        const SCROLL_KEY = 'scrollPos:';
        const onPop = () => {
            const key = SCROLL_KEY + window.location.pathname + window.location.search;
            const v = sessionStorage.getItem(key);
            if (v) {
                const y = parseInt(v, 10);
                if (y > 0) {
                    const attempt = () => {
                        if (document.body.scrollHeight > y) {
                            window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior });
                        } else {
                            requestAnimationFrame(attempt);
                        }
                    };
                    const timeout = setTimeout(() => window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior }), 3000);
                    requestAnimationFrame(() => requestAnimationFrame(attempt));
                    // 成功后清理超时
                    const check = setInterval(() => {
                        if (Math.abs(window.scrollY - y) < 10) {
                            clearTimeout(timeout);
                            clearInterval(check);
                        }
                    }, 100);
                }
            }
        };
        window.addEventListener('popstate', onPop);
        return () => window.removeEventListener('popstate', onPop);
    }, []);

    const handleToastClick = useCallback((e: React.MouseEvent) => {
        const el = (e.target as HTMLElement).closest<HTMLElement>('[data-sonner-toast]');
        if (!el) return;
        const idx = parseInt(el.getAttribute('data-index') ?? '', 10);
        if (isNaN(idx)) return;
        const t = toastsRef.current[idx];
        if (t) toast.dismiss(t.id);
    }, []);

    return (
        <div>
            <Navbar />
            <ConfirmDialog />
            <div onClick={handleToastClick}>
                <Toaster
                    position="top-right"
                    gap={TOAST_GAP}
                    toastOptions={{
                        style: {
                            background: 'var(--bg-card)',
                            color: 'var(--text-primary)',
                            border: '1px solid var(--border)',
                            fontSize: 14,
                            fontWeight: 500,
                            cursor: 'pointer'
                        }
                    }}
                />
            </div>
            <div className="container">
                <Routes>
                    <Route path="/" element={<HomePage />} />
                    <Route path="/player/:id" element={<PlayerPage />} />
                    <Route path="/edit/:id" element={<EditMediaPage />} />
                    <Route path="/upload" element={<UploadPage />} />
                    <Route path="/admin" element={<AdminPage />} />
                    <Route path="/admin/tags" element={<TagsPage />} />
                    <Route path="/admin/authors" element={<AuthorsPage />} />
                    <Route path="/admin/users" element={<UsersPage />} />
                </Routes>
            </div>
        </div>
    );
}
