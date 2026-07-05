import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { Api, apiUrl } from '../api';
import { toast } from 'sonner';
import { useAuthStore } from '../stores/auth';
import EmptyState from '../components/EmptyState';
import { TOAST_DURATION, STORAGE_PREFIX } from '../config';

export default function UploadPage() {
    const navigate = useNavigate();
    const { t } = useTranslation();
    const auth = useAuthStore();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [file, setFile] = useState<File | null>(null);
    const [uploading, setUploading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [uploadError, setUploadError] = useState('');

    if (!auth.isLoggedIn) {
        return (
            <EmptyState
                icon="🔒"
                title={t('upload.loginRequired')}
                description={t('upload.loginRequiredHint')}
            />
        );
    }

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        if (f) setFile(f);
    };

    const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!file) {
            toast.error(t('upload.fileRequired'));
            return;
        }
        setUploading(true);
        setProgress(0);
        setUploadError('');

        // 用 XMLHttpRequest 实现进度跟踪
        const formData = new FormData();
        formData.append('file', file);

        const xhr = new XMLHttpRequest();
        xhr.open('POST', apiUrl('/media'));

        const token = localStorage.getItem(STORAGE_PREFIX + 'auth');
        if (token) {
            try {
                const parsed = JSON.parse(token);
                xhr.setRequestHeader('Authorization', `Bearer ${parsed.token || token}`);
            } catch {
                xhr.setRequestHeader('Authorization', `Bearer ${token}`);
            }
        }

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
        };

        xhr.onload = () => {
            setUploading(false);
            try {
                const data = JSON.parse(xhr.responseText);
                if (xhr.status >= 200 && xhr.status < 300) {
                    toast.success(t('media.uploadSuccess'));
                    navigate('/edit/' + data.media.id);
                } else {
                    const raw = data?.error || 'common.loadFailed';
                    const msg = raw.includes('.') && i18n.exists(raw) ? t(raw) : raw;
                    setUploadError(msg);
                    toast.error(msg, { duration: TOAST_DURATION });
                }
            } catch {
                const msg = t('common.loadFailed');
                setUploadError(msg);
                toast.error(msg, { duration: TOAST_DURATION });
            }
        };

        xhr.onerror = () => {
            setUploading(false);
            const msg = t('upload.networkError');
            setUploadError(msg);
            toast.error(msg, { duration: TOAST_DURATION });
        };

        xhr.send(formData);
    };

    return (
        <div className="form-container">
            <div className="page-header">
                <h1>{t('upload.title')}</h1>
            </div>
            <div className="card">
                <form onSubmit={handleSubmit}>
                    <div
                        className="file-upload"
                        onClick={() => !uploading && fileInputRef.current?.click()}
                        onDragOver={(e) => {
                            e.preventDefault();
                            e.currentTarget.classList.add('dragover');
                        }}
                        onDragLeave={(e) => e.currentTarget.classList.remove('dragover')}
                        onDrop={(e) => {
                            e.preventDefault();
                            e.currentTarget.classList.remove('dragover');
                            const f = e.dataTransfer.files[0];
                            if (f && !uploading) setFile(f);
                        }}
                    >
                        <input ref={fileInputRef} type="file" hidden onChange={handleFileChange} disabled={uploading} />
                        {file ? (
                            <div>
                                <div className="upload-icon"></div>
                                <p>{file.name}</p>
                                <p className="upload-hint">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
                            </div>
                        ) : (
                            <div>
                                <div className="upload-icon">📤</div>
                                <p>{t('upload.dropHint')}</p>
                                <p className="upload-hint">{t('upload.dropHintDetail')}</p>
                            </div>
                        )}
                    </div>

                    {uploading && (
                        <div className="mt-20">
                            <div className="progress-bar">
                                <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
                            </div>
                            <p className="progress-info">
                                {progress}%
                            </p>
                        </div>
                    )}

                    {uploadError && (
                        <div className="form-error mt-16">
                            ⚠️ {uploadError}
                        </div>
                    )}

                    <button className="btn btn-primary btn-lg mt-20 w-full" type="submit" disabled={uploading || !file}>
                        {uploading ? t('upload.uploading') : `${t('upload.uploadBtn')}`}
                    </button>
                </form>
            </div>
        </div>
    );
}
