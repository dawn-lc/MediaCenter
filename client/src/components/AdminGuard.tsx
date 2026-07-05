import type { ReactNode } from 'react';
import { useAuthStore } from '../stores/auth';
import { useTranslation } from 'react-i18next';
import EmptyState from './EmptyState';

interface Props {
    children: ReactNode;
}

/**
 * 管理员权限守卫：非管理员显示 403 提示
 */
export default function AdminGuard({ children }: Props) {
    const { t } = useTranslation();
    const auth = useAuthStore();

    if (!auth.isAdmin) {
        return (
            <EmptyState
                icon="🔒"
                title={t('admin.permissionDenied')}
            />
        );
    }

    return <>{children}</>;
}
