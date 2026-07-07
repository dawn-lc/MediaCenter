import { useState, useEffect, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

// ---------------------------------------------------------------------------
// PWAProvider
// 功能：
//   1. 在线/离线状态检测 → 显示/隐藏离线提示条 + Toast 通知
// ---------------------------------------------------------------------------

interface PWAProviderProps {
    children: ReactNode;
}

export default function PWAProvider({ children }: PWAProviderProps) {
    const { t } = useTranslation();
    const [online, setOnline] = useState(navigator.onLine);

    useEffect(() => {
        const goOnline = () => {
            setOnline(true);
            toast.success(t('pwa.online'), { duration: 3000 });
        };
        const goOffline = () => {
            setOnline(false);
            toast.error(t('pwa.offline'), { duration: 5000 });
        };

        window.addEventListener('online', goOnline);
        window.addEventListener('offline', goOffline);
        return () => {
            window.removeEventListener('online', goOnline);
            window.removeEventListener('offline', goOffline);
        };
    }, [t]);

    return (
        <>
            {/* 离线横幅 */}
            <div
                className="offline-banner"
                aria-hidden={online}
                role="alert"
                style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    zIndex: 9999,
                    background: '#e74c3c',
                    color: '#fff',
                    textAlign: 'center',
                    padding: '6px 12px',
                    fontSize: 13,
                    fontWeight: 500,
                    transform: online ? 'translateY(-100%)' : 'translateY(0)',
                    transition: 'transform 0.3s ease-in-out',
                }}
            >
                {t('pwa.offlineBanner')}
            </div>

            {children}
        </>
    );
}
