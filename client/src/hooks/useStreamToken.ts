import { useState, useEffect, useRef, useCallback } from 'react';
import { Api, resolveApiUrl } from '../api';
import { SIGN_URL_TTL_MARGIN, SIGN_URL_EXPIRES_PARAM } from '../config';

/** 从签名 URL 中提取 expires 时间戳 */
function getExpiresFromUrl(url: string): number {
    try {
        return parseInt(new URL(url, window.location.origin).searchParams.get(SIGN_URL_EXPIRES_PARAM) || '0', 10);
    } catch {
        return 0;
    }
}

/** 当前 URL 的签名是否仍在有效期内（提前 minTTL 秒视为过期） */
function isUrlFresh(url: string, minTTL = SIGN_URL_TTL_MARGIN): boolean {
    const expires = getExpiresFromUrl(url);
    if (!expires) return false;
    return expires - Math.floor(Date.now() / 1000) > minTTL;
}

/**
 * 流媒体签名 URL 管理
 *
 * 注意：签名仅用于新 HTTP 请求的鉴权。一旦流连接建立，
 * 数据传输不依赖签名有效性，即使签名过期也能继续播放。
 * 因此无需定期刷新，仅在需要发起新请求时（如 seek）才刷新。
 *
 * - mediaId 或 initialUrl 变化时自动刷新
 * - 提供 refresh() 供组件在 seek 等场景手动调用
 * - 提供 refreshIfNeeded() 按需检查后再刷新
 */
export function useStreamToken(mediaId: string | undefined, initialUrl: string | null | undefined) {
    const [streamUrl, setStreamUrl] = useState(resolveApiUrl(initialUrl ?? ''));
    const mediaIdRef = useRef(mediaId);
    const streamUrlRef = useRef(streamUrl);

    // 保持 ref 与 state 同步
    streamUrlRef.current = streamUrl;

    const refresh = useCallback(async () => {
        const id = mediaIdRef.current;
        if (!id) return;
        try {
            const data = await Api.refreshStreamToken(id);
            const newUrl = resolveApiUrl(data.streamUrl);
            setStreamUrl(newUrl);
        } catch {
            // 静默失败，继续使用旧 URL
        }
    }, []);

    /** 仅在签名不足 minTTL 秒时刷新 */
    const refreshIfNeeded = useCallback(
        async (minTTL = SIGN_URL_TTL_MARGIN) => {
            const id = mediaIdRef.current;
            if (!id) return;
            if (!isUrlFresh(streamUrlRef.current, minTTL)) {
                await refresh();
            }
        },
        [refresh]
    );

    // mediaId 变化时立即刷新
    useEffect(() => {
        const initUrl = resolveApiUrl(initialUrl ?? '');
        setStreamUrl(initUrl);
        mediaIdRef.current = mediaId;
        if (mediaId && !isUrlFresh(initUrl)) refresh();
    }, [mediaId, initialUrl, refresh]);

    return { streamUrl, refresh, refreshIfNeeded, isUrlFresh };
}
