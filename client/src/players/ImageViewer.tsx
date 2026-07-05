import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Media } from '../types';
import { formatDuration } from '../utils';
import { usePlaylistStore } from '../stores/playlist';
import { usePlayerSettings } from '../stores/playerSettings';
import { resolveApiUrl } from '../api';
import { IMAGE_SLIDE_INTERVAL_MS } from '../config';
import PlayerLayout from './PlayerLayout';

interface Props {
    media: Media;
}

export default function ImageViewer({ media }: Props) {
    const navigate = useNavigate();
    const playlist = usePlaylistStore();
    const [countdown, setCountdown] = useState(0);

    // 静态图片自动定时切换 + 倒计时
    useEffect(() => {
        const dur = usePlayerSettings.getState().staticImageDuration;
        if (dur <= 0) {
            setCountdown(0);
            return;
        }
        setCountdown(dur);
        const interval = setInterval(() => {
            setCountdown((prev) => {
                if (prev <= 1) {
                    clearInterval(interval);
                    const nextIdx = usePlaylistStore.getState().getNextIndex();
                    if (nextIdx >= 0) {
                        const item = usePlaylistStore.getState().queue[nextIdx];
                        usePlaylistStore.setState({ currentIndex: nextIdx });
                        if (item) navigate('/player/' + item.id);
                    }
                    return 0;
                }
                return prev - 1;
            });
        }, IMAGE_SLIDE_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [media.id]);
    return (
        <PlayerLayout
            media={media}
            mediaWrapperClass="image-wrapper"
            countdown={countdown}
            metaExtra={<>{media.duration != null && media.duration > 0 && <span>⏱️ {formatDuration(media.duration)}</span>}</>}
            actionsExtra={null}
        >
            <img src={resolveApiUrl(media.streamUrl ?? '')} alt={media.title} className="image-display" />
        </PlayerLayout>
    );
}
