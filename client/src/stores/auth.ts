import { create } from 'zustand';
import { Api, SESSION_EXPIRED_EVENT, TOKEN_REFRESHED_EVENT, AUTH_REFRESH_STORAGE_KEY } from '../api';
import type { User } from '../types';
import i18n from '../i18n';
import { notify } from '../utils/notify';
import { usePlaylistStore } from './playlist';
import { queryClient } from '../queryClient';
import { STORAGE_PREFIX, TOAST_DURATION } from '../config';

const STORAGE_KEY = STORAGE_PREFIX + 'auth';

interface AuthState {
    user: User | null;
    token: string | null;
    isLoggedIn: boolean;
    isAdmin: boolean;
    ready: boolean; // 是否完成初始化认证检查
    login(username: string, password: string, remember?: boolean): Promise<void>;
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

    login: async (username: string, password: string, remember = true) => {
        const data = await Api.login(username, password);
        localStorage.setItem(STORAGE_KEY, data.token);
        // 记住登录：勾选时持久化 refreshToken（跨会话自动续期）；否则不保存，access token 过期后需重新登录
        if (remember) {
            localStorage.setItem(AUTH_REFRESH_STORAGE_KEY, data.refreshToken);
        } else {
            localStorage.removeItem(AUTH_REFRESH_STORAGE_KEY);
        }
        set({
            user: data.user,
            token: data.token,
            isLoggedIn: true,
            isAdmin: data.user.role === 'admin',
            ready: true
        });
    },

    logout: () => {
        // 通知服务端撤销该用户全部 refresh token（尽力而为，失败不影响本地登出）
        Api.logout().catch(() => { });
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(AUTH_REFRESH_STORAGE_KEY);
        // 清空播放列表（登出后播放列表不再有效）
        usePlaylistStore.getState().clear();
        // 清空 TanStack Query 缓存（防止跨用户/跨会话数据泄漏）
        queryClient.clear();
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
                // 从 localStorage 取最新 token（若访问令牌已过期，api 层已静默续期写入新值）
                token: localStorage.getItem(STORAGE_KEY),
                isLoggedIn: true,
                isAdmin: data.user.role === 'admin',
                ready: true
            });
        })
        .catch(() => {
            localStorage.removeItem(STORAGE_KEY);
            localStorage.removeItem(AUTH_REFRESH_STORAGE_KEY);
            // 初始化失败也清理查询缓存，避免残留上一会话数据
            queryClient.clear();
            useAuthStore.setState({
                user: null,
                token: null,
                isLoggedIn: false,
                isAdmin: false,
                ready: true
            });
            // 不在此处弹提示：令牌失效时 api 层已抛出会话过期错误，
            // 由发起请求的页面统一弹出，避免与页面请求失败提示重复
        });
} else {
    useAuthStore.setState({ ready: true });
}

// 令牌静默续期成功：更新内存中的 access token（localStorage 已由 api 层写入）
window.addEventListener(TOKEN_REFRESHED_EVENT, (e) => {
    const detail = (e as CustomEvent<{ token?: string }>).detail;
    if (detail?.token) {
        useAuthStore.setState({ token: detail.token });
    }
});

// 令牌失效事件：任何 API 请求遇到失效令牌时重置登录态并弹出统一提示
window.addEventListener(SESSION_EXPIRED_EVENT, () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(AUTH_REFRESH_STORAGE_KEY);
    // 清空播放列表（登出后播放列表不再有效）
    usePlaylistStore.getState().clear();
    // 清空 TanStack Query 缓存（防止跨用户/跨会话数据泄漏）
    queryClient.clear();
    useAuthStore.setState({
        user: null,
        token: null,
        isLoggedIn: false,
        isAdmin: false,
        ready: true
    });
    // 固定 id 防重：并发请求同时 401 也只弹一条；顶部居中展示
    notify.error(undefined, {
        fallback: i18n.t('auth.sessionExpired'),
        id: 'auth-session-expired',
        position: 'top-center',
        duration: TOAST_DURATION
    });
});
