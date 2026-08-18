import { Suspense, useCallback, useEffect, useRef } from 'react';
import { Outlet, ScrollRestoration, useLocation, useNavigationType } from 'react-router-dom';
import { Toaster, toast, useSonner } from 'sonner';
import Navbar from './components/layout/Navbar';
import ConfirmDialog from './components/feedback/ConfirmDialog';
import LoadingState from './components/feedback/LoadingState';
import ThemeToggle from './components/theme/ThemeToggle';
import { TOAST_GAP } from './config';
import './styles/index.css';

/**
 * ScrollRestoration 补丁：处理懒加载/异步数据页面的 POP 恢复
 *
 * RR 的 <ScrollRestoration/> 在导航提交时只恢复一次滚动；而本应用的页面都是懒加载
 * （React.lazy）+ 异步取数，返回时先渲染短小的 LoadingState（文档变矮），浏览器会把
 * 目标滚动值钳制回 0，且内容加载后 RR 不会重试 —— 导致后退后停在顶部。
 *
 * 这里用「滚动防抖记录位置（与导航时机解耦，避免内容卸载时的钳制）+ POP 时等待内容
 * 足够高再恢复」补上这一环；PUSH 回顶仍由 <ScrollRestoration/> 负责。
 */
function ScrollRestoreRetry() {
    const location = useLocation();
    const navigationType = useNavigationType();
    const savedRef = useRef<Record<string, number>>({});
    const timerRef = useRef<number | null>(null);

    // 滚动时（防抖 150ms）记录当前页位置 —— 不受导航/卸载时机影响
    useEffect(() => {
        const key = location.pathname + location.search;
        const onScroll = () => {
            if (timerRef.current !== null) window.clearTimeout(timerRef.current);
            timerRef.current = window.setTimeout(() => {
                savedRef.current[key] = window.scrollY;
            }, 150);
        };
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => {
            window.removeEventListener('scroll', onScroll);
            if (timerRef.current !== null) window.clearTimeout(timerRef.current);
        };
    }, [location.pathname, location.search]);

    // POP 返回：等待内容（懒加载/异步数据）足够高后恢复滚动
    useEffect(() => {
        if (navigationType !== 'POP') return;
        const key = location.pathname + location.search;
        const target = savedRef.current[key];
        if (typeof target !== 'number' || target <= 0) return;
        let raf = 0;
        let attempts = 0;
        const tryRestore = () => {
            if (document.body.scrollHeight > target + window.innerHeight) {
                window.scrollTo({ top: target, behavior: 'instant' as ScrollBehavior });
            } else if (attempts++ < 120) {
                raf = requestAnimationFrame(tryRestore);
            }
        };
        raf = requestAnimationFrame(tryRestore);
        return () => cancelAnimationFrame(raf);
    }, [location, navigationType]);

    return null;
}

export default function App() {
    const { toasts } = useSonner();
    const toastsRef = useRef(toasts);
    toastsRef.current = toasts;

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
            {/* 官方滚动恢复：按 pathname+search 保存/恢复（PUSH 回顶，POP 恢复），替换自制 popstate+sessionStorage 方案 */}
            <ScrollRestoration getKey={(location) => location.pathname + location.search} />
            {/* 懒加载内容高度不足时的 POP 恢复补丁 */}
            <ScrollRestoreRetry />
            <Navbar />
            <ConfirmDialog />
            <ThemeToggle />
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
                {/* 懒加载页面加载期间的统一 fallback */}
                <Suspense fallback={<LoadingState />}>
                    <Outlet />
                </Suspense>
            </div>
        </div>
    );
}
