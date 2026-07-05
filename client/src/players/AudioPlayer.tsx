import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Api } from '../api';
import type { Media } from '../types';
import { usePlaylistStore } from '../stores/playlist';
import { useStreamToken } from '../hooks/useStreamToken';
import { resolveApiUrl } from '../api';
import { normalizeMimeType } from '../utils';
import PlayerLayout from './PlayerLayout';

interface Props {
    media: Media;
}

export default function AudioPlayer({ media }: Props) {
    const navigate = useNavigate();
    const playlist = usePlaylistStore();
    const audioRef = useRef<HTMLAudioElement>(null);
    const { streamUrl, refresh } = useStreamToken(media.id, media.streamUrl);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;
        let seekRefreshed = false;
        const onEnded = () => {
            const nextIdx = usePlaylistStore.getState().getNextIndex();
            if (nextIdx >= 0) {
                const item = usePlaylistStore.getState().queue[nextIdx];
                usePlaylistStore.setState({ currentIndex: nextIdx });
                if (item) {
                    if (item.id === media.id) {
                        // 单曲循环（repeatOne）：直接重播，无需重新串流
                        audio.currentTime = 0;
                        audio.play();
                    } else {
                        navigate('/player/' + item.id);
                    }
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
                <source src={streamUrl} type={normalizeMimeType(media.mimeType)} />
            </audio>
        </PlayerLayout>
    );
}
