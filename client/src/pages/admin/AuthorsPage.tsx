import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Api } from '../../api';
import type { Author } from '../../types';
import { notify } from '../../utils/notify';
import { useQuery } from '@tanstack/react-query';
import AdminGuard from '../../components/auth/AdminGuard';
import SortableTh from '../../components/list/SortableTh';
import LoadingState from '../../components/feedback/LoadingState';
import Pagination from '../../components/list/Pagination';
import { showConfirm } from '../../components/feedback/ConfirmDialog';
import { useClickOutside } from '../../hooks/useClickOutside';
import { useAdminTableState } from '../../hooks/useAdminTableState';
import { isValidHttpUrl } from '../../utils';
import { ADMIN_PAGE_SIZE } from '../../config';

/** 行内编辑中的行状态 */
interface EditingRow {
    id: string;
    name: string;
    altNames: string;
    urls: string;
    saving: boolean;
}

export default function AuthorsPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [authors, setAuthors] = useState<Author[]>([]);
    const [total, setTotal] = useState(0);
    const [totalPages, setTotalPages] = useState(1);
    const [newAuthorName, setNewAuthorName] = useState('');
    // 分页/搜索/排序状态同步到 URL（?search=&sort=&page=），跳转后返回/刷新时恢复
    const { page, search: searchQuery, sortBy, sortOrder, setSearch, setSort, setPage } = useAdminTableState({
        defaultSortBy: 'name',
        defaultSortOrder: 'asc',
        newColumnDescKeys: ['mediaCount']
    });
    const [editing, setEditing] = useState<EditingRow | null>(null);
    const editRef = useRef<HTMLDivElement>(null);

    useClickOutside(editRef, () => {
        if (editing && !editing.saving) setEditing(null);
    });

    const { data, isFetching, refetch } = useQuery({
        queryKey: ['authors', page, searchQuery, sortBy, sortOrder],
        queryFn: () =>
            Api.listAuthors({
                page,
                limit: ADMIN_PAGE_SIZE,
                search: searchQuery || undefined,
                sortBy,
                sortOrder
            })
    });

    // 取数结果同步到页面状态
    useEffect(() => {
        if (!data) return;
        setAuthors(data.authors || []);
        if (data.pagination) {
            setTotal(data.pagination.total);
            setTotalPages(data.pagination.totalPages);
        }
    }, [data]);

    const handleSearchChange = (val: string) => {
        setSearch(val);
    };

    // 表头排序：同列切换方向，新列默认升序（媒体数列默认降序），自动重置到第一页
    const handleSort = (key: string) => {
        setSort(key);
    };

    const handleCreate = async () => {
        const name = newAuthorName.trim();
        if (!name) return;
        await notify.promise(Api.createAuthor(name), {
            loading: t('common.creating'),
            success: t('admin.authors.createSuccess'),
            onSuccess: () => {
                setNewAuthorName('');
                // 翻页会触发自动重取；已在第 1 页时手动刷新
                if (page !== 1) setPage(1);
                else void refetch();
            }
        });
    };

    const handleDelete = (author: Author) => {
        showConfirm({
            message: t('admin.authors.confirmDelete', { name: author.name }),
            danger: true,
            onConfirm: async () => {
                await notify.promise(Api.deleteAuthor(author.id), {
                    loading: t('common.deleting'),
                    success: t('admin.authorDeleted'),
                    onSuccess: () => {
                        const nextPage = authors.length <= 1 && page > 1 ? page - 1 : page;
                        if (nextPage !== page) setPage(nextPage);
                        else void refetch();
                    }
                });
            }
        });
    };

    const startEditing = (author: Author) => {
        setEditing({
            id: author.id,
            name: author.name,
            altNames: (author.altNames || []).join('\n'),
            urls: (author.urls || []).join('\n'),
            saving: false
        });
    };

    const saveEditing = async () => {
        if (!editing || editing.saving) return;
        setEditing((prev) => (prev ? { ...prev, saving: true } : null));
        const name = editing.name.trim();
        const altParsed = editing.altNames
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean);
        const urlParsed = editing.urls
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean);

        const data: { name?: string; altNames?: string[]; urls?: string[] } = {};
        if (name) data.name = name;
        data.altNames = altParsed;
        data.urls = urlParsed;

        const ok = await notify.promise(Api.updateAuthor(editing.id, data), {
            loading: t('common.saving'),
            success: t('admin.authors.updateSuccess')
        });
        setEditing(ok ? null : (prev) => (prev ? { ...prev, saving: false } : null));
        if (ok) void refetch();
    };

    const cancelEditing = () => {
        setEditing(null);
    };

    return (
        <AdminGuard>
            <div>
                <div className="page-header">
                    <h1>{t('admin.authors.title')}</h1>
                </div>

                <div className="card section-card">
                    {/* 创建作者 */}
                    <div className="admin-inline-form mb-16">
                        <input
                            className="form-input flex-1"
                            value={newAuthorName}
                            onChange={(e) => setNewAuthorName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                            placeholder={t('admin.authors.placeholder')}
                        />
                        <button className="btn btn-primary" onClick={handleCreate} disabled={!newAuthorName.trim()}>
                            {t('admin.authors.createBtn')}
                        </button>
                    </div>

                    {/* 搜索过滤 */}
                    <div className="admin-inline-form mb-16">
                        <input
                            className="form-input flex-1"
                            value={searchQuery}
                            onChange={(e) => handleSearchChange(e.target.value)}
                            placeholder={t('admin.authors.searchPlaceholder')}
                        />
                        {searchQuery && (
                            <button className="btn btn-secondary" onClick={() => handleSearchChange('')}>
                                {t('common.clear')}
                            </button>
                        )}
                    </div>

                    {isFetching ? (
                        <LoadingState />
                    ) : authors.length === 0 ? (
                        <p className="text-muted">{t('admin.authors.noAuthors')}</p>
                    ) : (
                        <>
                            <div className="table-wrapper">
                                <table>
                                    <thead>
                                        <tr>
                                            <SortableTh label={t('admin.authors.colName')} sortKey="name" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="col-author-name" />
                                            <th className="col-altnames">{t('admin.authors.colAltNames')}</th>
                                            <th>{t('admin.authors.colUrls')}</th>
                                            <SortableTh label={t('admin.authors.colMediaCount')} sortKey="mediaCount" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="col-count" />
                                            <th className="col-actions">{t('admin.authors.colActions')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {authors.map((author) => {
                                            const isEditing = editing?.id === author.id;
                                            return (
                                                <tr key={author.id} className={isEditing ? 'row-editing' : ''}>
                                                    <td>
                                                        {isEditing ? (
                                                            <input
                                                                className="form-input"
                                                                value={editing?.name ?? ''}
                                                                onChange={(e) =>
                                                                    setEditing((prev) =>
                                                                        prev ? { ...prev, name: e.target.value } : null
                                                                    )
                                                                }
                                                                autoFocus
                                                            />
                                                        ) : (
                                                            <span
                                                                className="table-name-link"
                                                                onClick={() => navigate('/author/' + encodeURIComponent(author.id))}
                                                                title={t('admin.authors.colName')}
                                                            >
                                                                {author.name}
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td>
                                                        {isEditing ? (
                                                            <textarea
                                                                className="form-input form-textarea"
                                                                rows={3}
                                                                value={editing?.altNames ?? ''}
                                                                onChange={(e) =>
                                                                    setEditing((prev) =>
                                                                        prev ? { ...prev, altNames: e.target.value } : null
                                                                    )
                                                                }
                                                                placeholder={t('admin.authors.altNamesPlaceholder')}
                                                            />
                                                        ) : (
                                                            <span className="text-cell">
                                                                {author.altNames && author.altNames.length > 0
                                                                    ? author.altNames.join(', ')
                                                                    : <span className="text-muted">—</span>}
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td>
                                                        {isEditing ? (
                                                            <div ref={editRef}>
                                                                <textarea
                                                                    className="form-input form-textarea"
                                                                    rows={3}
                                                                    value={editing?.urls ?? ''}
                                                                    onChange={(e) =>
                                                                        setEditing((prev) =>
                                                                            prev ? { ...prev, urls: e.target.value } : null
                                                                        )
                                                                    }
                                                                    placeholder={t('admin.authors.urlsPlaceholder')}
                                                                />
                                                            </div>
                                                        ) : (
                                                            <span className="url-cell">
                                                                {author.urls && author.urls.length > 0
                                                                    ? author.urls.map((u, i) => (
                                                                        <span key={i}>
                                                                            {i > 0 && ' '}
                                                                            {isValidHttpUrl(u) ? (
                                                                                <a
                                                                                    href={u}
                                                                                    target="_blank"
                                                                                    rel="noopener noreferrer"
                                                                                    className="url-link"
                                                                                >
                                                                                    {u.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                                                                                </a>
                                                                            ) : (
                                                                                <span className="text-muted">{u}</span>
                                                                            )}
                                                                        </span>
                                                                    ))
                                                                    : <span className="text-muted">—</span>}
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="col-count">{author.mediaCount ?? 0}</td>
                                                    <td>
                                                        <div className="action-buttons flex-end">
                                                            {isEditing ? (
                                                                <>
                                                                    <button
                                                                        className="btn btn-primary btn-sm"
                                                                        onClick={saveEditing}
                                                                        disabled={editing?.saving}
                                                                    >
                                                                        {editing?.saving ? '...' : t('common.save')}
                                                                    </button>
                                                                    <button
                                                                        className="btn btn-secondary btn-sm"
                                                                        onClick={cancelEditing}
                                                                        disabled={editing?.saving}
                                                                    >
                                                                        {t('common.cancel')}
                                                                    </button>
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <button
                                                                        className="btn btn-sm btn-secondary"
                                                                        onClick={() => startEditing(author)}
                                                                        title={t('admin.authors.editTitle')}
                                                                    >
                                                                        {t('common.edit')}
                                                                    </button>
                                                                    <button
                                                                        className="btn btn-sm btn-danger"
                                                                        onClick={() => handleDelete(author)}
                                                                    >
                                                                        {t('common.delete')}
                                                                    </button>
                                                                </>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
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
