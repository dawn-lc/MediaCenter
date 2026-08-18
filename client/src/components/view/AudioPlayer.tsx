import { useEffect, useRef } from 'react';
import { Api } from '../../api';
import type { Media } from '../../types';
import { usePlaylistStore } from '../../stores/playlist';
import { usePlayerSettings } from '../../stores/playerSettings';
import { useStreamToken } from '../../hooks/useStreamToken';
import { resolveApiUrl } from '../../api';
import PlayerLayout from './PlayerLayout';

interface Props {
    media: Media;
}

export default function AudioPlayer({ media }: Props) {
    const playlist = usePlaylistStore();
    const audioRef = useRef<HTMLAudioElement>(null);
    const { streamUrl, refresh } = useStreamToken(media.id, media.streamUrl);
    const savedVolume = usePlayerSettings((s) => s.volume);
    const savedMuted = usePlayerSettings((s) => s.muted);

    // 应用持久化音量+静音 + 监听用户调整写回 store（与 VideoPlayer 的同步一致）
    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;
        audio.volume = savedVolume;
        audio.muted = savedMuted;
        const onVolumeChange = () => {
            // 原生 audio 的 muted 变化也触发 volumechange 事件，一并同步
            const vol = audio.volume ?? 1;
            if (vol !== usePlayerSettings.getState().volume) {
                usePlayerSettings.getState().setVolume(vol);
            }
            const muted = audio.muted;
            if (muted !== usePlayerSettings.getState().muted) {
                usePlayerSettings.getState().setMuted(muted);
            }
        };
        audio.addEventListener('volumechange', onVolumeChange);
        return () => audio.removeEventListener('volumechange', onVolumeChange);
    }, [savedVolume, savedMuted]);

    // 键盘快捷键：无 Ctrl 时控制播放器（音量/快进快退/播放暂停），与 VideoPlayer 一致
    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;
        const handler = (e: KeyboardEvent) => {
            if (e.ctrlKey || e.metaKey) return;
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
            switch (e.key) {
                case 'ArrowUp':
                    e.preventDefault();
                    audio.volume = Math.min(1, (audio.volume || 0) + 0.1);
                    usePlayerSettings.getState().setVolume(audio.volume);
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    audio.volume = Math.max(0, (audio.volume || 0) - 0.1);
                    usePlayerSettings.getState().setVolume(audio.volume);
                    break;
                case 'm':
                case 'M':
                    e.preventDefault();
                    audio.muted = !audio.muted;
                    usePlayerSettings.getState().setMuted(audio.muted);
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    audio.currentTime = Math.max(0, audio.currentTime - 5);
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5);
                    break;
                case ' ':
                    e.preventDefault();
                    if (audio.paused) audio.play().catch(() => { });
                    else audio.pause();
                    break;
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, []);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;
        let seekRefreshed = false;
        const onEnded = () => {
            const nextIdx = usePlaylistStore.getState().getNextIndex();
            if (nextIdx >= 0) {
                const item = usePlaylistStore.getState().queue[nextIdx];
                if (item && item.id === media.id) {
                    // 单曲循环（repeatOne）：直接重播，无需重新串流
                    audio.currentTime = 0;
                    audio.play();
                } else if (item) {
                    // 切换到下一项，PlayerPage 会监听 currentIndex 变化自动加载
                    usePlaylistStore.setState({ currentIndex: nextIdx });
                }
            }
        };
        const onSeeking = async () => {
            if (seekRefreshed) return;
            seekRefreshed = true;
            try {
                const data = await Api.refreshStreamToken(media.id);
                const ct = audio.currentTime;
                const wasPaused = audio.paused;
                audio.src = resolveApiUrl(data.streamUrl);
                audio.addEventListener(
                    'loadedmetadata',
                    () => {
                        audio.currentTime = ct;
                        if (!wasPaused) audio.play();
                    },
                    { once: true }
                );
            } catch {
                /* 刷新失败继续用旧源 */
            }
        };
        const onSeeked = () => {
            seekRefreshed = false;
        };
        audio.addEventListener('ended', onEnded);
        audio.addEventListener('seeking', onSeeking);
        audio.addEventListener('seeked', onSeeked);
        return () => {
            audio.removeEventListener('ended', onEnded);
            audio.removeEventListener('seeking', onSeeking);
            audio.removeEventListener('seeked', onSeeked);
        };
    }, [media.id, media.mimeType]);

    return (
        <PlayerLayout media={media} mediaWrapperClass="audio-card">
            <div className="thumb-icon">🎵</div>
            <audio ref={audioRef} controls autoPlay preload="auto" className="audio-player">
                <source src={streamUrl} type={media.mimeType} />
            </audio>
        </PlayerLayout>
    );
}
