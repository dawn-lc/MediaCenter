import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { useThemeStore, type ThemePref } from '../../stores/theme';
import { MonitorIcon, MoonIcon, SunIcon } from '../base/Icons';

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
    // 移动端播放页：底部固定悬浮控制栏的高度（undefined 表示不避让，用 CSS 默认 bottom）
    const [fabBottom, setFabBottom] = useState<number | undefined>(undefined);

    // 自动布局：测量播放页底部固定控制栏（.player-controls）实际高度，FAB 精确避让
    // （替代 CSS 硬编码 120px；控制栏高度随内容换行/安全区动态变化）
    useEffect(() => {
        let raf = 0;
        const update = () => {
            const isMobile = window.matchMedia('(max-width: 768px)').matches;
            const controls = document.querySelector<HTMLElement>('.player-controls');
            // 仅当移动端且控制栏为固定底栏时才避让；其余场景用 CSS 默认 bottom: 20px
            if (!isMobile || !controls || getComputedStyle(controls).position !== 'fixed') {
                setFabBottom(undefined);
                return;
            }
            setFabBottom(Math.round(controls.getBoundingClientRect().height) + 12);
        };
        const schedule = () => {
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(update);
        };

        // 视口断点变化（进出移动端）
        const mq = window.matchMedia('(max-width: 768px)');
        mq.addEventListener?.('change', schedule);
        // 控制栏高度变化（窗口 resize、内容换行、安全区）
        const ro = new ResizeObserver(schedule);
        // 播放页懒加载，控制栏出现/消失时重新测量
        const mo = new MutationObserver(schedule);
        mo.observe(document.body, { childList: true, subtree: true });

        const controls = document.querySelector<HTMLElement>('.player-controls');
        if (controls) ro.observe(controls);

        schedule();
        return () => {
            cancelAnimationFrame(raf);
            mq.removeEventListener?.('change', schedule);
            ro.disconnect();
            mo.disconnect();
        };
    }, []);

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
        <div
            className="theme-toggle"
            ref={ref}
            style={fabBottom !== undefined ? { bottom: fabBottom } : undefined}
        >
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
