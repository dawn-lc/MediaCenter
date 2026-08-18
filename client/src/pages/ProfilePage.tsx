import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Api } from '../api';
import { useAuthStore } from '../stores/auth';
import { usePlayerSettings } from '../stores/playerSettings';
import { notify } from '../utils/notify';
import { changeLanguage, LANGUAGES } from '../i18n';
import { formatDate } from '../utils';
import MediaCard from '../components/list/MediaCard';
import Pagination from '../components/list/Pagination';
import LoadingState from '../components/feedback/LoadingState';
import ToggleSwitch from '../components/form/ToggleSwitch';

/** 个人中心"我的媒体"分页每页条数 */
const PROFILE_PAGE_SIZE = 12;

/**
 * 个人中心（/profile）
 * - 账号信息（用户名/角色/注册时间）
 * - 我的媒体（按类型统计 + 全部分页列表）
 * - 偏好设置（自动播放/默认音量/倍速/界面语言，本地持久化）
 * - 修改密码（验证旧密码 + 撤销旧会话）
 */
export default function ProfilePage() {
    const { t, i18n } = useTranslation();
    const navigate = useNavigate();
    const { user, isLoggedIn, logout } = useAuthStore();
    const playerSettings = usePlayerSettings();
    const [page, setPage] = useState(1);
    const [oldPassword, setOldPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');

    // 账号信息（含注册时间）
    const { data: profileData } = useQuery({
        queryKey: ['profile', user?.id],
        queryFn: () => Api.getProfile(),
        enabled: !!user?.id
    });

    // 我的媒体统计（按类型）
    const { data: myMediaStats } = useQuery({
        queryKey: ['my-media-stats', user?.id],
        queryFn: () =>
            Promise.all([
                Api.listMedia({ uploaderId: user?.id, type: 'video', limit: 1 }),
                Api.listMedia({ uploaderId: user?.id, type: 'audio', limit: 1 }),
                Api.listMedia({ uploaderId: user?.id, type: 'image', limit: 1 })
            ]).then(([v, a, i]) => ({
                video: v.pagination?.total ?? 0,
                audio: a.pagination?.total ?? 0,
                image: i.pagination?.total ?? 0,
                total: (v.pagination?.total ?? 0) + (a.pagination?.total ?? 0) + (i.pagination?.total ?? 0)
            })),
        enabled: !!user?.id
    });

    // 我的媒体分页列表（该用户全部媒体，按上传时间倒序）
    const { data: myMediaList, isFetching: mediaFetching } = useQuery({
        queryKey: ['my-media-list', user?.id, page],
        queryFn: () =>
            Api.listMedia({
                uploaderId: user?.id,
                page,
                limit: PROFILE_PAGE_SIZE,
                sortBy: 'createdAt',
                sortOrder: 'desc'
            }),
        enabled: !!user?.id
    });

    const mediaItems = myMediaList?.items || [];
    const mediaTotalPages = myMediaList?.pagination?.totalPages || 1;

    // 翻页时回到页面顶部（列表在页面内，非路由导航）
    const goPage = (p: number) => {
        setPage(p);
        window.scrollTo({ top: 0 });
    };

    if (!isLoggedIn || !user) {
        return (
            <div className="empty-state">
                <h2>{t('profile.loginRequired')}</h2>
                <Link to="/" className="btn btn-primary">{t('nav.home')}</Link>
            </div>
        );
    }

    const roleLabel =
        user.role === 'admin'
            ? t('common.roleAdmin')
            : user.role === 'user'
                ? t('common.roleUser')
                : t('common.roleGuest');

    const handleChangePassword = async (e: React.SyntheticEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (newPassword !== confirmPassword) {
            notify.error(t('profile.passwordMismatch'));
            return;
        }
        await notify.promise(Api.changePassword({ oldPassword, newPassword }), {
            loading: t('common.saving'),
            success: t('auth.passwordChanged'),
            onSuccess: () => {
                setOldPassword('');
                setNewPassword('');
                setConfirmPassword('');
            }
        });
    };

    return (
        <div className="profile">
            <div className="page-header">
                <div>
                    <h1>{t('profile.title')}</h1>
                    <p>{t('profile.subtitle')}</p>
                </div>
            </div>

            <div className="card section-card">
                <div className="card-header">
                    <h2>{t('profile.accountInfo')}</h2>
                </div>
                <div className="profile-fields">
                    <div className="profile-field">
                        <span className="profile-field-label">{t('common.username')}</span>
                        <span className="profile-field-value">{user.username}</span>
                    </div>
                    <div className="profile-field">
                        <span className="profile-field-label">{t('common.colRole')}</span>
                        <span className="profile-field-value">{roleLabel}</span>
                    </div>
                    <div className="profile-field">
                        <span className="profile-field-label">{t('common.memberSince')}</span>
                        <span className="profile-field-value">
                            {profileData?.user?.createdAt ? formatDate(profileData.user.createdAt, t) : '—'}
                        </span>
                    </div>
                    <div className="profile-field">
                        <span className="profile-field-label">{t('profile.myMediaCount')}</span>
                        <span className="profile-field-value">{myMediaStats?.total ?? '—'}</span>
                    </div>
                </div>
                <div className="flex-gap-8">
                    <Link to="/upload" className="btn btn-primary">
                        {t('nav.upload')}
                    </Link>
                    <button className="btn btn-secondary" onClick={logout}>
                        {t('common.logout')}
                    </button>
                </div>
            </div>

            <div className="card section-card">
                <div className="card-header">
                    <h2>{t('profile.changePassword')}</h2>
                </div>
                <form onSubmit={handleChangePassword} className="profile-password-form">
                    <div className="form-group">
                        <label>{t('profile.oldPassword')}</label>
                        <input
                            className="form-input"
                            type="password"
                            value={oldPassword}
                            onChange={(e) => setOldPassword(e.target.value)}
                            required
                        />
                    </div>
                    <div className="form-group">
                        <label>{t('profile.newPassword')}</label>
                        <input
                            className="form-input"
                            type="password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            required
                        />
                    </div>
                    <div className="form-group">
                        <label>{t('profile.confirmPassword')}</label>
                        <input
                            className="form-input"
                            type="password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            required
                        />
                    </div>
                    <button className="btn btn-primary" type="submit">
                        {t('profile.changePasswordBtn')}
                    </button>
                </form>
            </div>

            <div className="card section-card">
                <div className="card-header">
                    <h2>{t('profile.preferences')}</h2>
                </div>
                <div className="settings-list">
                    <div className="settings-row">
                        <label>{t('profile.autoPlayVideo')}</label>
                        <ToggleSwitch
                            checked={playerSettings.autoPlayVideo}
                            onChange={playerSettings.setAutoPlayVideo}
                            ariaLabel={t('profile.autoPlayVideo')}
                        />
                    </div>
                    <div className="settings-row">
                        <label>{t('profile.defaultVolume')}</label>
                        <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={playerSettings.volume}
                            onChange={(e) => playerSettings.setVolume(Number(e.target.value))}
                        />
                        <span className="settings-value">{Math.round(playerSettings.volume * 100)}%</span>
                    </div>
                    <div className="settings-row">
                        <label>{t('profile.playbackRate')}</label>
                        <select
                            className="form-input form-select"
                            style={{ width: 'auto' }}
                            value={playerSettings.playbackRate}
                            onChange={(e) => playerSettings.setPlaybackRate(Number(e.target.value))}
                        >
                            {[0.5, 1, 1.5, 2].map((r) => (
                                <option key={r} value={r}>{r}x</option>
                            ))}
                        </select>
                    </div>
                    <div className="settings-row">
                        <label>{t('profile.language')}</label>
                        <select
                            className="form-input form-select"
                            style={{ width: 'auto' }}
                            value={i18n.language}
                            onChange={(e) => changeLanguage(e.target.value)}
                        >
                            {LANGUAGES.map((lang) => (
                                <option key={lang.code} value={lang.code}>
                                    {lang.label}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>
            </div>

            <div className="card section-card">
                <div className="card-header">
                    <h2>{t('profile.myMedia')}</h2>
                </div>
                {myMediaStats && (
                    <div className="stat-grid">
                        <div className="stat-card">
                            <div className="stat-value">{myMediaStats.total}</div>
                            <div className="stat-label">{t('common.totalMedia')}</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-value">{myMediaStats.video}</div>
                            <div className="stat-label">{t('common.videos')}</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-value">{myMediaStats.audio}</div>
                            <div className="stat-label">{t('common.audios')}</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-value">{myMediaStats.image}</div>
                            <div className="stat-label">{t('common.images')}</div>
                        </div>
                    </div>
                )}

                {mediaFetching && mediaItems.length === 0 ? (
                    <LoadingState />
                ) : mediaItems.length === 0 ? (
                    <p className="text-muted">{t('common.noMyMedia')}</p>
                ) : (
                    <>
                        <div className={`grid grid-2${mediaFetching ? ' grid-loading' : ''}`}>
                            {mediaItems.map((item) => (
                                <MediaCard key={item.id} media={item} />
                            ))}
                        </div>
                        <Pagination page={page} totalPages={mediaTotalPages} onPageChange={goPage} />
                    </>
                )}
            </div>
        </div>
    );
}
