import { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Api } from '../api';
import type { Author } from '../types';
import { toast } from 'sonner';
import AdminGuard from '../components/AdminGuard';
import LoadingState from '../components/LoadingState';
import Pagination from '../components/Pagination';
import { showConfirm } from '../components/ConfirmDialog';
import { useClickOutside } from '../hooks/useClickOutside';
import { isValidHttpUrl } from '../utils';
import { ADMIN_PAGE_SIZE } from '../config';

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
    const [authors, setAuthors] = useState<Author[]>([]);
    const [loading, setLoading] = useState(true);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [newAuthorName, setNewAuthorName] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [editing, setEditing] = useState<EditingRow | null>(null);
    const editRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef(searchQuery);
    searchRef.current = searchQuery;

    useClickOutside(editRef, () => {
        if (editing && !editing.saving) setEditing(null);
    });

    const loadAuthors = useCallback(async (pg: number, query: string) => {
        setLoading(true);
        try {
            const data = await Api.listAuthors({ page: pg, limit: ADMIN_PAGE_SIZE, search: query || undefined });
            setAuthors(data.authors || []);
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
        loadAuthors(page, searchRef.current);
    }, [page, loadAuthors]);

    const handleSearchChange = (val: string) => {
        setSearchQuery(val);
        setPage(1);
    };

    const handleCreate = async () => {
        const name = newAuthorName.trim();
        if (!name) return;
        try {
            await Api.createAuthor(name);
            toast.success(t('admin.authors.createSuccess'));
            setNewAuthorName('');
            setPage(1);
            loadAuthors(1, searchRef.current);
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : t('common.createFailed'));
        }
    };

    const handleDelete = (author: Author) => {
        showConfirm({
            message: t('admin.authors.confirmDelete', { name: author.name }),
            danger: true,
            onConfirm: async () => {
                try {
                    await Api.deleteAuthor(author.id);
                    toast.success(t('admin.authorDeleted'));
                    const nextPage = authors.length <= 1 && page > 1 ? page - 1 : page;
                    setPage(nextPage);
                    loadAuthors(nextPage, searchRef.current);
                } catch (err: unknown) {
                    toast.error(err instanceof Error ? err.message : t('common.loadFailed'));
                }
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
        try {
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

            await Api.updateAuthor(editing.id, data);
            toast.success(t('admin.authors.updateSuccess'));
            setEditing(null);
            loadAuthors(page, searchRef.current);
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : t('common.loadFailed'));
            setEditing((prev) => (prev ? { ...prev, saving: false } : null));
        }
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

                    {loading ? (
                        <LoadingState />
                    ) : authors.length === 0 ? (
                        <p className="text-muted">{t('admin.authors.noAuthors')}</p>
                    ) : (
                        <>
                            <div className="table-wrapper">
                                <table>
                                    <thead>
                                        <tr>
                                            <th className="col-author-name">{t('admin.authors.colName')}</th>
                                            <th className="col-altnames">{t('admin.authors.colAltNames')}</th>
                                            <th>{t('admin.authors.colUrls')}</th>
                                            <th className="col-count">{t('admin.authors.colMediaCount')}</th>
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
                                                            <span className="tag-badge">{author.name}</span>
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
                                                                        {t('player.edit')}
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
