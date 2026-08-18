import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Api } from '../../api';
import { useAuthStore } from '../../stores/auth';
import { formatDate } from '../../utils';
import MediaCard from '../../components/list/MediaCard';
import Pagination from '../../components/list/Pagination';
import LoadingState from '../../components/feedback/LoadingState';

/** 用户主页媒体分页每页条数 */
const PAGE_SIZE = 12;

/**
 * 公开用户主页（/user/:id，供其他用户访问）
 * - 用户信息（头像/用户名/角色/注册时间/系统账户标记）
 * - 媒体统计（按当前用户可见范围）
 * - 该用户的媒体分页列表
 */
export default function UserPage() {
    const { id } = useParams();
    const { t } = useTranslation();
    const navigate = useNavigate();
    const currentUser = useAuthStore((s) => s.user);
    const [page, setPage] = useState(1);

    const { data, isError } = useQuery({
        queryKey: ['public-user', id],
        queryFn: () => Api.getUser(id!),
        enabled: !!id
    });

    const { data: mediaList, isFetching } = useQuery({
        queryKey: ['public-user-media', id, page],
        queryFn: () =>
            Api.listMedia({
                uploaderId: id,
                page,
                limit: PAGE_SIZE,
                sortBy: 'createdAt',
                sortOrder: 'desc'
            }),
        enabled: !!id
    });

    const user = data?.user;
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
                <h2>{t('user.notFound')}</h2>
                <Link to="/" className="btn btn-primary">{t('nav.home')}</Link>
            </div>
        );
    }

    const isSelf = !!currentUser && currentUser.id === user?.id;
    const roleLabel =
        user?.role === 'admin'
            ? t('common.roleAdmin')
            : user?.role === 'user'
                ? t('common.roleUser')
                : t('common.roleGuest');

    return (
        <div className="user-page">
            <div className="card section-card">
                <div className="user-profile-header">
                    <div className="user-avatar">{user?.username?.charAt(0).toUpperCase() || '?'}</div>
                    <div className="user-profile-info">
                        <h1 className="user-username">
                            {user?.username ?? '…'}
                            {user?.isSystemUser && (
                                <span className="badge badge-info text-xs" style={{ marginLeft: 8 }}>
                                    {t('common.systemUser')}
                                </span>
                            )}
                        </h1>
                        <div className="user-meta">
                            <span className="badge badge-role">{roleLabel}</span>
                            {user?.createdAt && (
                                <span className="text-muted text-sm">
                                    {t('common.memberSince')} {formatDate(user.createdAt, t)}
                                </span>
                            )}
                        </div>
                    </div>
                    {isSelf && (
                        <Link to="/profile" className="btn btn-secondary">
                            {t('profile.title')}
                        </Link>
                    )}
                </div>
            </div>

            {stats && (
                <div className="card section-card">
                    <div className="card-header">
                        <h2>{t('user.mediaStats')}</h2>
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
                    <h2>{t('user.media')}</h2>
                </div>
                {isFetching && items.length === 0 ? (
                    <LoadingState />
                ) : items.length === 0 ? (
                    <p className="text-muted">{t('common.noMyMedia')}</p>
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
