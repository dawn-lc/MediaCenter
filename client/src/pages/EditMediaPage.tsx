import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Api, ApiError } from '../api';
import type { Media } from '../types';
import { useAuthStore } from '../stores/auth';
import { toast } from 'sonner';
import TagSelector from '../components/TagSelector';
import AuthorSelector from '../components/AuthorSelector';
import LoadingState from '../components/LoadingState';
import EmptyState from '../components/EmptyState';
import { showConfirm } from '../components/ConfirmDialog';
import { TOAST_DURATION } from '../config';

export default function EditMediaPage() {
    const { t } = useTranslation();
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const auth = useAuthStore();

    const [media, setMedia] = useState<Media | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [tags, setTags] = useState<string[]>([]);
    const [author, setAuthor] = useState('');
    const [source, setSource] = useState('');
    const [minRole, setMinRole] = useState('guest');

    useEffect(() => {
        if (!id) return;
        setLoading(true);
        Api.getMedia(id)
            .then((data) => {
                setMedia(data.media);
                setTitle(data.media.title);
                setDescription(data.media.description || '');
                setTags(data.media.tags?.map((t) => t.name) || []);
                setAuthor(data.media.author?.name || '');
                setSource(data.media.source || '');
                setMinRole(data.media.minRole || 'guest');
            })
            .catch((err: Error) => {
                if (err instanceof ApiError && err.status === 403) {
                    toast.error(t('player.permissionDenied'));
                    navigate('/');
                } else {
                    setError(err.message);
                }
            })
            .finally(() => setLoading(false));
    }, [id]);

    const canManage = auth.isAdmin || (auth.isLoggedIn && media?.uploaderId === auth.user?.id);

    const [deleting, setDeleting] = useState(false);

    const handleSave = async () => {
        if (!id || !title) return;
        setSaving(true);
        setError('');
        try {
            await Api.updateMedia(id, {
                title,
                description,
                minRole,
                tags,
                author: author || undefined,
                source: source || undefined
            });
            toast.success(t('player.updateSuccess'));
            navigate('/player/' + id);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : t('player.updateFailed');
            setError(msg);
            toast.error(msg, { duration: TOAST_DURATION });
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = () => {
        if (!id) return;
        showConfirm({
            message: t('player.confirmDelete'),
            danger: true,
            onConfirm: async () => {
                setDeleting(true);
                try {
                    await Api.deleteMedia(id);
                    toast.success(t('player.deleteSuccess'));
                    navigate('/');
                } catch (err: unknown) {
                    toast.error(err instanceof Error ? err.message : t('player.deleteFailed'), {
                        duration: TOAST_DURATION
                    });
                } finally {
                    setDeleting(false);
                }
            }
        });
    };

    if (loading) return <LoadingState />;

    if (!media)
        return (
            <EmptyState
                icon="⚠️"
                title={t('common.loadFailed')}
            >
                {error && <p className="error-msg">{error}</p>}
            </EmptyState>
        );

    if (!canManage)
        return (
            <EmptyState
                icon="🔒"
                title={t('admin.permissionDenied')}
            />
        );

    return (
        <div className="form-container">
            <div className="page-header">
                <h1>{t('player.editInfo')}</h1>
            </div>
            <div className="card">
                <div className="form-group">
                    <label>{t('player.title')}</label>
                    <input className="form-input" value={title} onChange={(e) => setTitle(e.target.value)} required />
                </div>
                <div className="form-group">
                    <label>{t('player.description')}</label>
                    <textarea className="form-input form-textarea" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
                </div>
                <div className="form-group">
                    <label>{t('player.access')}</label>
                    <select className="form-input form-select" value={minRole} onChange={(e) => setMinRole(e.target.value)}>
                        <option value="guest">{t('meta.role.guest')}</option>
                        <option value="user">{t('meta.role.user')}</option>
                        <option value="owner">{t('meta.role.owner')}</option>
                        {auth.isAdmin && <option value="admin">{t('meta.role.admin')}</option>}
                    </select>
                </div>
                <div className="form-group">
                    <label>{t('player.tags')}</label>
                    <TagSelector selected={tags} onChange={setTags} placeholder={t('player.tagsPlaceholder')} />
                </div>
                <div className="form-group">
                    <label>{t('player.author')}</label>
                    <AuthorSelector value={author} onChange={setAuthor} placeholder={t('player.authorPlaceholder')} />
                </div>
                <div className="form-group">
                    <label>{t('player.sourceUrl')}</label>
                    <input className="form-input" value={source} onChange={(e) => setSource(e.target.value)} placeholder={t('player.sourcePlaceholder')} />
                </div>

                {error && <div className="form-error">⚠️ {error}</div>}

                <div className="btn-row">
                    <button className="btn btn-secondary" onClick={() => navigate('/player/' + id)}>
                        {t('common.cancel')}
                    </button>
                    <button className="btn btn-primary" onClick={handleSave} disabled={saving || !title}>
                        {saving ? t('player.saving') : t('common.save')}
                    </button>
                    <div className="flex-1" />
                    <button className="btn btn-danger" onClick={handleDelete} disabled={deleting}>
                        {deleting ? t('player.deleting') : t('player.delete')}
                    </button>
                </div>
            </div>
        </div>
    );
}
