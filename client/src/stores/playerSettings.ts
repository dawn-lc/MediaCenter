import { create } from 'zustand';
import { DEBOUNCE_MS, DEFAULT_AUTO_PLAY_VIDEO, DEFAULT_STATIC_IMAGE_DURATION, DEFAULT_PLAYBACK_RATE, DEFAULT_VOLUME, STORAGE_PREFIX } from '../config';

const STORAGE_KEY = STORAGE_PREFIX + 'player_settings';

export interface PlayerSettings {
    autoPlay: boolean;
    autoPlayVideo: boolean;
    staticImageDuration: number;
    playbackRate: number;
    volume: number;
    setStaticImageDuration(seconds: number): void;
    setAutoPlay(on: boolean): void;
    setAutoPlayVideo(on: boolean): void;
    setPlaybackRate(rate: number): void;
    setVolume(vol: number): void;
}

// 节流保存
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(data: Omit<PlayerSettings, 'setStaticImageDuration' | 'setAutoPlay' | 'setAutoPlayVideo' | 'setPlaybackRate' | 'setVolume'>) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        saveTimer = null;
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch {
            /* */
        }
    }, DEBOUNCE_MS);
}

function load(): Partial<PlayerSettings> | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

const saved = load();

export const usePlayerSettings = create<PlayerSettings>((set, get) => ({
    autoPlay: saved?.autoPlay ?? DEFAULT_AUTO_PLAY_VIDEO,
    autoPlayVideo: saved?.autoPlayVideo ?? DEFAULT_AUTO_PLAY_VIDEO,
    staticImageDuration: saved?.staticImageDuration ?? DEFAULT_STATIC_IMAGE_DURATION,
    playbackRate: saved?.playbackRate ?? DEFAULT_PLAYBACK_RATE,
    volume: saved?.volume ?? DEFAULT_VOLUME,

    setStaticImageDuration: (seconds) => {
        set({ staticImageDuration: seconds });
        scheduleSave(get());
    },

    setAutoPlay: (on) => {
        set({ autoPlay: on });
        scheduleSave(get());
    },

    setAutoPlayVideo: (on) => {
        set({ autoPlayVideo: on });
        scheduleSave(get());
    },

    setPlaybackRate: (rate) => {
        set({ playbackRate: rate });
        scheduleSave(get());
    },

    setVolume: (vol) => {
        set({ volume: vol });
        scheduleSave(get());
    }
}));
