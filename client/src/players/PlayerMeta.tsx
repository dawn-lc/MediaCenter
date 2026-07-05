import type { Media } from '../types';
import { formatFileSize, formatDate, formatDuration, isValidHttpUrl } from '../utils';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../stores/auth';
import { useNavigate } from 'react-router-dom';
import i18n from '../i18n';

interface PlayerMetaProps {
    media: Media;
    children?: React.ReactNode;
}

function MetaItem({ label, value, children, title }: { label: string; value?: string; children?: React.ReactNode; title?: string }) {
    return (
        <div className="meta-item" title={title}>
            <span className="meta-label">{label}</span>
            {children ?? <span className="meta-value">{value}</span>}
        </div>
    );
}

export default function PlayerMeta({ media, children }: PlayerMetaProps) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const user = useAuthStore((s) => s.user);

    const isAdmin = user?.role === 'admin';
    const isOwner = user?.id === media.uploaderId;
    const isLoggedIn = !!user;

    const roleKey = media.minRole === 'admin' ? 'meta.role.admin'
        : media.minRole === 'owner' ? 'meta.role.owner'
            : media.minRole === 'user' ? 'meta.role.user'
                : 'meta.role.guest';

    const locale = i18n.language;
    const absDate = new Date(media.createdAt).toLocaleString(locale);
    const absDeletedAt = media.deletedAt ? new Date(media.deletedAt).toLocaleString(locale) : undefined;

    return (
        <div className="player-meta">
            {/* 基础文件信息 - 仅管理员可见 */}
            {isAdmin && <MetaItem label={t('meta.fileSizeLabel')} value={formatFileSize(media.fileSize)} />}
            {isAdmin && <MetaItem label={t('meta.mimeTypeLabel')} value={media.mimeType} />}
            <MetaItem label={t('meta.visibilityLabel')} value={t(roleKey)} />
            <MetaItem label={t('meta.dateLabel')} value={formatDate(media.createdAt, t)} title={absDate} />
            {media.duration != null && (
                <MetaItem label={t('meta.durationLabel')} value={formatDuration(media.duration)} />
            )}

            {/* 归属信息 - 登录用户可见上传者和作者 */}
            {isLoggedIn && media.uploaderName && (
                <MetaItem label={t('meta.uploaderLabel')}>
                    <span className="meta-link" onClick={() => navigate('/?uploaderId=' + encodeURIComponent(media.uploaderId))}>
                        {media.uploaderName}
                    </span>
                </MetaItem>
            )}
            {media.author && (
                <MetaItem label={t('meta.authorLabel')}>
                    <span className="meta-link" onClick={() => navigate('/?authorExpr=' + encodeURIComponent(media.author!.name))}>
                        {media.author.name}
                    </span>
                </MetaItem>
            )}
            {isLoggedIn && media.source && isValidHttpUrl(media.source) && (
                <MetaItem label={t('meta.sourceLinkLabel')}>
                    <a href={media.source} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                        {media.source.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                    </a>
                </MetaItem>
            )}

            {/* 技术细节 - 仅管理员可见 */}
            {isAdmin && media.fileName && (
                <MetaItem label={t('meta.fileNameLabel')} value={media.fileName} />
            )}
            {isAdmin && media.fileHash && (
                <MetaItem label={t('meta.fileHashLabel')} value={media.fileHash} />
            )}
            {isAdmin && media.filePath && (
                <MetaItem label={t('meta.filePathLabel')} value={media.filePath} />
            )}

            {children}

            {isAdmin && media.deletedAt && (
                <MetaItem label={t('meta.deletedAtLabel')} value={formatDate(media.deletedAt, t)} title={absDeletedAt} />
            )}
        </div>
    );
}
