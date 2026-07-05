import { create } from 'zustand';
import { Api } from '../api';
import type { User } from '../types';
import { toast } from 'sonner';
import i18n from '../i18n';
import { usePlaylistStore } from './playlist';
import { STORAGE_PREFIX } from '../config';

const STORAGE_KEY = STORAGE_PREFIX + 'auth';

interface AuthState {
    user: User | null;
    token: string | null;
    isLoggedIn: boolean;
    isAdmin: boolean;
    ready: boolean; // 是否完成初始化认证检查
    login(username: string, password: string): Promise<void>;
    logout(): void;
}

export const useAuthStore = create<AuthState>((set) => ({
    user: null,
    token: localStorage.getItem(STORAGE_KEY),
    get isLoggedIn() {
        return !!localStorage.getItem(STORAGE_KEY);
    },
    get isAdmin() {
        return false;
    },
    ready: false,

    login: async (username: string, password: string) => {
        const data = await Api.login(username, password);
        localStorage.setItem(STORAGE_KEY, data.token);
        set({
            user: data.user,
            token: data.token,
            isLoggedIn: true,
            isAdmin: data.user.role === 'admin',
            ready: true
        });
    },

    logout: () => {
        localStorage.removeItem(STORAGE_KEY);
        // 清空播放列表（登出后播放列表不再有效）
        usePlaylistStore.getState().clear();
        set({ user: null, token: null, isLoggedIn: false, isAdmin: false, ready: true });
    }
}));

// 初始化：从 localStorage 恢复
const token = localStorage.getItem(STORAGE_KEY);
if (token) {
    Api.getProfile()
        .then((data) => {
            useAuthStore.setState({
                user: data.user,
                token,
                isLoggedIn: true,
                isAdmin: data.user.role === 'admin',
                ready: true
            });
        })
        .catch(() => {
            localStorage.removeItem(STORAGE_KEY);
            useAuthStore.setState({
                user: null,
                token: null,
                isLoggedIn: false,
                isAdmin: false,
                ready: true
            });
            // showToast 已支持挂载前调用：消息会暂存，待 ToastContainer 挂载后自动显示
            toast.error(i18n.t('auth.sessionExpired'), { position: 'top-center' });
        });
} else {
    useAuthStore.setState({ ready: true });
}
