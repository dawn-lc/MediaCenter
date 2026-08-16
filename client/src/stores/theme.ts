import { create } from 'zustand';
import { STORAGE_PREFIX } from '../config';

export type ThemePref = 'system' | 'light' | 'dark';
export type EffectiveTheme = 'light' | 'dark';

const STORAGE_KEY = STORAGE_PREFIX + 'theme';

const media: MediaQueryList | null =
    typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: light)') : null;

/** system 时按系统实际偏好解析，否则取显式偏好 */
export function resolveEffective(pref: ThemePref): EffectiveTheme {
    if (pref === 'system') return media && media.matches ? 'light' : 'dark';
    return pref;
}

/** 把有效主题写到 <html data-theme> 并同步 store 的 effective（实际生效主题） */
export function applyTheme(pref: ThemePref) {
    const effective = resolveEffective(pref);
    if (typeof document !== 'undefined') {
        document.documentElement.dataset.theme = effective;
    }
    useThemeStore.setState({ effective });
}

export function loadPref(): ThemePref {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
    } catch {
        /* */
    }
    return 'system';
}

interface ThemeState {
    pref: ThemePref;
    /** 实际生效的主题（跟随系统时随系统变化） */
    effective: EffectiveTheme;
    setPref(pref: ThemePref): void;
}

const initial = loadPref();

export const useThemeStore = create<ThemeState>((set) => ({
    pref: initial,
    effective: 'dark',
    setPref: (pref) => {
        set({ pref });
        try {
            localStorage.setItem(STORAGE_KEY, pref);
        } catch {
            /* */
        }
        applyTheme(pref);
    },
}));

applyTheme(initial);

// 跟随系统时监听系统主题变化，实时切换
if (media) {
    const onChange = () => {
        if (useThemeStore.getState().pref === 'system') applyTheme('system');
    };
    if (typeof media.addEventListener === 'function') {
        media.addEventListener('change', onChange);
    } else {
        (media as unknown as { addListener: (fn: () => void) => void }).addListener(onChange);
    }
}
