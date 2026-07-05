import { useEffect, useRef, useState } from 'react';
import { Api } from '../api';
import type { Media } from '../types';
import { usePlaylistStore } from '../stores/playlist';
import { usePlayerSettings } from '../stores/playerSettings';
import { useStreamToken } from '../hooks/useStreamToken';
import { resolveApiUrl } from '../api';
import { DEBOUNCE_MS, SIGN_URL_TTL_MARGIN, SIGN_URL_EXPIRES_PARAM, PORTRAIT_VIDEO_MAX_HEIGHT_RATIO } from '../config';
import { normalizeMimeType } from '../utils';
import PlayerLayout from './PlayerLayout';

interface Props {
    media: Media;
}

export default function VideoPlayer({ media }: Props) {
    const playlist = usePlaylistStore();
    const playerSettings = usePlayerSettings();
    const videoRef = useRef<HTMLVideoElement>(null);
    const playerRef = useRef<{ dispose: () => void } | null>(null);
    const autoPlayVideo = playerSettings.autoPlayVideo;
    const savedPlaybackRate = playerSettings.playbackRate;
    const savedVolume = playerSettings.volume;
    const { streamUrl } = useStreamToken(media.id, media.streamUrl);
    // 竖屏视频限制宽度（px），null 表示不限制
    const [portraitMaxWidth, setPortraitMaxWidth] = useState<number | null>(null);

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
                userActions: { hotkeys: true }
            });
            playerRef.current = player;

            player.ready(() => {
                // 应用持久化的播放速度
                player.playbackRate(savedPlaybackRate);

                // 应用持久化的音量
                player.volume(savedVolume);

                // 监听倍速变化并持久化
                player.on('ratechange', () => {
                    const rate = player.playbackRate() ?? 1;
                    if (rate !== usePlayerSettings.getState().playbackRate) {
                        usePlayerSettings.getState().setPlaybackRate(rate);
                    }
                });

                // 监听音量变化并持久化
                player.on('volumechange', () => {
                    const vol = player.volume() ?? 1;
                    if (vol !== usePlayerSettings.getState().volume) {
                        usePlayerSettings.getState().setVolume(vol);
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

                async function refreshStream() {
                    try {
                        const data = await Api.refreshStreamToken(media.id);
                        if (disposed || !videoRef.current) return;
                        const newUrl = resolveApiUrl(data.streamUrl);
                        const video = videoRef.current;
                        if (video.src.endsWith(newUrl)) return;
                        const ct = video.currentTime;
                        const wasPaused = video.paused;
                        video.src = newUrl;
                        video.currentTime = ct;
                        if (!wasPaused) video.play().catch(() => { });
                    } catch {
                        /* 刷新失败继续用旧源 */
                    }
                }
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

    return (
        <PlayerLayout media={media} mediaWrapperStyle={portraitMaxWidth ? { maxWidth: portraitMaxWidth } : undefined}>
            <video ref={videoRef} className="video-js vjs-default-skin vjs-big-play-centered" controls autoPlay={autoPlayVideo} preload="auto">
                <source src={streamUrl} type={normalizeMimeType(media.mimeType)} />
            </video>
        </PlayerLayout>
    );
}
