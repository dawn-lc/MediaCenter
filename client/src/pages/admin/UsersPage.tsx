import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Api } from '../../api';
import type { User } from '../../types';
import { useAuthStore } from '../../stores/auth';
import { notify } from '../../utils/notify';
import { useQuery } from '@tanstack/react-query';
import AdminGuard from '../../components/auth/AdminGuard';
import SortableTh from '../../components/list/SortableTh';
import Modal from '../../components/feedback/Modal';
import LoadingState from '../../components/feedback/LoadingState';
import Pagination from '../../components/list/Pagination';
import { showConfirm } from '../../components/feedback/ConfirmDialog';
import { useAdminTableState } from '../../hooks/useAdminTableState';

export default function UsersPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const currentUser = useAuthStore((s) => s.user);
    const [users, setUsers] = useState<User[]>([]);
    const [total, setTotal] = useState(0);
    const [totalPages, setTotalPages] = useState(1);
    // 分页/搜索/排序状态同步到 URL（?search=&sort=&page=），跳转后返回/刷新时恢复
    const { page, search: searchQuery, sortBy, sortOrder, setSearch, setSort, setPage } = useAdminTableState({
        defaultSortBy: 'createdAt',
        defaultSortOrder: 'desc',
        newColumnDescKeys: []
    });
    // 创建用户弹窗
    const [showCreate, setShowCreate] = useState(false);
    const [newUsername, setNewUsername] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [newRole, setNewRole] = useState('user');

    const { data, isFetching, refetch } = useQuery({
        queryKey: ['users', page, searchQuery, sortBy, sortOrder],
        queryFn: () =>
            Api.listUsers({
                page,
                limit: 20,
                search: searchQuery || undefined,
                sortBy,
                sortOrder
            })
    });

    // 取数结果同步到页面状态
    useEffect(() => {
        if (!data) return;
        setUsers(data.users || []);
        if (data.pagination) {
            setTotal(data.pagination.total);
            setTotalPages(data.pagination.totalPages);
        }
    }, [data]);

    const handleSearchChange = (val: string) => {
        setSearch(val);
    };

    // 表头排序：同列切换方向，新列默认升序，自动重置到第一页
    const handleSort = (key: string) => {
        setSort(key);
    };

    const changeRole = async (userId: string, role: string) => {
        await notify.promise(Api.updateUserRole(userId, role), {
            loading: t('common.saving'),
            success: t('admin.users.roleUpdated'),
            onSuccess: () => setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role: role as User['role'] } : u)))
        });
    };

    const handleDelete = (userId: string, username: string) => {
        showConfirm({
            message: t('admin.users.deleteConfirm', { name: username }),
            danger: true,
            onConfirm: async () => {
                await notify.promise(Api.deleteUser(userId), {
                    loading: t('common.deleting'),
                    success: t('admin.users.userDeleted'),
                    onSuccess: () => {
                        const nextPage = users.length <= 1 && page > 1 ? page - 1 : page;
                        if (nextPage !== page) setPage(nextPage);
                        else void refetch();
                    }
                });
            }
        });
    };

    const handleToggleBan = (userId: string, username: string, currentlyBanned: number | undefined) => {
        const action = currentlyBanned ? t('admin.users.unban') : t('admin.users.ban');
        showConfirm({
            message: t('admin.users.confirmAction', { action, name: username }),
            danger: !currentlyBanned,
            confirmText: currentlyBanned ? t('admin.users.unban') : t('admin.users.ban'),
            onConfirm: async () => {
                await notify.promise(Api.toggleBan(userId), {
                    loading: t('common.saving'),
                    success: (data) => data.message,
                    onSuccess: (data) => setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, banned: data.banned ? 1 : 0 } : u)))
                });
            }
        });
    };

    // 创建用户：校验由后端执行（密码策略等），成功刷新列表
    const handleCreateUser = async (e: React.SyntheticEvent<HTMLFormElement>) => {
        e.preventDefault();
        const username = newUsername.trim();
        const password = newPassword;
        if (!username || !password) return;
        const ok = await notify.promise(Api.createUser({ username, password, role: newRole }), {
            loading: t('common.creating'),
            success: t('admin.users.userCreated'),
            onSuccess: () => {
                setShowCreate(false);
                setNewUsername('');
                setNewPassword('');
                setNewRole('user');
                if (page !== 1) setPage(1);
                else void refetch();
            }
        });
    };

    return (
        <AdminGuard>
            <div>
                <div className="page-header">
                    <h1>{t('admin.users.title')}</h1>
                </div>

                <div className="card section-card">
                    {/* 搜索过滤 + 创建用户 */}
                    <div className="admin-inline-form mb-16">
                        <input
                            className="form-input flex-1"
                            value={searchQuery}
                            onChange={(e) => handleSearchChange(e.target.value)}
                            placeholder={t('admin.users.searchPlaceholder')}
                        />
                        {searchQuery && (
                            <button className="btn btn-secondary" onClick={() => handleSearchChange('')}>
                                {t('common.clear')}
                            </button>
                        )}
                        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
                            {t('admin.users.createUser')}
                        </button>
                    </div>

                    {isFetching ? (
                        <LoadingState />
                    ) : users.length === 0 ? (
                        <p className="text-muted">{t('admin.users.noUsers')}</p>
                    ) : (
                        <>
                            <div className="table-wrapper">
                                <table>
                                    <thead>
                                        <tr>
                                            <SortableTh label={t('admin.users.colUsername')} sortKey="username" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                                            <SortableTh label={t('common.colRole')} sortKey="role" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="col-role" />
                                            <th className="col-status">{t('admin.users.colStatus')}</th>
                                            <th className="col-actions">{t('admin.users.colActions')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {users.map((u) => (
                                            <tr key={u.id}>
                                                <td>
                                                    <span
                                                        className="table-name-link"
                                                        onClick={() => navigate('/user/' + encodeURIComponent(u.id))}
                                                    >
                                                        {u.username}
                                                    </span>
                                                    {currentUser?.id === u.id && (
                                                        <span className="text-muted text-xs" style={{ marginLeft: 6 }}>{t('admin.users.currentUser')}</span>
                                                    )}
                                                    {u.isSystemUser && (
                                                        <span className="badge badge-info text-xs" style={{ marginLeft: 6 }}>{t('common.systemUser')}</span>
                                                    )}
                                                </td>
                                                <td>
                                                    <select
                                                        className="form-input form-select col-role-select"
                                                        value={u.role}
                                                        onChange={(e) => changeRole(u.id, e.target.value)}
                                                        disabled={currentUser?.id === u.id || u.isSystemUser}
                                                    >
                                                        <option value="guest">{t('common.roleGuest')}</option>
                                                        <option value="user">{t('common.roleUser')}</option>
                                                        <option value="admin">{t('common.roleAdmin')}</option>
                                                    </select>
                                                </td>
                                                <td>
                                                    {u.banned ? (
                                                        <span className="badge badge-danger">{t('admin.users.userBanned')}</span>
                                                    ) : (
                                                        <span className="badge badge-success">{t('admin.users.statusNormal')}</span>
                                                    )}
                                                </td>
                                                <td>
                                                    <div className="action-buttons" style={{ justifyContent: 'flex-end' }}>
                                                        <button
                                                            className={`btn btn-sm ${u.banned ? 'btn-primary' : 'btn-warning'}`}
                                                            onClick={() => handleToggleBan(u.id, u.username, u.banned)}
                                                            disabled={currentUser?.id === u.id || u.isSystemUser}
                                                        >
                                                            {u.banned ? t('admin.users.unban') : t('admin.users.ban')}
                                                        </button>
                                                        <button
                                                            className="btn btn-sm btn-danger"
                                                            onClick={() => handleDelete(u.id, u.username)}
                                                            disabled={currentUser?.id === u.id || u.isSystemUser}
                                                        >
                                                            {t('common.delete')}
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
                        </>
                    )}
                </div>

                <Modal
                    open={showCreate}
                    title={t('admin.users.createUserTitle')}
                    onClose={() => setShowCreate(false)}
                    footer={
                        <div className="auth-footer">
                            <button className="btn btn-primary" type="submit" form="create-user-form">
                                {t('admin.users.createBtn')}
                            </button>
                            <button className="btn btn-secondary" type="button" onClick={() => setShowCreate(false)}>
                                {t('common.cancel')}
                            </button>
                        </div>
                    }
                >
                    <form id="create-user-form" onSubmit={handleCreateUser}>
                        <div className="form-group">
                            <label>{t('admin.users.usernamePlaceholder')}</label>
                            <input
                                className="form-input"
                                value={newUsername}
                                onChange={(e) => setNewUsername(e.target.value)}
                                placeholder={t('admin.users.usernamePlaceholder')}
                                autoFocus
                                required
                            />
                        </div>
                        <div className="form-group">
                            <label>{t('admin.users.passwordPlaceholder')}</label>
                            <input
                                className="form-input"
                                type="password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                placeholder={t('admin.users.passwordPlaceholder')}
                                required
                            />
                        </div>
                        <div className="form-group">
                            <label>{t('common.colRole')}</label>
                            <select
                                className="form-input form-select"
                                value={newRole}
                                onChange={(e) => setNewRole(e.target.value)}
                            >
                                <option value="guest">{t('common.roleGuest')}</option>
                                <option value="user">{t('common.roleUser')}</option>
                                <option value="admin">{t('common.roleAdmin')}</option>
                            </select>
                        </div>
                    </form>
                </Modal>
            </div>
        </AdminGuard>
    );
}
