import { useTranslation } from 'react-i18next';

interface Props {
    message?: string;
}

/**
 * 统一加载状态组件
 */
export default function LoadingState({ message }: Props) {
    const { t } = useTranslation();
    return (
        <div className="loading">
            <div className="spinner"></div>
            <p>{message || t('common.loading')}</p>
        </div>
    );
}
