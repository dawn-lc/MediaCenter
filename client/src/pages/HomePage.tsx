import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Api } from '../api';
import { useAuthStore } from '../stores/auth';
import { queryClient } from '../queryClient';
import { formatFileSize } from '../utils';
import TagList from '../components/list/TagList';
import MediaCard from '../components/list/MediaCard';
import LoadingState from '../components/feedback/LoadingState';

/**
 * 首页概览（真正的 Home 页）
 * - 媒体统计卡片（总数/类型/总大小/标签/作者/用户）
 * - 最近上传（可见范围内，点击进入播放）
 * - 快捷入口（媒体库 / 上传 / 管理）
 * 数据来自 GET /api/media/stats（按当前用户可见范围过滤）
 */
export default function HomePage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const token = useAuthStore((s) => s.token);
    const isAdmin = useAuthStore((s) => s.isAdmin);

    const { data, isFetching } = useQuery({
        queryKey: ['stats', !!token],
        queryFn: () => Api.getStats()
    });

    // SSE 媒体变更 → 刷新统计（防抖合并突发推送）
    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        const onMediaUpdated = () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                timer = null;
                void queryClient.invalidateQueries({ queryKey: ['stats'] });
            }, 400);
        };
        window.addEventListener('mediacenter:media-updated', onMediaUpdated);
        return () => {
            window.removeEventListener('mediacenter:media-updated', onMediaUpdated);
            if (timer) clearTimeout(timer);
        };
    }, []);

    const stats = data?.media;
    const recent = data?.recent || [];

    return (
        <div className="dashboard">
            <div className="page-header">
                <div>
                    <h1>{t('dashboard.title')}</h1>
                    <p>{t('dashboard.subtitle')}</p>
                </div>
                <div className="flex-gap-8">
                    <Link to="/library" className="btn btn-primary">
                        {t('dashboard.browse')}
                    </Link>
                    {token && (
                        <Link to="/upload" className="btn btn-secondary">
                            {t('dashboard.upload')}
                        </Link>
                    )}
                    {isAdmin && (
                        <Link to="/admin" className="btn btn-secondary">
                            {t('dashboard.admin')}
                        </Link>
                    )}
                </div>
            </div>

            {!token && (
                <div className="card section-card dashboard-login-hint">{t('dashboard.loginHint')}</div>
            )}

            {isFetching && !data ? (
                <LoadingState />
            ) : (
                <>
                    {stats && (
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
                            {stats.totalSize != null && (
                                <div className="stat-card">
                                    <div className="stat-value stat-size">{formatFileSize(stats.totalSize)}</div>
                                    <div className="stat-label">{t('dashboard.totalSize')}</div>
                                </div>
                            )}
                            {data.tags != null && (
                                <div className="stat-card">
                                    <div className="stat-value">{data.tags}</div>
                                    <div className="stat-label">{t('dashboard.tags')}</div>
                                </div>
                            )}
                            {data.authors != null && (
                                <div className="stat-card">
                                    <div className="stat-value">{data.authors}</div>
                                    <div className="stat-label">{t('dashboard.authors')}</div>
                                </div>
                            )}
                            {data.users != null && (
                                <div className="stat-card">
                                    <div className="stat-value">{data.users}</div>
                                    <div className="stat-label">{t('dashboard.users')}</div>
                                </div>
                            )}
                        </div>
                    )}

                    <h2 className="dashboard-recent-title">{t('dashboard.recent')}</h2>
                    {recent.length === 0 ? (
                        <div className="card section-card">
                            <p className="muted">{t('dashboard.recentEmpty')}</p>
                        </div>
                    ) : (
                        <div className="grid grid-2">
                            {recent.map((item) => (
                                <MediaCard key={item.id} media={item}>
                                    <TagList
                                        tags={item.tags || []}
                                        onTagClick={(name) => navigate('/library?tags=' + encodeURIComponent(name))}
                                    />
                                </MediaCard>
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
