import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Api, ApiError } from '../api';
import type { Media } from '../types';
import { getMediaType } from '../utils';
import { usePlaylistStore } from '../stores/playlist';
import VideoPlayer from '../players/VideoPlayer';
import AudioPlayer from '../players/AudioPlayer';
import ImageViewer from '../players/ImageViewer';
import LoadingState from '../components/LoadingState';

export default function PlayerPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { id } = useParams<{ id: string }>();
    const [media, setMedia] = useState<Media | null>(null);
    const [loading, setLoading] = useState(true);
    const [mediaType, setMediaType] = useState<string>('unknown');
    const [errorMsg, setErrorMsg] = useState('');
    const [isForbidden, setIsForbidden] = useState(false);
    const loadedIdRef = useRef<string | null>(null); // 避免重复加载
    const isMountedRef = useRef(false); // 标记是否首次挂载完成

    // 从 URL param 初始加载
    useEffect(() => {
        if (!id) return;
        if (loadedIdRef.current === id) return; // 已加载过
        loadedIdRef.current = id;

        // 在队列中查找当前媒体，同步 currentIndex 让侧边栏高亮正确条目
        const state = usePlaylistStore.getState();
        const idx = state.queue.findIndex((m) => m.id === id);
        if (idx >= 0 && idx !== state.currentIndex) {
            usePlaylistStore.setState({ currentIndex: idx });
        }

        setLoading(true);
        setErrorMsg('');
        setIsForbidden(false);
        Api.getMedia(id)
            .then((data) => {
                setMedia(data.media);
                setMediaType(getMediaType(data.media.mimeType));
            })
            .catch((err: Error) => {
                if (err instanceof ApiError && err.status === 403) {
                    setIsForbidden(true);
                }
                setErrorMsg(err.message);
            })
            .finally(() => setLoading(false));
    }, [id]);

    // 监听播放列表切换（上一首/下一首/点击列表项）→ 不重载页面
    const currentIndex = usePlaylistStore((s) => s.currentIndex);
    const queue = usePlaylistStore((s) => s.queue);
    useEffect(() => {
        // 首次挂载由 URL 驱动 effect 处理，跳过此处避免覆盖
        if (!isMountedRef.current) {
            isMountedRef.current = true;
            return;
        }
        if (currentIndex < 0 || currentIndex >= queue.length) return;
        const item = queue[currentIndex];
        if (!item || item.id === loadedIdRef.current) return;
        loadedIdRef.current = item.id;
        setLoading(true);
        setErrorMsg('');
        setIsForbidden(false);
        Api.getMedia(item.id)
            .then((data) => {
                if (data.media.id !== loadedIdRef.current) return; // 已切换到其他项，忽略过期响应
                setMedia(data.media);
                setMediaType(getMediaType(data.media.mimeType));
                // 静默更新 URL 以保持地址栏同步
                window.history.replaceState(null, '', '/player/' + item.id);
            })
            .catch((err: Error) => {
                if (loadedIdRef.current !== item.id) return; // 已过时
                if (err instanceof ApiError && err.status === 403) {
                    setIsForbidden(true);
                }
                setErrorMsg(err.message);
            })
            .finally(() => {
                if (loadedIdRef.current === item.id) {
                    setLoading(false);
                }
            });
    }, [currentIndex, queue]);

    if (loading) return <LoadingState />;

    if (!media)
        return (
            <div className="empty-state">
                {isForbidden ? (
                    <>
                        <div className="empty-icon">🔒</div>
                        <h3>{t('player.permissionDenied')}</h3>
                        {errorMsg && (
                            <p className="error-msg">
                                {errorMsg}
                            </p>
                        )}
                        <div className="btn-row-center">
                            <button className="btn btn-secondary" onClick={() => navigate(-1)}>
                                {t('common.back')}
                            </button>
                        </div>
                    </>
                ) : (
                    <>
                        <div className="empty-icon">⚠️</div>
                        <h3>{t('player.loadFailed')}</h3>
                        {errorMsg && (
                            <p className="error-msg">
                                {errorMsg}
                            </p>
                        )}
                        <div className="btn-row-center">
                            <button className="btn btn-secondary" onClick={() => window.location.reload()}>
                                {t('common.retry')}
                            </button>
                        </div>
                    </>
                )}
            </div>
        );

    if (mediaType === 'video') return <VideoPlayer key={media.id} media={media} />;
    if (mediaType === 'audio') return <AudioPlayer key={media.id} media={media} />;
    if (mediaType === 'image') return <ImageViewer key={media.id} media={media} />;

    return (
        <div className="empty-state">
            <div className="empty-icon">📁</div>
            <h3>{t('player.cannotPreview')}</h3>
        </div>
    );
}
