import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { useThemeStore, type ThemePref } from '../stores/theme';
import { MonitorIcon, MoonIcon, SunIcon } from './icons';

const OPTIONS: { value: ThemePref; icon: ReactElement }[] = [
    { value: 'system', icon: <MonitorIcon /> },
    { value: 'light', icon: <SunIcon /> },
    { value: 'dark', icon: <MoonIcon /> },
];

export default function ThemeToggle() {
    const { t } = useTranslation();
    const pref = useThemeStore((s) => s.pref);
    const effective = useThemeStore((s) => s.effective);
    const setPref = useThemeStore((s) => s.setPref);
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    // 打开时：点击外部 / Esc 关闭
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    // FAB 图标跟随「实际生效主题」（跟随系统时也随系统实时变化）
    const fabIcon = effective === 'light' ? <SunIcon size={24} /> : <MoonIcon size={24} />;

    return (
        <div className="theme-toggle" ref={ref}>
            <div
                className={`theme-menu${open ? ' open' : ''}`}
                role="menu"
                aria-label={t('theme.label')}
            >
                {OPTIONS.map((o) => (
                    <button
                        key={o.value}
                        role="menuitemradio"
                        aria-checked={pref === o.value}
                        className={`theme-menu-item${pref === o.value ? ' active' : ''}`}
                        onClick={() => {
                            setPref(o.value);
                            setOpen(false);
                        }}
                    >
                        <span className="theme-menu-icon">{o.icon}</span>
                        <span>{t(`theme.${o.value}`)}</span>
                        {pref === o.value && (
                            <span className="theme-menu-check" aria-hidden="true">✓</span>
                        )}
                    </button>
                ))}
            </div>
            <button
                type="button"
                className="theme-fab"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                aria-label={t('theme.label')}
                title={t('theme.label')}
            >
                <span className="theme-fab-icon">{fabIcon}</span>
            </button>
        </div>
    );
}
