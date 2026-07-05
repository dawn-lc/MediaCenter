import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Api } from '../api';
import { toast } from 'sonner';
import { useAuthStore } from '../stores/auth';
import AdminGuard from '../components/AdminGuard';
import { showConfirm } from '../components/ConfirmDialog';

export default function AdminPage() {
    const navigate = useNavigate();
    const { t } = useTranslation();
    const [scanning, setScanning] = useState(false);
    const [scanPath, setScanPath] = useState('./uploads');
    const [resetting, setResetting] = useState(false);
    const [fileHashQuery, setFileHashQuery] = useState('');
    const [fileHashSearching, setFileHashSearching] = useState(false);
    const [fileHashResult, setFileHashResult] = useState<{ found: boolean; media?: { id: string; title: string } } | null>(null);

    const runScan = async () => {
        setScanning(true);
        try {
            const data = await Api.scanDirectory(scanPath);
            toast.success(t('admin.scanComplete') + ` (${data.scan.imported}/${data.scan.total})`);
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : t('admin.scanError'));
        } finally {
            setScanning(false);
        }
    };

    const handleReset = () => {
        showConfirm({
            message: t('admin.danger.confirm1'),
            danger: true,
            confirmText: t('common.confirm'),
            cancelText: t('common.cancel'),
            onConfirm: () => {
                showConfirm({
                    message: t('admin.danger.confirm2'),
                    danger: true,
                    confirmText: t('common.confirm'),
                    cancelText: t('common.cancel'),
                    onConfirm: async () => {
                        setResetting(true);
                        try {
                            await Api.resetDatabase();
                            useAuthStore.getState().logout();
                            toast.success(t('admin.danger.success'));
                            navigate('/');
                        } catch (err: unknown) {
                            toast.error(err instanceof Error ? err.message : t('admin.resetError'));
                        } finally {
                            setResetting(false);
                        }
                    }
                });
            }
        });
    };

    const handleFileHashSearch = async () => {
        const hash = fileHashQuery.trim();
        if (!hash) return;
        setFileHashSearching(true);
        setFileHashResult(null);
        try {
            const data = await Api.findMediaByHash(hash);
            if (data.items.length > 0) {
                setFileHashResult({ found: true, media: { id: data.items[0].id, title: data.items[0].title } });
            } else {
                setFileHashResult({ found: false });
            }
        } catch {
            setFileHashResult({ found: false });
        } finally {
            setFileHashSearching(false);
        }
    };

    return (
        <AdminGuard>
            <div>
                <div className="page-header">
                    <h1>{t('admin.title')}</h1>
                </div>

                {/* 管理导航卡片 */}
                <div className="grid grid-3 section-card">
                    <Link
                        to="/admin/tags"
                        className="card link-card"
                        onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--primary)')}
                        onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
                    >
                        <div className="card-header">
                            <h2>{t('admin.tags.title')}</h2>
                        </div>
                        <p className="card-desc">{t('admin.tags.manageHint')}</p>
                    </Link>

                    <Link
                        to="/admin/authors"
                        className="card link-card"
                        onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--primary)')}
                        onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
                    >
                        <div className="card-header">
                            <h2>{t('admin.authors.title')}</h2>
                        </div>
                        <p className="card-desc">{t('admin.authors.manageHint')}</p>
                    </Link>

                    <Link
                        to="/admin/users"
                        className="card link-card"
                        onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--primary)')}
                        onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
                    >
                        <div className="card-header">
                            <h2>{t('admin.users.title')}</h2>
                        </div>
                        <p className="card-desc">{t('admin.users.manageHint')}</p>
                    </Link>
                </div>

                {/* 目录扫描 */}
                <div className="card section-card">
                    <div className="card-header">
                        <h2>{t('admin.scan.title')}</h2>
                    </div>
                    <p className="text-secondary mb-16">{t('admin.scan.hint')}</p>
                    <div className="admin-inline-form mb-16">
                        <input className="form-input flex-1" value={scanPath} onChange={(e) => setScanPath(e.target.value)} placeholder={t('admin.scan.placeholder')} />
                        <button className="btn btn-primary" onClick={runScan} disabled={scanning}>
                            {scanning ? t('admin.scan.scanning') : t('admin.scan.btn')}
                        </button>
                    </div>
                </div>

                {/* 文件 Hash 搜索 */}
                <div className="card section-card">
                    <div className="card-header">
                        <h2>{t('admin.fileHash.title')}</h2>
                    </div>
                    <p className="text-secondary mb-16">{t('admin.fileHash.hint')}</p>
                    <div className="admin-inline-form mb-16">
                        <input
                            className="form-input flex-1"
                            value={fileHashQuery}
                            onChange={(e) => setFileHashQuery(e.target.value)}
                            placeholder={t('admin.fileHash.placeholder')}
                            onKeyDown={(e) => e.key === 'Enter' && handleFileHashSearch()}
                        />
                        <button className="btn btn-primary" onClick={handleFileHashSearch} disabled={fileHashSearching}>
                            {fileHashSearching ? '...' : t('common.search')}
                        </button>
                    </div>
                    {fileHashResult !== null && (
                        <p style={{ margin: 0, color: fileHashResult.found ? 'var(--success)' : 'var(--danger)' }}>
                            {fileHashResult.found ? (
                                <span>
                                    {t('admin.fileHash.found')}{' '}
                                    <Link to={`/player/${fileHashResult.media!.id}`} className="link-card-inline">
                                        {fileHashResult.media!.title}
                                    </Link>
                                </span>
                            ) : (
                                t('admin.fileHash.notFound')
                            )}
                        </p>
                    )}
                </div>

                {/* 危险操作 */}
                <div className="card card-danger">
                    <div className="card-header">
                        <h2 className="text-danger">{t('admin.danger.title')}</h2>
                    </div>
                    <p className="text-secondary mb-16">{t('admin.danger.hint')}</p>
                    <button className="btn btn-danger" onClick={handleReset} disabled={resetting}>
                        {resetting ? t('admin.danger.resetting') : t('admin.danger.btn')}
                    </button>
                </div>
            </div>
        </AdminGuard>
    );
}
