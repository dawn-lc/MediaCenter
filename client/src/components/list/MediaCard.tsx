import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { resolveApiUrl } from '../../api';
import type { Media } from '../../types';
import { formatDate, formatFileSize, getMediaIcon, getMediaTypeLabel } from '../../utils';
import { obtainThumbnailUrl } from '../../utils/thumbnails';

/**
 * 媒体卡片所需字段子集：
 * 兼容完整 Media（媒体库）与 stats.recent 的部分字段（首页），避免强依赖后端返回完整对象
 */
type CardMedia = Pick<Media, 'id' | 'title' | 'mimeType' | 'fileSize' | 'createdAt'> & {
    streamUrl?: string;
    thumbUrl?: string | null;
    deletedAt?: string | null;
    uploaderId?: string;
    uploaderName?: string | null;
    authorId?: string | null;
    authorName?: string | null;
    tags?: { id: string; name: string }[];
};

interface MediaCardProps {
    media: CardMedia;
    /** 显示上传者链接（默认 true） */
    showUploader?: boolean;
    /** 显示作者链接（默认 true） */
    showAuthor?: boolean;
    /** 卡片正文附加内容（如标签列表），渲染在元信息之后 */
    children?: React.ReactNode;
}

/**
 * 媒体卡片（自包含组件）
 * - 缩略图：优先服务端 thumbUrl；无则客户端生成（thumbnails 内部全局并发受限）
 * - 点击进播放页；上传者/作者可点击跳转各自主页
 * - 附加内容（如 TagList）经 children 注入，保持各页面差异内聚在调用方
 */
export default function MediaCard({ media, showUploader = true, showAuthor = true, children }: MediaCardProps) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [thumbSrc, setThumbSrc] = useState<string | null>(media.thumbUrl ? resolveApiUrl(media.thumbUrl) : null);

    // 无服务器缩略图的视频 → 客户端生成（内部有全局并发限制）
    useEffect(() => {
        if (thumbSrc) return;
        if (!media.mimeType.startsWith('video/')) return;
        let cancelled = false;
        void obtainThumbnailUrl(media.id, resolveApiUrl(media.streamUrl)).then((url) => {
            if (!cancelled && url) setThumbSrc(url);
        });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [media.id, media.thumbUrl, media.mimeType, media.streamUrl]);

    return (
        <div className="media-card" onClick={() => navigate('/view/' + media.id)}>
            <div className="media-card-thumb">
                {thumbSrc ? (
                    <img src={thumbSrc} alt={media.title} className="img-cover" loading="lazy" />
                ) : media.mimeType.startsWith('image/') && media.streamUrl ? (
                    <img src={resolveApiUrl(media.streamUrl)} alt={media.title} className="img-cover" loading="lazy" />
                ) : (
                    getMediaIcon(media.mimeType)
                )}
                {media.deletedAt && <span className="media-card-deleted-badge">{t('common.deleted')}</span>}
            </div>
            <div className="media-card-body">
                <h3>{media.title}</h3>
                <div className="media-meta">
                    <span>{getMediaTypeLabel(media.mimeType)}</span>
                    <span>{formatFileSize(media.fileSize)}</span>
                    <span>{formatDate(media.createdAt, t)}</span>
                    {showUploader && media.uploaderName && (
                        <span
                            className="media-uploader"
                            title={t('meta.uploaderLabel')}
                            onClick={(e) => {
                                e.stopPropagation();
                                navigate('/user/' + encodeURIComponent(media.uploaderId!));
                            }}
                        >
                            {media.uploaderName}
                        </span>
                    )}
                    {showAuthor && media.authorName && media.authorId && (
                        <span
                            className="media-author"
                            title={t('meta.authorLabel')}
                            onClick={(e) => {
                                e.stopPropagation();
                                navigate('/author/' + encodeURIComponent(media.authorId!));
                            }}
                        >
                            {media.authorName}
                        </span>
                    )}
                </div>
                {children}
            </div>
        </div>
    );
}
