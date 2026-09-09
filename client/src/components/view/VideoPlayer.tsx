import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Api } from '../../api';
import type { Media } from '../../types';
import { usePlaylistStore } from '../../stores/playlist';
import { usePlayerSettings } from '../../stores/playerSettings';
import { useLatest } from '../../hooks/useLatest';
import { useStreamToken } from '../../hooks/useStreamToken';
import { resolveApiUrl } from '../../api';
import { DEBOUNCE_MS, SIGN_URL_TTL_MARGIN, SIGN_URL_EXPIRES_PARAM, PORTRAIT_VIDEO_MAX_HEIGHT_RATIO, VIDEO_DRAG_SEEK_THRESHOLD, VIDEO_DOUBLE_CLICK_MS } from '../../config';
import PlayerLayout from './PlayerLayout';
import MediaLoading from '../feedback/MediaLoading';

/**
 * 进度浮层时间格式化（浏览器原生 Intl，UTC 基准）：0 秒显示 0:00、分钟不补前导零；支持 >=24h 不进位
 */
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
    // 换源用到的 video.js 实例方法（完整实例在初始化 effect 中赋值，兼容此最小接口）
    const playerRef = useRef<{
        dispose: () => void;
        src: (source: { src: string; type: string }) => void;
        currentTime: (t: number) => void;
        one: (event: string, cb: () => void) => void;
        play: () => Promise<any> | undefined;
    } | null>(null);
    // video.js 播放器根元素（.video-js）：拖动进度浮层的 Portal 挂载点。
    // 必须挂在这里——全屏时全屏的是该元素，浮层留在其外部（如 gesture-wrap）会被
    // 全屏子树完全遮蔽（祖先不在全屏内，z-index 无解）
    const playerElRef = useRef<HTMLElement | null>(null);
    // 最新 media 引用（video.js 初始化/事件闭包用，避免切歌后闭包过期）
    const mediaRef = useLatest(media);
    // 已换源的 media id（首帧由 <source> 提供，无需换源）
    const lastMediaIdRef = useRef<string | null>(null);
    const autoPlayVideo = playerSettings.autoPlayVideo;
    const savedPlaybackRate = playerSettings.playbackRate;
    const savedVolume = playerSettings.volume;
    const savedMuted = playerSettings.muted;
    const { streamUrl } = useStreamToken(media.id, media.streamUrl);
    // 竖屏视频限制宽度（px），null 表示不限制
    const [portraitMaxWidth, setPortraitMaxWidth] = useState<number | null>(null);
    // 媒体是否就绪（换源加载中显示占位；首帧由 video.js 自带 loading，不占位）
    const [mediaReady, setMediaReady] = useState(true);
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
            // 记录 player 根元素（拖动进度浮层 Portal 挂载点，保证全屏时可见）
            playerElRef.current = player.el() as HTMLElement;

            player.ready(() => {
                // 应用持久化的播放速度
                player.playbackRate(savedPlaybackRate);

                // 应用持久化的音量
                player.volume(savedVolume);

                // 应用持久化的静音状态
                player.muted(savedMuted);

                // 视频全屏/退出时通知 PWAProvider 释放/恢复方向锁
                // detail 携带视频内容方向（宽高比），供方向锁兜底决策（横视频→横屏/竖视频→竖屏）
                player.on('fullscreenchange', () => {
                    const el = videoRef.current;
                    const vw = el?.videoWidth ?? 0;
                    const vh = el?.videoHeight ?? 0;
                    const isPortraitVideo = vw > 0 && vh > 0 && vh > vw;
                    const event = player.isFullscreen() ? 'vjs-fullscreen-enter' : 'vjs-fullscreen-exit';
                    document.dispatchEvent(new CustomEvent(event, { detail: { portraitVideo: isPortraitVideo } }));
                });

                // 全屏控制栏"旋转屏幕"按钮：仅全屏时显示，点击派发 vjs-rotate 事件，
                // 由 PWAProvider 执行 screen.orientation.lock(相反方向)（W3C 官方 rotate 范式）。
                // 不依赖传感器：manifest 竖屏锁下 devicemotion 为空壳事件（实测），手动旋转
                // 是全屏横竖切换的唯一可靠路径。
                // 图标：元素挂 vjs-icon-repeat class，直接命中 vjs 字体图标全局定义
                const ControlBar = player.getChild('controlBar');
                if (ControlBar && !ControlBar.getChild('rotateButton')) {
                    const BaseButton = videojs.getComponent('Button');
                    if (BaseButton) {
                        class RotateButton extends BaseButton {
                            buildCSSClass() {
                                return `vjs-rotate-button ${super.buildCSSClass()}`;
                            }
                            handleClick() {
                                document.dispatchEvent(new CustomEvent('vjs-rotate'));
                            }
                            createEl() {
                                const el = super.createEl();
                                el.setAttribute('title', t('pwa.rotateScreen'));
                                return el;
                            }
                        }
                        videojs.registerComponent('RotateButton', RotateButton);
                        // 插入到全屏按钮（controlBar 末尾倒数第一）之前
                        ControlBar.addChild('RotateButton', {}, ControlBar.children().length - 1);
                    }
                }

                async function refreshStream(): Promise<boolean> {
                    try {
                        const data = await Api.refreshStreamToken(mediaRef.current.id);
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
                        case 4: errMsg = t('view.errorFormatUnsupported', { mimeType: mediaRef.current.mimeType }); break;
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
                        if (item && item.id === mediaRef.current.id) {
                            // 单曲循环（repeatOne）：直接重播，无需重新串流
                            player.currentTime(0);
                            player.play();
                        } else if (item) {
                            // 切换到下一项，ViewPage 会监听 store 变化自动加载
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

    // media 变化 → 复用 video.js 实例换源（替代 key 重建，避免卸载重建的整页重载感）
    useEffect(() => {
        const currentId = mediaRef.current.id;
        if (lastMediaIdRef.current === null) {
            // 首帧：源由 <source> 元素提供，仅记录不换源
            lastMediaIdRef.current = currentId;
            return;
        }
        if (lastMediaIdRef.current === currentId) return;
        const player = playerRef.current;
        if (!player) return; // 初始化未完成（异常时序），跳过
        // 用 media.streamUrl（同步 prop）而非 hook 的 streamUrl：后者是 state，media 变化后
        // 本渲染闭包仍持旧 URL（useStreamToken 的 setState 异步生效），会导致换源加载错误媒体
        const url = resolveApiUrl(media.streamUrl ?? '');
        if (!url) return;
        lastMediaIdRef.current = currentId;
        setMediaReady(false);
        player.src({ src: url, type: mediaRef.current.mimeType });
        player.currentTime(0);
        setSeekOverlay(null);
        setPortraitMaxWidth(null);
        // 新源就绪后隐藏占位。注意：不能查 readyState——player.src() 后立即查询返回的是旧源残留值，
        // 会误判已就绪导致占位从不显示。loadeddata 是异步事件，慢加载期间占位保持，失败时 error 也会解除
        const onLoaded = () => {
            if (lastMediaIdRef.current !== mediaRef.current.id) return; // 已切到其他项
            setMediaReady(true);
        };
        player.one('loadeddata', onLoaded);
        player.one('error', onLoaded);
        if (autoPlayVideo) player.play()?.catch(() => { });
    }, [media.id]);

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

        // 拖动期间仅更新 vjs 控制栏进度条的显示（width + 当前时间文本），不调 currentTime——
        // 拖动中视频已暂停 → 无 timeupdate → video.js 不会覆盖内联样式，时序安全；
        // 松手真正 seek 后 timeupdate 触发，video.js 自动接管并覆写为准确值。
        // 注意时间文本必须改 textNode 的 nodeValue（不能写 textContent）：TimeDisplay
        // 内部持有 textNode_ 引用且要求它始终是 contentEl_ 的 firstChild，
        // textContent 赋值会整体替换子节点 → 触发 "Prevented replacement of text node" 警告
        const previewSeek = (t: number, dur: number) => {
            const playerEl = playerElRef.current;
            if (!playerEl || !isFinite(dur) || dur <= 0) return;
            const pct = Math.min(Math.max((t / dur) * 100, 0), 100);
            const playBar = playerEl.querySelector<HTMLElement>('.vjs-progress-control .vjs-play-progress');
            if (playBar) {
                playBar.style.width = `${pct}%`;
                playBar.setAttribute('data-current-time', formatSeekTime(t));
            }
            const cur = playerEl.querySelector<HTMLElement>('.vjs-current-time-display .vjs-time-text, .vjs-current-time-display');
            const textNode = cur?.firstChild;
            if (textNode && textNode.nodeType === Node.TEXT_NODE) {
                textNode.nodeValue = formatSeekTime(t); // 原地改值，节点结构不变
            } else if (cur) {
                cur.textContent = formatSeekTime(t); // 结构异常的兜底（video.js 会自愈重建）
            }
        };

        // 拖动激活后，浏览器会在 pointerup 后派发合成 click，video.js 的
        // handleTechClick_ 会把它当作一次点击切换播放状态：播放中拖动松手后被暂停、
        // 暂停中被误播。捕获阶段拦截 pointerup 后的第一个 click（实测 target=vjs-tech，
        // 到达间隔 <20ms，300ms 窗口富余）。
        const suppressNextClick = () => {
            const swallow = (e: MouseEvent) => {
                videoEl.removeEventListener('click', swallow, true);
                window.clearTimeout(suppressTimer);
                e.preventDefault();
                e.stopPropagation();
            };
            videoEl.addEventListener('click', swallow, true);
            // 兜底移除：若无后续 click，窗口自动失效（拦到时提前清除）
            const suppressTimer = window.setTimeout(() => videoEl.removeEventListener('click', swallow, true), 300);
        };

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
            try { videoEl.setPointerCapture(e.pointerId); } catch { // ignore
            }
        };

        const onPointerMove = (e: PointerEvent) => {
            if (!dragState || e.pointerId !== dragState.pointerId) return;
            const dur = videoEl.duration;
            if (!isFinite(dur) || dur <= 0) return;
            const dx = e.clientX - dragState.startX;
            if (!dragState.active) {
                if (Math.abs(dx) < VIDEO_DRAG_SEEK_THRESHOLD) return;
                dragState.active = true;
                // 拖动期间暂停定格，便于精确拖动；松手后按原状态恢复。
                // （合成 click 的拦截在 pointerup 时布置——click 在 up 之后才派发，
                //   激活时布置会在长拖动中过期失效，实测日志已证实）
                if (dragState.wasPlaying) videoEl.pause();
            }
            const width = videoEl.clientWidth || 1;
            const newTime = Math.min(Math.max(dragState.startTime + (dx / width) * dur, 0), dur);
            dragState.lastTime = newTime;
            previewSeek(newTime, dur); // 同步 vjs 进度条显示（不实际 seek）
            setSeekOverlay({ current: newTime, duration: dur });
        };

        const onPointerUp = (e: PointerEvent) => {
            if (!dragState || e.pointerId !== dragState.pointerId) return;
            const { active, lastTime, wasPlaying } = dragState;
            dragState = null;
            try { videoEl.releasePointerCapture(e.pointerId); } catch { // ignore
            }

            if (active) {
                // 拖拽 seek 结束：真实 seek + 拦截紧随其后的合成 click + 恢复原播放状态
                videoEl.currentTime = lastTime;
                setSeekOverlay(null);
                suppressNextClick();
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

        // 清除拖动预览对 vjs 进度条的内联样式篡改，恢复 video.js 自管显示
        // （时间文本直接写回真实播放位置，同样走 nodeValue，见 previewSeek 注释）
        const clearPreview = () => {
            const playerEl = playerElRef.current;
            if (!playerEl) return;
            const playBar = playerEl.querySelector<HTMLElement>('.vjs-progress-control .vjs-play-progress');
            playBar?.style.removeProperty('width');
            playBar?.removeAttribute('data-current-time');
            const cur = playerEl.querySelector<HTMLElement>('.vjs-current-time-display');
            const textNode = cur?.firstChild;
            if (textNode && textNode.nodeType === Node.TEXT_NODE) {
                textNode.nodeValue = formatSeekTime(videoEl.currentTime || 0);
            }
        };

        const onPointerCancel = (e: PointerEvent) => {
            if (dragState && e.pointerId === dragState.pointerId) {
                if (dragState.active) clearPreview(); // 已动过进度条显示才需要恢复
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
            {/* 占位放 gesture-wrap 外层：video.js 会把 <video> 移入 .video-js 容器，
                与 video 平级的兄弟会被 React/video.js 双重管理导致 insertBefore 报错 */}
            {!mediaReady && <MediaLoading />}
            <div className="video-gesture-wrap">
                <video ref={videoRef} className="video-js vjs-default-skin vjs-big-play-centered" controls autoPlay={autoPlayVideo} preload="auto">
                    <source src={streamUrl} type={media.mimeType} />
                </video>
                {/* 拖动进度浮层：Portal 进 player 根元素（.video-js），全屏时该元素即全屏
                    根，浮层随之进入全屏子树；非全屏时视觉位置不变（absolute 居中于播放器） */}
                {seekOverlay && playerElRef.current && createPortal(
                    <div className="video-seek-overlay">
                        <span>{formatSeekTime(seekOverlay.current)}</span>
                        <span className="seek-divider">/</span>
                        <span>{formatSeekTime(seekOverlay.duration)}</span>
                    </div>,
                    playerElRef.current
                )}
            </div>
        </PlayerLayout>
    );
}
