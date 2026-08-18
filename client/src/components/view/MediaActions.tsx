import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Media } from '../../types';
import { useAuthStore } from '../../stores/auth';
import { Api, resolveApiUrl } from '../../api';
import { notify } from '../../utils/notify';

interface Props {
    media: Media;
}

export default function MediaActions({ media }: Props) {
    const navigate = useNavigate();
    const { t } = useTranslation();
    const auth = useAuthStore();

    const canManage = auth.isAdmin || (auth.isLoggedIn && media.uploaderId === auth.user?.id);

    const handleRestore = async () => {
        await notify.promise(Api.restoreMedia(media.id), {
            loading: t('media.restoring'),
            success: t('media.restoreSuccess'),
            // 重新加载页面以获取最新状态
            onSuccess: () => window.location.reload()
        });
    };

    return (
        <>
            <a className="btn btn-secondary btn-sm" href={resolveApiUrl(media.downloadUrl ?? '#')}>
                {t('view.download')}
            </a>
            {canManage && (
                <button className="btn btn-secondary btn-sm" onClick={() => navigate('/edit/' + media.id)}>
                    {t('common.edit')}
                </button>
            )}
            {auth.isAdmin && media.deletedAt && (
                <button className="btn btn-primary btn-sm" onClick={handleRestore}>
                    {t('view.restore')}
                </button>
            )}
        </>
    );
}
