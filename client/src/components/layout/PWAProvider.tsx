import { useState, useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { apiUrl } from '../../api';
import { useAuthStore } from '../../stores/auth';

// ---------------------------------------------------------------------------
// PWAProvider
// 功能：SSE 长连接检测在线/离线 + 媒体变更推送 → 离线横幅（断网不弹 toast，横幅即提示）
// ---------------------------------------------------------------------------

interface PWAProviderProps {
    children: ReactNode;
}

export default function PWAProvider({ children }: PWAProviderProps) {
    const { t } = useTranslation();
    const token = useAuthStore((s) => s.token);
    // 乐观初始：以 SSE 连接状态为准（连接建立/心跳 = 在线，断开 = 离线）
    const [online, setOnline] = useState(true);

    // SSE 存活 + 推送通道：EventSource 自动重连，onopen/onerror 即存活翻转
    useEffect(() => {
        const es = new EventSource(apiUrl('/events') + (token ? `?token=${encodeURIComponent(token)}` : ''));
        es.onopen = () => setOnline(true);
        es.onerror = () => setOnline(false);
        // 媒体变更推送 → 转发为窗口事件，供页面订阅刷新（与 SESSION_EXPIRED_EVENT 同模式）
        es.addEventListener('media.updated', (e) => {
            let detail: unknown = undefined;
            try { detail = JSON.parse((e as MessageEvent).data ?? 'null'); } catch { /* ignore */ }
            window.dispatchEvent(new CustomEvent('mediacenter:media-updated', { detail }));
        });
        return () => es.close();
    }, [token]);

    // PWA 方向锁：默认竖屏，视频全屏时释放，退出全屏时恢复
    // 监听两种全屏事件：原生 fullscreenchange（桌面/Android）+ 自定义 vjs-fullscreen（iOS PWA）
    useEffect(() => {
        const lockPortrait = () => {
            if (screen.orientation?.lock) {
                screen.orientation.lock('portrait').catch(() => { });
            }
        };
        const unlockOrientation = () => {
            if (screen.orientation?.unlock) {
                screen.orientation.unlock();
            }
        };
        const onFullscreenEnter = () => unlockOrientation();
        const onFullscreenExit = () => lockPortrait();

        lockPortrait();
        document.addEventListener('fullscreenchange', () => {
            document.fullscreenElement ? unlockOrientation() : lockPortrait();
        });
        document.addEventListener('vjs-fullscreen-enter', onFullscreenEnter);
        document.addEventListener('vjs-fullscreen-exit', onFullscreenExit);

        return () => {
            document.removeEventListener('fullscreenchange', onFullscreenExit);
            document.removeEventListener('vjs-fullscreen-enter', onFullscreenEnter);
            document.removeEventListener('vjs-fullscreen-exit', onFullscreenExit);
            unlockOrientation();
        };
    }, []);

    return (
        <>
            {/* 离线横幅 */}
            <div
                className="offline-banner"
                aria-hidden={online}
                role="alert"
                style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    zIndex: 'var(--z-banner)',
                    background: 'var(--danger)',
                    color: '#fff',
                    textAlign: 'center',
                    padding: '6px 12px',
                    fontSize: 13,
                    fontWeight: 500,
                    transform: online ? 'translateY(-100%)' : 'translateY(0)',
                    transition: 'transform 0.3s ease-in-out',
                }}
            >
                {t('pwa.offlineBanner')}
            </div>

            {children}
        </>
    );
}
