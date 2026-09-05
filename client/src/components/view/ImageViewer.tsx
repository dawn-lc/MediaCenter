import { useEffect, useState } from 'react';
import type { Media } from '../../types';
import { formatDuration } from '../../utils';
import { usePlaylistStore } from '../../stores/playlist';
import { usePlayerSettings } from '../../stores/playerSettings';
import { resolveApiUrl } from '../../api';
import { IMAGE_SLIDE_INTERVAL_MS } from '../../config';
import PlayerLayout from './PlayerLayout';
import MediaLoading from '../feedback/MediaLoading';

interface Props {
    media: Media;
}

export default function ImageViewer({ media }: Props) {
    const playlist = usePlaylistStore();
    const [countdown, setCountdown] = useState(0);
    // 图片是否已加载（加载中显示占位）
    const [imgReady, setImgReady] = useState(false);

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
                        if (item) {
                            // 切换到下一项，ViewPage 会监听 currentIndex 变化自动加载
                            usePlaylistStore.setState({ currentIndex: nextIdx });
                        }
                    }
                    return 0;
                }
                return prev - 1;
            });
        }, IMAGE_SLIDE_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [media.id]);

    // media 变化 → 显示占位，等 img onLoad 隐藏
    useEffect(() => {
        setImgReady(false);
    }, [media.id]);

    return (
        <PlayerLayout
            media={media}
            mediaWrapperClass="image-wrapper"
            countdown={countdown}
            metaExtra={<>{media.duration != null && media.duration > 0 && <span>⏱️ {formatDuration(media.duration)}</span>}</>}
            actionsExtra={null}
        >
            {!imgReady && <MediaLoading />}
            <img
                src={resolveApiUrl(media.streamUrl ?? '')}
                alt={media.title}
                className="image-display"
                onLoad={() => setImgReady(true)}
                onError={() => setImgReady(true)}
            />
        </PlayerLayout>
    );
}
