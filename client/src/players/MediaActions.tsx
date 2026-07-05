import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { Media } from '../types';
import { useAuthStore } from '../stores/auth';
import { Api, resolveApiUrl } from '../api';

interface Props {
    media: Media;
}

export default function MediaActions({ media }: Props) {
    const navigate = useNavigate();
    const { t } = useTranslation();
    const auth = useAuthStore();

    const canManage = auth.isAdmin || (auth.isLoggedIn && media.uploaderId === auth.user?.id);

    const handleRestore = async () => {
        try {
            await Api.restoreMedia(media.id);
            toast.success(t('media.restoreSuccess'));
            // 重新加载页面以获取最新状态
            window.location.reload();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err));
        }
    };

    return (
        <>
            <a className="btn btn-secondary btn-sm" href={resolveApiUrl(media.downloadUrl ?? '#')}>
                {t('player.download')}
            </a>
            {canManage && (
                <button className="btn btn-secondary btn-sm" onClick={() => navigate('/edit/' + media.id)}>
                    {t('player.edit')}
                </button>
            )}
            {auth.isAdmin && media.deletedAt && (
                <button className="btn btn-primary btn-sm" onClick={handleRestore}>
                    {t('player.restore')}
                </button>
            )}
        </>
    );
}
