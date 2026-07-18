import { useEffect, useRef, useCallback } from 'react';

const SCROLL_PREFIX = 'scrollPos:';
const DEBOUNCE_MS = 300;

function getKey() {
    return window.location.pathname + window.location.search;
}

function saveScroll() {
    try {
        sessionStorage.setItem(SCROLL_PREFIX + getKey(), String(Math.round(window.scrollY)));
    } catch { /* ignore */ }
}

/**
 * 页面滚动位置保存钩子
 * - 滚动时防抖保存到 sessionStorage（以 pathname+search 为键）
 * - 离开页面时最终保存
 * - 恢复由 App.tsx 中的全局 popstate 监听器处理
 */
export function useScrollRestore() {
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // 滚动时防抖保存
    useEffect(() => {
        const onScroll = () => {
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(saveScroll, DEBOUNCE_MS);
        };
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => {
            window.removeEventListener('scroll', onScroll);
            if (timerRef.current) clearTimeout(timerRef.current);
            saveScroll(); // 离开前最终保存
        };
    }, []);

    const saveNow = useCallback(() => saveScroll(), []);

    return { saveNow };
}
