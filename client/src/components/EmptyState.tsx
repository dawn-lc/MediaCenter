import type { ReactNode } from 'react';

interface Props {
    icon?: string;
    title: string;
    description?: string;
    children?: ReactNode;
}

/**
 * 统一空状态 / 权限不足 / 错误提示组件
 */
export default function EmptyState({ icon, title, description, children }: Props) {
    return (
        <div className="empty-state">
            {icon && <div className="empty-icon">{icon}</div>}
            <h3>{title}</h3>
            {description && <p>{description}</p>}
            {children}
        </div>
    );
}
