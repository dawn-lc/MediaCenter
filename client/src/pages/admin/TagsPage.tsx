import { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Api } from '../../api';
import type { Tag } from '../../types';
import { notify } from '../../utils/notify';
import { useQuery } from '@tanstack/react-query';
import AdminGuard from '../../components/auth/AdminGuard';
import SortableTh from '../../components/list/SortableTh';
import LoadingState from '../../components/feedback/LoadingState';
import Pagination from '../../components/list/Pagination';
import { showConfirm } from '../../components/feedback/ConfirmDialog';
import { useClickOutside } from '../../hooks/useClickOutside';
import { useAdminTableState } from '../../hooks/useAdminTableState';
import { ADMIN_PAGE_SIZE } from '../../config';

/** 行内编辑中的行状态 */
interface EditingRow {
    id: string;
    altNames: string;
    saving: boolean;
}

export default function TagsPage() {
    const { t } = useTranslation();
    const [tags, setTags] = useState<Tag[]>([]);
    const [total, setTotal] = useState(0);
    const [totalPages, setTotalPages] = useState(1);
    const [newTagName, setNewTagName] = useState('');
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
        queryKey: ['tags', page, searchQuery, sortBy, sortOrder],
        queryFn: () =>
            Api.listTags({
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
        setTags(data.tags || []);
        if (data.pagination) {
            setTotal(data.pagination.total);
            setTotalPages(data.pagination.totalPages);
        }
    }, [data]);

    // 搜索时重置到第一页
    const handleSearchChange = (val: string) => {
        setSearch(val);
    };

    // 表头排序：同列切换方向，新列默认升序（媒体数列默认降序），自动重置到第一页
    const handleSort = (key: string) => {
        setSort(key);
    };

    const handleCreate = async () => {
        const name = newTagName.trim();
        if (!name) return;
        await notify.promise(Api.createTag(name), {
            loading: t('common.creating'),
            success: t('admin.tags.createSuccess'),
            onSuccess: () => {
                setNewTagName('');
                // 创建后回到第一页查看新标签；已在第 1 页时手动刷新
                if (page !== 1) setPage(1);
                else void refetch();
            }
        });
    };

    const handleDelete = (tag: Tag) => {
        showConfirm({
            message: t('admin.tags.confirmDelete', { name: tag.name }),
            danger: true,
            onConfirm: async () => {
                await notify.promise(Api.deleteTag(tag.id), {
                    loading: t('common.deleting'),
                    success: t('admin.tagDeleted'),
                    onSuccess: () => {
                        // 如果当前页只剩被删的这个，回到上一页
                        const nextPage = tags.length <= 1 && page > 1 ? page - 1 : page;
                        if (nextPage !== page) setPage(nextPage);
                        else void refetch();
                    }
                });
            }
        });
    };

    const startEditing = (tag: Tag) => {
        setEditing({
            id: tag.id,
            altNames: (tag.altNames || []).join('\n'),
            saving: false
        });
    };

    const saveEditing = async () => {
        if (!editing || editing.saving) return;
        setEditing((prev) => prev ? { ...prev, saving: true } : null);
        const parsed = editing.altNames
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean);
        const ok = await notify.promise(Api.updateTag(editing.id, { altNames: parsed }), {
            loading: t('common.saving'),
            success: t('admin.tags.updateSuccess')
        });
        setEditing(ok ? null : (prev) => prev ? { ...prev, saving: false } : null);
        if (ok) void refetch();
    };

    const cancelEditing = () => {
        setEditing(null);
    };

    return (
        <AdminGuard>
            <div>
                <div className="page-header">
                    <h1>{t('admin.tags.title')}</h1>
                </div>

                <div className="card section-card">
                    {/* 创建标签 */}
                    <div className="admin-inline-form mb-16">
                        <input
                            className="form-input flex-1"
                            value={newTagName}
                            onChange={(e) => setNewTagName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                            placeholder={t('admin.tags.placeholder')}
                        />
                        <button className="btn btn-primary" onClick={handleCreate} disabled={!newTagName.trim()}>
                            {t('admin.tags.createBtn')}
                        </button>
                    </div>

                    {/* 搜索过滤 */}
                    <div className="admin-inline-form mb-16">
                        <input
                            className="form-input flex-1"
                            value={searchQuery}
                            onChange={(e) => handleSearchChange(e.target.value)}
                            placeholder={t('admin.tags.searchPlaceholder')}
                        />
                        {searchQuery && (
                            <button className="btn btn-secondary" onClick={() => handleSearchChange('')}>
                                {t('common.clear')}
                            </button>
                        )}
                    </div>

                    {isFetching ? (
                        <LoadingState />
                    ) : tags.length === 0 ? (
                        <p className="text-muted">{t('admin.tags.noTags')}</p>
                    ) : (
                        <>

                            <div className="table-wrapper">
                                <table>
                                    <thead>
                                        <tr>
                                            <SortableTh label={t('admin.tags.colName')} sortKey="name" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="col-name" />
                                            <th>{t('admin.tags.colAltNames')}</th>
                                            <SortableTh label={t('admin.tags.colMediaCount')} sortKey="mediaCount" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="col-count" />
                                            <th className="col-actions">{t('admin.tags.colActions')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {tags.map((tag) => {
                                            const isEditing = editing?.id === tag.id;
                                            return (
                                                <tr key={tag.id} className={isEditing ? 'row-editing' : ''}>
                                                    <td>
                                                        <span className="tag-badge">{tag.name}</span>
                                                    </td>
                                                    <td>
                                                        {isEditing ? (
                                                            <div ref={editRef}>
                                                                <textarea
                                                                    className="form-input form-textarea"
                                                                    rows={3}
                                                                    value={editing?.altNames ?? ''}
                                                                    onChange={(e) =>
                                                                        setEditing((prev) =>
                                                                            prev ? { ...prev, altNames: e.target.value } : null
                                                                        )
                                                                    }
                                                                    placeholder={t('admin.tags.altNamesPlaceholder')}
                                                                    autoFocus
                                                                />
                                                            </div>
                                                        ) : (
                                                            <span className="text-cell">
                                                                {tag.altNames && tag.altNames.length > 0
                                                                    ? tag.altNames.join(', ')
                                                                    : <span className="text-muted">—</span>}
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="col-count">{tag.mediaCount ?? 0}</td>
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
                                                                        onClick={() => startEditing(tag)}
                                                                        title={t('admin.tags.editTitle')}
                                                                    >
                                                                        {t('common.edit')}
                                                                    </button>
                                                                    <button
                                                                        className="btn btn-sm btn-danger"
                                                                        onClick={() => handleDelete(tag)}
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
