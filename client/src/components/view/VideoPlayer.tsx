import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Api } from '../../api';
import type { Media } from '../../types';
import { usePlaylistStore } from '../../stores/playlist';
import { usePlayerSettings } from '../../stores/playerSettings';
import { useStreamToken } from '../../hooks/useStreamToken';
import { resolveApiUrl } from '../../api';
import { DEBOUNCE_MS, SIGN_URL_TTL_MARGIN, SIGN_URL_EXPIRES_PARAM, PORTRAIT_VIDEO_MAX_HEIGHT_RATIO, VIDEO_DRAG_SEEK_THRESHOLD, VIDEO_DOUBLE_CLICK_MS } from '../../config';
import PlayerLayout from './PlayerLayout';

/** 进度浮层时间格式化（浏览器原生 Intl，UTC 基准）：0 秒显示 0:00、分钟不补前导零；支持 >=24h 不进位 */
const seekTimeFormatter = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'UTC'
});

function formatSeekTime(seconds: number): string {
    const total = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(total / 3600);
    // Intl 只格式化不足一天的部分，避免 Date 对象对 >=24h 进位丢失真实小时数
    const dayPart = total % 86400;
    const str = seekTimeFormatter.format(new Date(dayPart * 1000)); // "HH:MM:SS"
    if (hours === 0) {
        // 不足 1 小时：去掉 0 小时段 + 分钟不补前导零 → 0:00 / 5:00
        return str.slice(3).replace(/^0/, '');
    }
    // >=1 小时：真实小时 + Intl 的 MM:SS（分钟/秒保留补零），小时不补前导零 → 1:00:00 / 25:00:00
    return `${hours}:${str.slice(3)}`;
}

interface Props {
    media: Media;
}

export default function VideoPlayer({ media }: Props) {
    const { t } = useTranslation();
    const playlist = usePlaylistStore();
    const playerSettings = usePlayerSettings();
    const videoRef = useRef<HTMLVideoElement>(null);
    const playerRef = useRef<{ dispose: () => void } | null>(null);
    const autoPlayVideo = playerSettings.autoPlayVideo;
    const savedPlaybackRate = playerSettings.playbackRate;
    const savedVolume = playerSettings.volume;
    const savedMuted = playerSettings.muted;
    const { streamUrl } = useStreamToken(media.id, media.streamUrl);
    // 竖屏视频限制宽度（px），null 表示不限制
    const [portraitMaxWidth, setPortraitMaxWidth] = useState<number | null>(null);
    // 视频画面拖动进度浮层（拖动 seek 时显示目标时间）
    const [seekOverlay, setSeekOverlay] = useState<{ current: number; duration: number } | null>(null);

    useEffect(() => {
        if (!videoRef.current) return;
        let disposed = false;

        import('video.js').then((mod) => {
            if (disposed || !videoRef.current) return;
            const videojs = mod.default;
            const player = videojs(videoRef.current, {
                controls: true,
                autoplay: autoPlayVideo,
                preload: 'auto',
                fluid: true,
                playbackRates: [0.5, 1, 1.5, 2],
                // 桌面端保留 video.js 默认点击行为（单击 toggle 播放/暂停、双击全屏）
                // 移动端点击由下方 tap 双击判定接管（video.js 触摸端不产生原生 click/dblclick）
                userActions: { hotkeys: true }
            });
            playerRef.current = player;

            player.ready(() => {
                // 应用持久化的播放速度
                player.playbackRate(savedPlaybackRate);

                // 应用持久化的音量
                player.volume(savedVolume);

                // 应用持久化的静音状态
                player.muted(savedMuted);

                // 视频全屏/退出时通知 PWAProvider 释放/恢复方向锁
                player.on('fullscreenchange', () => {
                    const event = player.isFullscreen() ? 'vjs-fullscreen-enter' : 'vjs-fullscreen-exit';
                    document.dispatchEvent(new CustomEvent(event));
                });

                async function refreshStream(): Promise<boolean> {
                    try {
                        const data = await Api.refreshStreamToken(media.id);
                        if (disposed || !videoRef.current) return false;
                        const newUrl = resolveApiUrl(data.streamUrl);
                        const video = videoRef.current;
                        if (video.src.endsWith(newUrl)) return false;
                        const ct = video.currentTime;
                        const wasPaused = video.paused;
                        video.src = newUrl;
                        video.currentTime = ct;
                        if (!wasPaused) video.play().catch(() => { });
                        return true;
                    } catch {
                        return false;
                    }
                }

                // 处理媒体播放错误：先尝试刷新签名重试，仍失败才报错
                player.on('error', async () => {
                    const err = player.error();
                    if (!err) return;
                    if (err.code !== 3 && await refreshStream()) return;
                    let errMsg: string;
                    switch (err.code) {
                        case 4: errMsg = t('view.errorFormatUnsupported', { mimeType: media.mimeType }); break;
                        case 3: errMsg = t('view.errorDecodeFailed'); break;
                        case 2: errMsg = t('view.errorNetwork'); break;
                        default: errMsg = t('view.errorUnknown', { code: err.code, message: err.message || '' }); break;
                    }
                    console.error('[VideoPlayer] 播放错误:', errMsg, err);
                });

                // 监听倍速变化并持久化
                player.on('ratechange', () => {
                    const rate = player.playbackRate() ?? 1;
                    if (rate !== usePlayerSettings.getState().playbackRate) {
                        usePlayerSettings.getState().setPlaybackRate(rate);
                    }
                });

                // 监听音量/静音变化并持久化
                // 注意：video.js 的 muted 变化只会触发 volumechange 事件（实测 mutedchange 不触发），
                // 因此 muted 同步并入这里处理；muted 时 player.volume() 仍返回实际音量值，不会误写
                player.on('volumechange', () => {
                    const vol = player.volume() ?? 1;
                    if (vol !== usePlayerSettings.getState().volume) {
                        usePlayerSettings.getState().setVolume(vol);
                    }
                    const muted = player.muted() ?? false;
                    if (muted !== usePlayerSettings.getState().muted) {
                        usePlayerSettings.getState().setMuted(muted);
                    }
                });
                // 加载元数据后处理非标准分辨率适配
                const el = videoRef.current;
                if (el) {
                    const onMeta = () => {
                        const vw = el.videoWidth,
                            vh = el.videoHeight;
                        if (vw > 0 && vh > 0 && vh > vw) {
                            // 竖屏视频：限制宽度使高度不超过视口的指定比例
                            const maxH = window.innerHeight * PORTRAIT_VIDEO_MAX_HEIGHT_RATIO;
                            const maxW = maxH * (vw / vh);
                            setPortraitMaxWidth(Math.round(maxW));
                        } else {
                            setPortraitMaxWidth(null);
                        }
                    };
                    el.addEventListener('loadedmetadata', onMeta, { once: true });
                    // 如果已加载则直接触发
                    if (el.readyState >= 1) onMeta();
                }

                // 当前媒体结束时根据播放模式处理下一项
                player.on('ended', () => {
                    const nextIdx = usePlaylistStore.getState().getNextIndex();
                    if (nextIdx >= 0) {
                        const item = usePlaylistStore.getState().queue[nextIdx];
                        if (item && item.id === media.id) {
                            // 单曲循环（repeatOne）：直接重播，无需重新串流
                            player.currentTime(0);
                            player.play();
                        } else if (item) {
                            // 切换到下一项，PlayerPage 会监听 store 变化自动加载
                            usePlaylistStore.setState({ currentIndex: nextIdx });
                        }
                    }
                });

                // seek 完成后检查签名是否即将过期，防抖避免频繁 seek 触发多次刷新
                let seekTimer: ReturnType<typeof setTimeout> | null = null;
                player.on('seeked', () => {
                    if (seekTimer) clearTimeout(seekTimer);
                    seekTimer = setTimeout(() => {
                        seekTimer = null;
                        const curSrc = videoRef.current?.src;
                        const expires = curSrc ? parseInt(new URL(curSrc).searchParams.get(SIGN_URL_EXPIRES_PARAM) || '0', 10) : 0;
                        if (expires && expires - Math.floor(Date.now() / 1000) > SIGN_URL_TTL_MARGIN) return;
                        refreshStream();
                    }, DEBOUNCE_MS);
                });
            });
        });

        return () => {
            disposed = true;
            if (playerRef.current) {
                playerRef.current.dispose();
                playerRef.current = null;
            }
        };
    }, []);

    // 键盘快捷键：无 Ctrl 时控制播放器（音量/快进快退/播放暂停）
    useEffect(() => {
        const el = videoRef.current;
        if (!el) return;
        const handler = (e: KeyboardEvent) => {
            if (e.ctrlKey || e.metaKey) return;
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
            switch (e.key) {
                case 'ArrowUp':
                    e.preventDefault();
                    el.volume = Math.min(1, (el.volume || 0) + 0.1);
                    usePlayerSettings.getState().setVolume(el.volume);
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    el.volume = Math.max(0, (el.volume || 0) - 0.1);
                    usePlayerSettings.getState().setVolume(el.volume);
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    el.currentTime = Math.max(0, el.currentTime - 5);
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    el.currentTime = Math.min(el.duration || 0, el.currentTime + 5);
                    break;
                case ' ':
                    e.preventDefault();
                    if (el.paused) el.play().catch(() => { });
                    else el.pause();
                    break;
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, []);

    // 视频画面手势：点按后横向滑动，跟随手指位移调整播放进度（类似主流移动端播放器）
    useEffect(() => {
        const videoEl = videoRef.current;
        if (!videoEl) return;

        interface DragState {
            pointerId: number;
            startX: number;
            startTime: number;
            lastTime: number;
            active: boolean;
            wasPlaying: boolean;
        }
        let dragState: DragState | null = null;
        // 移动端双击判定（基于 pointerup，比 video.js tap 更即时；桌面端不参与，保留 video.js 默认）
        let lastTap = 0;
        let tapTimer: number | null = null;

        const onPointerDown = (e: PointerEvent) => {
            const target = e.target as HTMLElement | null;
            // 仅响应视频画面（排除控制栏/大播放按钮等 video.js 覆盖层）
            if (target && target.closest?.('.vjs-control-bar, .vjs-big-play-button')) return;
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            const cur = videoEl.currentTime || 0;
            dragState = {
                pointerId: e.pointerId,
                startX: e.clientX,
                startTime: cur,
                lastTime: cur,
                active: false,
                wasPlaying: !videoEl.paused
            };
            try { videoEl.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        };

        const onPointerMove = (e: PointerEvent) => {
            if (!dragState || e.pointerId !== dragState.pointerId) return;
            const dur = videoEl.duration;
            if (!isFinite(dur) || dur <= 0) return;
            const dx = e.clientX - dragState.startX;
            if (!dragState.active) {
                if (Math.abs(dx) < VIDEO_DRAG_SEEK_THRESHOLD) return;
                dragState.active = true;
                // 拖动期间暂停定格，便于精确拖动；松手后按原状态恢复
                if (dragState.wasPlaying) videoEl.pause();
            }
            const width = videoEl.clientWidth || 1;
            const newTime = Math.min(Math.max(dragState.startTime + (dx / width) * dur, 0), dur);
            dragState.lastTime = newTime;
            setSeekOverlay({ current: newTime, duration: dur });
        };

        const onPointerUp = (e: PointerEvent) => {
            if (!dragState || e.pointerId !== dragState.pointerId) return;
            const { active, lastTime, wasPlaying } = dragState;
            dragState = null;
            try { videoEl.releasePointerCapture(e.pointerId); } catch { /* ignore */ }

            if (active) {
                // 拖拽 seek 结束
                videoEl.currentTime = lastTime;
                setSeekOverlay(null);
                if (wasPlaying) videoEl.play().catch(() => { });
                return;
            }

            // 轻点：桌面端（mouse）交给 video.js 默认（单击 toggle / 双击全屏），不干预；
            // 移动端触摸（touch）用 pointerup 即时判定双击 → 切换播放/暂停
            if (e.pointerType === 'mouse') return;

            const now = Date.now();
            if (now - lastTap < VIDEO_DOUBLE_CLICK_MS) {
                // 第二次轻点 → 双击：立即切换播放/暂停
                lastTap = 0;
                if (tapTimer !== null) { window.clearTimeout(tapTimer); tapTimer = null; }
                if (videoEl.paused) videoEl.play().catch(() => { });
                else videoEl.pause();
            } else {
                // 第一次轻点：等待可能的第二次轻点（双击），期间不切换
                lastTap = now;
                if (tapTimer !== null) window.clearTimeout(tapTimer);
                tapTimer = window.setTimeout(() => { tapTimer = null; lastTap = 0; }, VIDEO_DOUBLE_CLICK_MS);
            }
        };

        const onPointerCancel = (e: PointerEvent) => {
            if (dragState && e.pointerId === dragState.pointerId) {
                dragState = null;
                setSeekOverlay(null);
            }
        };

        // pointer 手势：拖拽 seek + 移动端双击判定
        // （桌面端单击/双击保留 video.js 默认；video.js 无画布拖拽 seek 能力，必须自定义）
        videoEl.addEventListener('pointerdown', onPointerDown);
        videoEl.addEventListener('pointermove', onPointerMove);
        videoEl.addEventListener('pointerup', onPointerUp);
        videoEl.addEventListener('pointercancel', onPointerCancel);
        return () => {
            videoEl.removeEventListener('pointerdown', onPointerDown);
            videoEl.removeEventListener('pointermove', onPointerMove);
            videoEl.removeEventListener('pointerup', onPointerUp);
            videoEl.removeEventListener('pointercancel', onPointerCancel);
        };
    }, [media.id]);

    return (
        <PlayerLayout media={media} mediaWrapperStyle={portraitMaxWidth ? { maxWidth: portraitMaxWidth } : undefined}>
            <div className="video-gesture-wrap">
                <video ref={videoRef} className="video-js vjs-default-skin vjs-big-play-centered" controls autoPlay={autoPlayVideo} preload="auto">
                    <source src={streamUrl} type={media.mimeType} />
                </video>
                {seekOverlay && (
                    <div className="video-seek-overlay">
                        <span>{formatSeekTime(seekOverlay.current)}</span>
                        <span className="seek-divider">/</span>
                        <span>{formatSeekTime(seekOverlay.duration)}</span>
                    </div>
                )}
            </div>
        </PlayerLayout>
    );
}
