import { useEffect, type RefObject } from 'react';

/**
 * 监听点击元素外部的事件，常用于关闭下拉菜单、弹窗等
 * @param ref 目标元素 ref
 * @param handler 点击外部时的回调
 * @param enabled 是否启用监听，默认 true
 */
export function useClickOutside(
    ref: RefObject<HTMLElement | null>,
    handler: () => void,
    enabled = true
) {
    useEffect(() => {
        if (!enabled) return;
        const listener = (e: MouseEvent | TouchEvent) => {
            if (!ref.current || ref.current.contains(e.target as Node)) return;
            handler();
        };
        document.addEventListener('mousedown', listener);
        document.addEventListener('touchstart', listener);
        return () => {
            document.removeEventListener('mousedown', listener);
            document.removeEventListener('touchstart', listener);
        };
    }, [ref, handler, enabled]);
}
