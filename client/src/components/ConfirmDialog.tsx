import { useCallback, useEffect, useState } from 'react';
import Modal from './Modal';
import { useTranslation } from 'react-i18next';

interface ConfirmConfig {
    message: string;
    onConfirm: () => void;
    onCancel?: () => void;
    confirmText?: string;
    cancelText?: string;
    danger?: boolean;
}

let confirmInstance: ((config: ConfirmConfig) => void) | null = null;

export function showConfirm(config: ConfirmConfig) {
    if (confirmInstance) {
        confirmInstance(config);
    }
}

export default function ConfirmDialog() {
    const { t } = useTranslation();
    const [config, setConfig] = useState<ConfirmConfig | null>(null);
    const [open, setOpen] = useState(false);

    useEffect(() => {
        confirmInstance = (cfg: ConfirmConfig) => {
            setConfig(cfg);
            setOpen(true);
        };
        return () => {
            confirmInstance = null;
        };
    }, []);

    const handleConfirm = useCallback(() => {
        setOpen(false);
        config?.onConfirm();
    }, [config]);

    const handleCancel = useCallback(() => {
        setOpen(false);
        config?.onCancel?.();
    }, [config]);

    if (!config) return null;

    return (
        <Modal
            open={open}
            title={t('common.confirmTitle')}
            onClose={handleCancel}
            footer={
                <>
                    <button className="btn btn-secondary" onClick={handleCancel}>
                        {config.cancelText || t('common.cancel')}
                    </button>
                    <button
                        className={`btn ${config.danger ? 'btn-danger' : 'btn-primary'}`}
                        onClick={handleConfirm}
                    >
                        {config.confirmText || t('common.confirm')}
                    </button>
                </>
            }
        >
            <p className="text-sm" style={{ margin: 0 }}>{config.message}</p>
        </Modal>
    );
}
