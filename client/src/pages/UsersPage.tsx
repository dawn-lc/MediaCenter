import { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Api } from '../api';
import type { User } from '../types';
import { useAuthStore } from '../stores/auth';
import { toast } from 'sonner';
import AdminGuard from '../components/AdminGuard';
import LoadingState from '../components/LoadingState';
import Pagination from '../components/Pagination';
import { showConfirm } from '../components/ConfirmDialog';

export default function UsersPage() {
    const { t } = useTranslation();
    const currentUser = useAuthStore((s) => s.user);
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [searchQuery, setSearchQuery] = useState('');
    const searchRef = useRef(searchQuery);
    searchRef.current = searchQuery;

    const loadUsers = useCallback(async (pg: number, query: string) => {
        setLoading(true);
        try {
            const data = await Api.listUsers({ page: pg, limit: 20, search: query || undefined });
            setUsers(data.users || []);
            if (data.pagination) {
                setTotal(data.pagination.total);
                setTotalPages(data.pagination.totalPages);
            }
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : t('common.loadFailed'));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadUsers(page, searchRef.current);
    }, [page, loadUsers]);

    const handleSearchChange = (val: string) => {
        setSearchQuery(val);
        setPage(1);
    };

    const changeRole = async (userId: string, role: string) => {
        try {
            await Api.updateUserRole(userId, role);
            toast.success(t('admin.users.roleUpdated'));
            setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role: role as User['role'] } : u)));
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : t('common.loadFailed'));
        }
    };

    const handleDelete = (userId: string, username: string) => {
        showConfirm({
            message: t('admin.users.deleteConfirm', { name: username }),
            danger: true,
            onConfirm: async () => {
                try {
                    await Api.deleteUser(userId);
                    toast.success(t('admin.users.userDeleted'));
                    const nextPage = users.length <= 1 && page > 1 ? page - 1 : page;
                    setPage(nextPage);
                    loadUsers(nextPage, searchRef.current);
                } catch (err: unknown) {
                    toast.error(err instanceof Error ? err.message : t('common.loadFailed'));
                }
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
                try {
                    const data = await Api.toggleBan(userId);
                    toast.success(data.message);
                    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, banned: data.banned ? 1 : 0 } : u)));
                } catch (err: unknown) {
                    toast.error(err instanceof Error ? err.message : t('common.loadFailed'));
                }
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
                    {/* 搜索过滤 */}
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
                    </div>

                    {loading ? (
                        <LoadingState />
                    ) : users.length === 0 ? (
                        <p className="text-muted">{t('admin.users.noUsers')}</p>
                    ) : (
                        <>
                            <div className="table-wrapper">
                                <table>
                                    <thead>
                                        <tr>
                                            <th>{t('admin.users.colUsername')}</th>
                                            <th className="col-role">{t('admin.users.colRole')}</th>
                                            <th className="col-status">{t('admin.users.colStatus')}</th>
                                            <th className="col-actions">{t('admin.users.colActions')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {users.map((u) => (
                                            <tr key={u.id}>
                                                <td>
                                                    <span className="tag-badge">{u.username}</span>
                                                    {currentUser?.id === u.id && (
                                                        <span className="text-muted text-xs" style={{ marginLeft: 6 }}>{t('admin.users.currentUser')}</span>
                                                    )}
                                                </td>
                                                <td>
                                                    <select
                                                        className="form-input form-select col-role-select"
                                                        value={u.role}
                                                        onChange={(e) => changeRole(u.id, e.target.value)}
                                                        disabled={currentUser?.id === u.id}
                                                    >
                                                        <option value="guest">{t('admin.users.roleGuest')}</option>
                                                        <option value="user">{t('admin.users.roleUser')}</option>
                                                        <option value="admin">{t('admin.users.roleAdmin')}</option>
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
                                                            className={`btn btn-sm ${u.banned ? 'btn-primary' : 'badge-warning'}`}
                                                            onClick={() => handleToggleBan(u.id, u.username, u.banned)}
                                                            disabled={currentUser?.id === u.id}
                                                        >
                                                            {u.banned ? t('admin.users.unban') : t('admin.users.ban')}
                                                        </button>
                                                        <button
                                                            className="btn btn-sm btn-danger"
                                                            onClick={() => handleDelete(u.id, u.username)}
                                                            disabled={currentUser?.id === u.id}
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
            </div>
        </AdminGuard>
    );
}
