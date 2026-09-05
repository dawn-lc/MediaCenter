import { useTranslation } from 'react-i18next';

/**
 * 媒体显示前的占位元素：换源/加载中覆盖媒体区域
 * （absolute 定位覆盖，父容器需 position:relative，如 .video-gesture-wrap / .audio-card / .image-wrapper）
 */
export default function MediaLoading() {
    const { t } = useTranslation();
    return (
        <div className="media-loading-placeholder">
            <div className="spinner"></div>
            <span>{t('common.loading')}</span>
        </div>
    );
}
