import type { AuthResponse, MediaListResponse, Media, UserListResponse, TagListResponse, StatsResponse } from './types';
import i18n from './i18n';
import { STORAGE_PREFIX } from './config';
import { ApiError } from './apiError';

const AUTH_STORAGE_KEY = STORAGE_PREFIX + 'auth';

/** 令牌失效事件（auth store 监听并重置登录态，避免重复弹提示） */
export const SESSION_EXPIRED_EVENT = 'mediacenter:session-expired';
/** 令牌静默续期成功事件（auth store 监听更新 access token，SSE 等依赖 token 的连接随之重建） */
export const TOKEN_REFRESHED_EVENT = 'mediacenter:token-refreshed';
/** refreshToken 持久化 key（记住登录） */
export const AUTH_REFRESH_STORAGE_KEY = STORAGE_PREFIX + 'auth_refresh';

/**
 * API 基础地址
 * - 可通过 VITE_API_BASE 环境变量指定（如 http://10.0.0.165:3000）
 * - 未设置时使用 Vite 代理的 /api
 */
const API_BASE = import.meta.env.VITE_API_BASE ? String(import.meta.env.VITE_API_BASE).replace(/\/+$/, '') + '/api' : '/api';

/** 获取 API 完整 URL */
export function apiUrl(path: string): string {
    return API_BASE.startsWith('/') ? API_BASE + path : new URL(API_BASE + path).href;
}

/** API 基础域名（不含 /api 路径），用于将相对 URL 转为绝对地址 */
const API_HOST = import.meta.env.VITE_API_BASE ? new URL(String(import.meta.env.VITE_API_BASE).replace(/\/+$/, '')).href.replace(/\/$/, '') : '';

/**
 * 将后端返回的相对路径（如 /api/stream/xxx）转为绝对 URL
 * 仅在设置了 VITE_API_BASE 时生效，否则原样返回
 */
export function resolveApiUrl(path: string | null | undefined): string {
    if (!path) return '';
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    if (!API_HOST) return path;
    // API_HOST 已确保无尾部斜杠，path 以 / 开头
    return new URL(API_HOST + path).href;
}

/** 从 localStorage 读取 token（和 auth store 使用相同 key） */
function getToken(): string | null {
    try {
        const saved = localStorage.getItem(AUTH_STORAGE_KEY);
        if (!saved) return null;
        // 兼容存储格式：纯字符串 token 或 { token } 对象
        try {
            const parsed = JSON.parse(saved);
            return parsed.token || (typeof parsed === 'string' ? parsed : null);
        } catch {
            return saved; // 纯字符串 token
        }
    } catch {
        /* ignore */
    }
    return null;
}

/** 正在进行的刷新请求（并发 401 只刷一次） */
let refreshPromise: Promise<boolean> | null = null;

/** 用 refreshToken 静默续期：成功后写入新令牌并通知 auth store，返回是否成功 */
async function tryRefreshToken(): Promise<boolean> {
    if (!refreshPromise) {
        refreshPromise = doRefreshToken().finally(() => {
            refreshPromise = null;
        });
    }
    return refreshPromise;
}

async function doRefreshToken(): Promise<boolean> {
    const refreshToken = localStorage.getItem(AUTH_REFRESH_STORAGE_KEY);
    if (!refreshToken) return false;
    try {
        const res = await fetch(apiUrl('/auth/refresh'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken })
        });
        if (!res.ok) return false;
        const data = await res.json();
        if (!data?.token || !data?.refreshToken) return false;
        localStorage.setItem(AUTH_STORAGE_KEY, data.token);
        localStorage.setItem(AUTH_REFRESH_STORAGE_KEY, data.refreshToken);
        // 通知 auth store 更新内存 access token（SSE 等依赖 token 的连接随之重建）
        window.dispatchEvent(new CustomEvent(TOKEN_REFRESHED_EVENT, { detail: { token: data.token } }));
        return true;
    } catch {
        return false;
    }
}

async function request<T>(method: string, path: string, body?: unknown, isFormData = false, retried = false): Promise<T> {
    const headers: Record<string, string> = {};
    if (!isFormData) headers['Content-Type'] = 'application/json';

    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    let res: Response;
    try {
        res = await fetch(apiUrl(path), {
            method,
            headers,
            body: body ? (isFormData ? (body as FormData) : JSON.stringify(body)) : undefined
        });
    } catch {
        // 网络层错误（断网/超时等）：仅抛出，由全局错误处理器弹 toast
        throw new ApiError(i18n.t('common.networkError'), 0);
    }

    const data = await res.json().catch(() => null);

    if (!res.ok) {
        // 后端返回错误码（如 "auth.invalidCredentials"），前端 i18n 翻译
        const rawError = data?.error || `http.${res.status}`;
        // 令牌失效：优先用 refreshToken 静默续期并重试原请求（仅重试一次）；
        // 续期失败才重置登录态并提示会话过期（由 auth store 监听事件处理，此处不重复弹）
        if (res.status === 401 && rawError === 'auth.tokenInvalid') {
            if (!retried && (await tryRefreshToken())) {
                return request<T>(method, path, body, isFormData, true);
            }
            try {
                localStorage.removeItem(AUTH_STORAGE_KEY);
                localStorage.removeItem(AUTH_REFRESH_STORAGE_KEY);
            } catch {
                /* ignore */
            }
            window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
            throw new ApiError(i18n.t('auth.sessionExpired'), 401, true);
        }
        const displayError = rawError.includes('.') && i18n.exists(rawError) ? i18n.t(rawError) : rawError;
        throw new ApiError(displayError, res.status);
    }

    // 成功后端返回的 message 也是 i18n 错误码，自动翻译
    if (data && typeof data.message === 'string' && data.message.includes('.')) {
        data.message = i18n.exists(data.message) ? i18n.t(data.message) : data.message;
    }

    return data as T;
}

export const Api = {
    // 认证
    login(username: string, password: string) {
        return request<AuthResponse>('POST', '/auth/login', { username, password });
    },

    register(username: string, password: string) {
        return request<AuthResponse>('POST', '/auth/register', { username, password });
    },

    refreshToken(refreshToken: string) {
        return request<{ token: string; refreshToken: string }>('POST', '/auth/refresh', {
            refreshToken
        });
    },

    /** 登出：撤销该用户所有 refresh token（失败由调用方静默处理） */
    logout() {
        return request<{ message: string }>('POST', '/auth/logout');
    },

    getProfile() {
        return request<{ user: import('./types').User }>('GET', '/auth/profile');
    },

    /** 公开用户主页信息（需登录）：用户信息 + 按当前用户可见范围的媒体统计 */
    getUser(id: string) {
        return request<{ user: import('./types').User; stats: import('./types').PublicUserStats }>('GET', `/users/${encodeURIComponent(id)}`);
    },

    /** 公开作者主页信息：作者信息 + 按当前用户可见范围的媒体统计 */
    getAuthor(id: string) {
        return request<{ author: import('./types').Author; stats: import('./types').PublicAuthorStats }>('GET', `/authors/${encodeURIComponent(id)}`);
    },

    /** 修改密码：验证旧密码，成功后撤销当前用户全部 refresh token */
    changePassword(data: { oldPassword: string; newPassword: string }) {
        return request<{ message: string }>('POST', '/auth/change-password', data);
    },

    // 媒体
    listMedia(
        params: {
            page?: number;
            limit?: number;
            type?: string;
            search?: string;
            tags?: string;
            authorExpr?: string;
            authorId?: string;
            uploaderId?: string;
            sortBy?: string;
            sortOrder?: string;
        } = {}
    ) {
        const url = new URL('/media', window.location.origin);
        if (params.page) url.searchParams.set('page', String(params.page));
        if (params.limit !== undefined) url.searchParams.set('limit', String(params.limit));
        if (params.type) url.searchParams.set('type', params.type);
        if (params.search) url.searchParams.set('search', params.search);
        if (params.tags) url.searchParams.set('tags', params.tags);
        if (params.authorExpr) url.searchParams.set('authorExpr', params.authorExpr);
        if (params.authorId) url.searchParams.set('authorId', params.authorId);
        if (params.uploaderId) url.searchParams.set('uploaderId', params.uploaderId);
        if (params.sortBy) url.searchParams.set('sortBy', params.sortBy);
        if (params.sortOrder) url.searchParams.set('sortOrder', params.sortOrder);
        return request<MediaListResponse>('GET', url.pathname + url.search);
    },

    getMedia(id: string) {
        return request<{ media: Media }>('GET', `/media/${id}`);
    },

    /** 首页概览统计（媒体总数/类型/总大小/标签/作者/最近上传） */
    getStats() {
        return request<StatsResponse>('GET', '/media/stats');
    },

    refreshStreamToken(id: string) {
        return request<{ streamUrl: string; downloadUrl: string }>('GET', `/media/${id}/stream-token`);
    },

    uploadMedia(file: File) {
        const formData = new FormData();
        formData.append('file', file);
        return request<{ message: string; id: string }>('POST', '/media/upload', formData, true);
    },

    updateMedia(
        id: string,
        data: {
            title?: string;
            description?: string;
            duration?: number | null;
            minRole?: string;
            tags?: string[];
            author?: string;
            source?: string;
            fileName?: string;
            filePath?: string;
            fileSize?: number;
            fileHash?: string | null;
            mimeType?: string;
            thumbPath?: string | null;
            mediaInfo?: string | null;
            sourceMeta?: string | null;
            createdAt?: string;
            updatedAt?: string;
        }
    ) {
        return request<{ message: string; media: Media }>('PUT', `/media/${id}`, data);
    },

    deleteMedia(id: string) {
        return request<{ message: string }>('DELETE', `/media/${id}`);
    },

    restoreMedia(id: string) {
        return request<{ message: string }>('PUT', `/media/${id}/restore`);
    },

    // 标签
    listTags(params?: { page?: number; limit?: number; search?: string; sortBy?: string; sortOrder?: string }) {
        const searchParams = new URLSearchParams();
        if (params?.page && params.page > 1) searchParams.set('page', String(params.page));
        if (params?.limit && params.limit !== 20) searchParams.set('limit', String(params.limit));
        if (params?.search) searchParams.set('search', params.search);
        if (params?.sortBy) searchParams.set('sortBy', params.sortBy);
        if (params?.sortOrder) searchParams.set('sortOrder', params.sortOrder);
        const qs = searchParams.toString();
        return request<TagListResponse>('GET', `/tags${qs ? '?' + qs : ''}`);
    },

    createTag(name: string) {
        return request<{ tag: import('./types').Tag }>('POST', '/tags', { name });
    },

    updateTag(id: string, data: { altNames?: string[] }) {
        return request<{ tag: import('./types').Tag }>('PUT', `/tags/${id}`, data);
    },

    deleteTag(id: string) {
        return request<{ message: string }>('DELETE', `/tags/${id}`);
    },

    findMediaByHash(hash: string) {
        return request<MediaListResponse>('GET', `/media?fileHash=${encodeURIComponent(hash)}&limit=1`);
    },

    // 管理
    listUsers(params?: { page?: number; limit?: number; search?: string; sortBy?: string; sortOrder?: string }) {
        const searchParams = new URLSearchParams();
        if (params?.page && params.page > 1) searchParams.set('page', String(params.page));
        if (params?.limit && params.limit !== 20) searchParams.set('limit', String(params.limit));
        if (params?.search) searchParams.set('search', params.search);
        if (params?.sortBy) searchParams.set('sortBy', params.sortBy);
        if (params?.sortOrder) searchParams.set('sortOrder', params.sortOrder);
        const qs = searchParams.toString();
        return request<UserListResponse>('GET', `/admin/users${qs ? '?' + qs : ''}`);
    },

    updateUserRole(userId: string, role: string) {
        return request<{ message: string }>('PUT', `/admin/users/${userId}/role`, { role });
    },

    /** 管理员创建用户（注册关闭时也可手动添加） */
    createUser(data: { username: string; password: string; role?: string }) {
        return request<{ message: string; user: import('./types').User }>('POST', '/admin/users', data);
    },

    deleteUser(userId: string) {
        return request<{ message: string }>('DELETE', `/admin/users/${userId}`);
    },

    toggleBan(userId: string) {
        return request<{ message: string; banned: boolean }>('POST', `/admin/users/${userId}/toggle-ban`);
    },

    scanDirectory(path: string) {
        return request<{
            message: string;
            scan: {
                total: number;
                imported: number;
                skipped: number;
                errors: number;
                files: string[];
            };
        }>('POST', `/admin/scan`, { path });
    },

    resetDatabase() {
        return request<{ message: string }>('POST', '/admin/reset-db');
    },

    // 作者
    listAuthors(params?: { page?: number; limit?: number; search?: string; sortBy?: string; sortOrder?: string }) {
        const searchParams = new URLSearchParams();
        if (params?.page && params.page > 1) searchParams.set('page', String(params.page));
        if (params?.limit && params.limit !== 20) searchParams.set('limit', String(params.limit));
        if (params?.search) searchParams.set('search', params.search);
        if (params?.sortBy) searchParams.set('sortBy', params.sortBy);
        if (params?.sortOrder) searchParams.set('sortOrder', params.sortOrder);
        const qs = searchParams.toString();
        return request<{ authors: import('./types').Author[]; pagination?: import('./types').Pagination }>('GET', `/authors${qs ? '?' + qs : ''}`);
    },

    createAuthor(name: string, altNames?: string[], urls?: string[]) {
        return request<{ author: import('./types').Author }>('POST', '/authors', {
            name,
            altNames,
            urls
        });
    },

    updateAuthor(id: string, data: { name?: string; altNames?: string[]; urls?: string[] }) {
        return request<{ author: import('./types').Author }>('PUT', `/authors/${id}`, data);
    },

    deleteAuthor(id: string) {
        return request<{ message: string }>('DELETE', `/authors/${id}`);
    }
};
