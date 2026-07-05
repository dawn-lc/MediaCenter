import { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Api } from '../api';
import type { Tag } from '../types';
import { toast } from 'sonner';
import AdminGuard from '../components/AdminGuard';
import LoadingState from '../components/LoadingState';
import Pagination from '../components/Pagination';
import { showConfirm } from '../components/ConfirmDialog';
import { useClickOutside } from '../hooks/useClickOutside';
import { ADMIN_PAGE_SIZE } from '../config';

/** 行内编辑中的行状态 */
interface EditingRow {
    id: string;
    altNames: string;
    saving: boolean;
}

export default function TagsPage() {
    const { t } = useTranslation();
    const [tags, setTags] = useState<Tag[]>([]);
    const [loading, setLoading] = useState(true);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [newTagName, setNewTagName] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [editing, setEditing] = useState<EditingRow | null>(null);
    const editRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef(searchQuery);
    searchRef.current = searchQuery;

    useClickOutside(editRef, () => {
        if (editing && !editing.saving) setEditing(null);
    });

    const loadTags = useCallback(async (pg: number, query: string) => {
        setLoading(true);
        try {
            const data = await Api.listTags({ page: pg, limit: ADMIN_PAGE_SIZE, search: query || undefined });
            setTags(data.tags || []);
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
        loadTags(page, searchRef.current);
    }, [page, loadTags]);

    // 搜索时重置到第一页
    const handleSearchChange = (val: string) => {
        setSearchQuery(val);
        setPage(1);
    };

    const handleCreate = async () => {
        const name = newTagName.trim();
        if (!name) return;
        try {
            await Api.createTag(name);
            toast.success(t('admin.tags.createSuccess'));
            setNewTagName('');
            // 创建后回到第一页查看新标签
            setPage(1);
            loadTags(1, searchRef.current);
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : t('common.createFailed'));
        }
    };

    const handleDelete = (tag: Tag) => {
        showConfirm({
            message: t('admin.tags.confirmDelete', { name: tag.name }),
            danger: true,
            onConfirm: async () => {
                try {
                    await Api.deleteTag(tag.id);
                    toast.success(t('admin.tagDeleted'));
                    // 如果当前页只剩被删的这个，回到上一页
                    const nextPage = tags.length <= 1 && page > 1 ? page - 1 : page;
                    setPage(nextPage);
                    loadTags(nextPage, searchRef.current);
                } catch (err: unknown) {
                    toast.error(err instanceof Error ? err.message : t('common.loadFailed'));
                }
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
        try {
            const parsed = editing.altNames
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean);
            await Api.updateTag(editing.id, { altNames: parsed });
            toast.success(t('admin.tags.updateSuccess'));
            setEditing(null);
            loadTags(page, searchRef.current);
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : t('common.loadFailed'));
            setEditing((prev) => prev ? { ...prev, saving: false } : null);
        }
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

                    {loading ? (
                        <LoadingState />
                    ) : tags.length === 0 ? (
                        <p className="text-muted">{t('admin.tags.noTags')}</p>
                    ) : (
                        <>

                            <div className="table-wrapper">
                                <table>
                                    <thead>
                                        <tr>
                                            <th className="col-name">{t('admin.tags.colName')}</th>
                                            <th>{t('admin.tags.colAltNames')}</th>
                                            <th className="col-count">{t('admin.tags.colMediaCount')}</th>
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
                                                                        {t('player.edit')}
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
