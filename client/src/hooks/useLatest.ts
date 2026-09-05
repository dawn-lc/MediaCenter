import { useRef } from 'react';

/**
 * 始终持有最新值的 ref（每次渲染同步），用于 useEffect(..., []) 等
 * 只注册一次、但需要读取最新 prop/state 的闭包场景，避免闭包捕获过期值。
 */
export function useLatest<T>(value: T) {
    const ref = useRef(value);
    ref.current = value;
    return ref;
}