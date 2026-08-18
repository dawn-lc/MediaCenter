import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Api } from '../../api';
import MediaCard from '../../components/list/MediaCard';
import Pagination from '../../components/list/Pagination';
import LoadingState from '../../components/feedback/LoadingState';

/** 作者主页媒体分页每页条数 */
const PAGE_SIZE = 12;

/**
 * 公开作者主页（/author/:id，供其他用户访问）
 * - 作者信息（名称/别名/来源链接）
 * - 媒体统计（按当前用户可见范围）
 * - 该作者的媒体分页列表
 */
export default function AuthorPage() {
    const { id } = useParams();
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [page, setPage] = useState(1);

    const { data, isError } = useQuery({
        queryKey: ['public-author', id],
        queryFn: () => Api.getAuthor(id!),
        enabled: !!id
    });

    const { data: mediaList, isFetching } = useQuery({
        queryKey: ['public-author-media', id, page],
        queryFn: () =>
            Api.listMedia({
                authorId: id,
                page,
                limit: PAGE_SIZE,
                sortBy: 'createdAt',
                sortOrder: 'desc'
            }),
        enabled: !!id
    });

    const author = data?.author;
    const stats = data?.stats;
    const items = mediaList?.items || [];
    const totalPages = mediaList?.pagination?.totalPages || 1;

    const goPage = (p: number) => {
        setPage(p);
        window.scrollTo({ top: 0 });
    };

    if (isError) {
        return (
            <div className="empty-state">
                <h2>{t('author.notFound')}</h2>
                <Link to="/" className="btn btn-primary">{t('nav.home')}</Link>
            </div>
        );
    }

    return (
        <div className="author-page">
            <div className="card section-card">
                <div className="author-header">
                    <div className="author-avatar">✒️</div>
                    <div className="author-info">
                        <h1 className="author-name">{author?.name ?? '…'}</h1>
                        {author && (author.altNames || []).length > 0 && (
                            <div className="author-altnames">
                                {(author.altNames || []).map((alt) => (
                                    <span key={alt} className="badge badge-altname">{alt}</span>
                                ))}
                            </div>
                        )}
                        {author && (author.urls || []).length > 0 && (
                            <div className="author-urls">
                                {(author.urls || []).map((url) => (
                                    <a
                                        key={url}
                                        href={url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="url-link"
                                    >
                                        {url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                                    </a>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {stats && (
                <div className="card section-card">
                    <div className="card-header">
                        <h2>{t('author.mediaStats')}</h2>
                    </div>
                    <div className="stat-grid">
                        <div className="stat-card">
                            <div className="stat-value">{stats.total}</div>
                            <div className="stat-label">{t('common.totalMedia')}</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-value">{stats.video}</div>
                            <div className="stat-label">{t('common.videos')}</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-value">{stats.audio}</div>
                            <div className="stat-label">{t('common.audios')}</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-value">{stats.image}</div>
                            <div className="stat-label">{t('common.images')}</div>
                        </div>
                    </div>
                </div>
            )}

            <div className="card section-card">
                <div className="card-header">
                    <h2>{t('author.media')}</h2>
                </div>
                {isFetching && items.length === 0 ? (
                    <LoadingState />
                ) : items.length === 0 ? (
                    <p className="text-muted">{t('author.noMedia')}</p>
                ) : (
                    <>
                        <div className={`grid grid-2${isFetching ? ' grid-loading' : ''}`}>
                            {items.map((item) => (
                                <MediaCard key={item.id} media={item} />
                            ))}
                        </div>
                        <Pagination page={page} totalPages={totalPages} onPageChange={goPage} />
                    </>
                )}
            </div>
        </div>
    );
}
