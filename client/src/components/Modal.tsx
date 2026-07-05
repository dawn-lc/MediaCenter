import { useEffect, useState, type ReactNode } from 'react';
import { MODAL_CLOSE_MS } from '../config';

interface Props {
    open: boolean;
    title: string;
    children: ReactNode;
    onClose: () => void;
    footer?: ReactNode;
}

export default function Modal({ open, title, children, onClose, footer }: Props) {
    const [visible, setVisible] = useState(false);
    const [animating, setAnimating] = useState(false);

    useEffect(() => {
        if (open) {
            setVisible(true);
            // 等待 DOM 插入后再添加动画 class
            requestAnimationFrame(() => {
                requestAnimationFrame(() => setAnimating(true));
            });
        } else {
            setAnimating(false);
            const timer = setTimeout(() => setVisible(false), MODAL_CLOSE_MS);
            return () => clearTimeout(timer);
        }
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [open, onClose]);

    if (!visible) return null;

    return (
        <div
            className={`modal-overlay${animating ? ' modal-open' : ''}`}
            onClick={onClose}
        >
            <div
                className={`modal${animating ? ' modal-open' : ''}`}
                onClick={(e) => e.stopPropagation()}
            >
                {title && (
                    <div className="modal-header">
                        <h2>{title}</h2>
                        <button className="modal-close" onClick={onClose} aria-label="Close">
                            ✕
                        </button>
                    </div>
                )}
                <div className="modal-body">{children}</div>
                {footer && <div className="modal-footer">{footer}</div>}
            </div>
        </div>
    );
}
