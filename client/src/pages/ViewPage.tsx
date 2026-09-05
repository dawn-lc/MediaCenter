import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Api } from '../api';
import { ApiError } from '../apiError';
import { notify } from '../utils/notify';
import type { Media } from '../types';
import { getMediaType } from '../utils';
import { usePlaylistStore } from '../stores/playlist';
import VideoPlayer from '../components/view/VideoPlayer';
import AudioPlayer from '../components/view/AudioPlayer';
import ImageViewer from '../components/view/ImageViewer';
import LoadingState from '../components/feedback/LoadingState';

export default function ViewPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { id } = useParams<{ id: string }>();
    const [media, setMedia] = useState<Media | null>(null);
    const [loading, setLoading] = useState(true);
    const [mediaType, setMediaType] = useState<string>('unknown');
    const [isForbidden, setIsForbidden] = useState(false);
    const loadedIdRef = useRef<string | null>(null); // 避免重复加载
    const isMountedRef = useRef(false); // 标记是否首次挂载完成

    // 从 URL param 初始加载
    useEffect(() => {
        if (!id) return;
        if (loadedIdRef.current === id) return; // 已加载过
        loadedIdRef.current = id;
        // 导航进入/前进后退的滚动由全局 <ScrollRestoration> 管理（PUSH 回顶 / POP 恢复）

        // 在队列中查找当前媒体，同步 currentIndex 让侧边栏高亮正确条目
        const state = usePlaylistStore.getState();
        const idx = state.queue.findIndex((m) => m.id === id);
        if (idx >= 0 && idx !== state.currentIndex) {
            usePlaylistStore.setState({ currentIndex: idx });
        }

        setLoading(true);
        setIsForbidden(false);
        Api.getMedia(id)
            .then((data) => {
                setMedia(data.media);
                setMediaType(getMediaType(data.media.mimeType));
                // 单曲播放判断统一交给「持久化恢复完成兜底 effect」：
                // 此处不判断，避免持久化恢复未完成时（queue 仍为空）误把整队列覆盖成单曲（会阻断恢复）
            })
            .catch((err: Error) => {
                // 403 由页面状态呈现；其余错误统一弹 toast（会话过期自动静默）
                if (err instanceof ApiError && err.status === 403) {
                    setIsForbidden(true);
                } else {
                    notify.error(err);
                }
            })
            .finally(() => setLoading(false));
    }, [id]);

    // 监听播放列表切换（上一首/下一首/点击列表项）→ 不重载页面
    const currentIndex = usePlaylistStore((s) => s.currentIndex);
    const queue = usePlaylistStore((s) => s.queue);
    const isHydrated = usePlaylistStore((s) => s.isHydrated);
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
        // 列表内切歌走 history.replaceState（非导航事件），ScrollRestoration 不触发，
        // 需显式回到顶部，否则会继承上一个播放页的滚动位置
        window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
        setLoading(true);
        setIsForbidden(false);
        Api.getMedia(item.id)
            .then((data) => {
                if (data.media.id !== loadedIdRef.current) return; // 已切换到其他项，忽略过期响应
                setMedia(data.media);
                setMediaType(getMediaType(data.media.mimeType));
                // 静默更新 URL 以保持地址栏同步
                window.history.replaceState(null, '', '/view/' + item.id);
            })
            .catch((err: Error) => {
                if (loadedIdRef.current !== item.id) return; // 已过时
                // 403 由页面状态呈现；其余错误统一弹 toast（会话过期自动静默）
                if (err instanceof ApiError && err.status === 403) {
                    setIsForbidden(true);
                } else {
                    notify.error(err);
                }
            })
            .finally(() => {
                if (loadedIdRef.current === item.id) {
                    setLoading(false);
                }
            });
    }, [currentIndex, queue]);

    // 持久化恢复完成后的单曲兜底：当前媒体不在恢复出的队列 → 设为单曲队列
    // （否则 queue 为空时 getNextIndex 恒为 -1，循环/单曲循环等模式无法重播当前视频）
    useEffect(() => {
        if (!isHydrated || !media) return;
        const st = usePlaylistStore.getState();
        if (!st.queue.some((m) => m.id === media.id)) {
            usePlaylistStore.getState().playAll([media], 0);
        }
    }, [isHydrated, media]);

    // 首次加载（无 media）显示 LoadingState；切歌时保留页面框架，播放器换源平滑过渡
    if (loading && !media) return <LoadingState />;

    if (!media)
        return (
            <div className="empty-state">
                {isForbidden ? (
                    <>
                        <div className="empty-icon">🔒</div>
                        <h3>{t('view.permissionDenied')}</h3>
                        <div className="btn-row-center">
                            <button className="btn btn-secondary" onClick={() => navigate(-1)}>
                                {t('common.back')}
                            </button>
                        </div>
                    </>
                ) : (
                    <>
                        <div className="empty-icon">⚠️</div>
                        <h3>{t('view.loadFailed')}</h3>
                        <div className="btn-row-center">
                            <button className="btn btn-secondary" onClick={() => window.location.reload()}>
                                {t('common.retry')}
                            </button>
                        </div>
                    </>
                )}
            </div>
        );

    // 播放器组件不设 key：media 变化时由播放器内部换源（避免卸载重建导致的整页重载感）
    if (mediaType === 'video') return <VideoPlayer media={media} />;
    if (mediaType === 'audio') return <AudioPlayer media={media} />;
    if (mediaType === 'image') return <ImageViewer media={media} />;

    return (
        <div className="empty-state">
            <div className="empty-icon">📁</div>
            <h3>{t('view.cannotPreview')}</h3>
        </div>
    );
}
