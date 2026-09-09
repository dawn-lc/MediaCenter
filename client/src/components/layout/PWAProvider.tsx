import { useEffect, useState, type ReactNode } from 'react';
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
            try { detail = JSON.parse((e as MessageEvent).data ?? 'null'); } catch { // ignore
            }
            window.dispatchEvent(new CustomEvent('mediacenter:media-updated', { detail }));
        });
        return () => es.close();
    }, [token]);

    // PWA 方向控制（W3C Screen Orientation 官方范式 + manifest 声明锁）：
    // - 非全屏：manifest orientation:'portrait' 系统级锁竖屏（运行时 lock 非全屏会
    //   SecurityError，规范强制的前置条件，代码层无解）
    // - 全屏：进入时按视频内容方向 lock 一次；控制栏"旋转"按钮派发 vjs-rotate 事件，
    //   这里执行 lock(相反方向)（官方示例的 rotate() 模式）
    // - 退出全屏：规范规定浏览器自动"完全解锁"（fully unlock steps），无需任何调用；
    //   解锁后 manifest 竖屏声明重新生效，自然回竖屏
    // - 不用重力驱动：manifest 锁会使 devicemotion 变空壳事件（数据全 null，实测）,
    //   传感器路线在此配置下根本不可用，手动按钮是唯一可靠路径
    useEffect(() => {
        const lock = (o: OrientationLockType) => {
            screen.orientation?.lock?.(o).catch(() => { });
        };
        // 锁到与当前相反的方向（W3C 官方示例 getOppositeOrientation 原样实现）
        const rotate = () => {
            const cur = screen.orientation?.type ?? '';
            lock(cur.startsWith('portrait') ? 'landscape' : 'portrait');
        };

        let isFullscreen = false;

        // 全屏进入：vjs 事件 detail 携带视频方向（VideoPlayer 提供），按内容方向锁一次
        const onFullscreenEnter = (e?: Event) => {
            const detail = (e as CustomEvent<{ portraitVideo?: boolean }> | undefined)?.detail;
            const want: OrientationLockType = detail?.portraitVideo === true ? 'portrait' : 'landscape';
            if (isFullscreen) return; // 去重：原生 + vjs 事件会各触发一次
            isFullscreen = true;
            lock(want);
        };
        // 全屏退出：规范规定浏览器自动完全解锁，无需任何调用
        const onFullscreenExit = () => {
            if (!isFullscreen) return;
            isFullscreen = false;
        };

        const onNativeFullscreenChange = () => {
            if (document.fullscreenElement) onFullscreenEnter();
            else onFullscreenExit();
        };
        document.addEventListener('fullscreenchange', onNativeFullscreenChange);
        document.addEventListener('vjs-fullscreen-enter', onFullscreenEnter);
        document.addEventListener('vjs-fullscreen-exit', onFullscreenExit);
        document.addEventListener('vjs-rotate', rotate);

        return () => {
            document.removeEventListener('fullscreenchange', onNativeFullscreenChange);
            document.removeEventListener('vjs-fullscreen-enter', onFullscreenEnter);
            document.removeEventListener('vjs-fullscreen-exit', onFullscreenExit);
            document.removeEventListener('vjs-rotate', rotate);
            screen.orientation?.unlock?.();
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
