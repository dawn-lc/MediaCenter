import type { AuthResponse, MediaListResponse, Media, UserListResponse, TagListResponse } from './types';
import i18n from './i18n';
import { STORAGE_PREFIX } from './config';

const AUTH_STORAGE_KEY = STORAGE_PREFIX + 'auth';

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

export class ApiError extends Error {
    constructor(
        message: string,
        public status: number
    ) {
        super(message);
        this.name = 'ApiError';
    }
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

async function request<T>(method: string, path: string, body?: unknown, isFormData = false): Promise<T> {
    const headers: Record<string, string> = {};
    if (!isFormData) headers['Content-Type'] = 'application/json';

    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const fetchUrl = apiUrl(path);
    const res = await fetch(fetchUrl, {
        method,
        headers,
        body: body ? (isFormData ? (body as FormData) : JSON.stringify(body)) : undefined
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
        // 后端返回错误码（如 "auth.invalidCredentials"），前端 i18n 翻译
        const rawError = data?.error || `http.${res.status}`;
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

    getProfile() {
        return request<{ user: import('./types').User }>('GET', '/auth/profile');
    },

    // 媒体
    listMedia(
        params: {
            page?: number;
            limit?: number;
            type?: string;
            search?: string;
            tags?: string;
            authorId?: string;
            authorExpr?: string;
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

    refreshStreamToken(id: string) {
        return request<{ streamUrl: string; downloadUrl: string }>('GET', `/media/${id}/stream-token`);
    },

    uploadMedia(file: File) {
        const formData = new FormData();
        formData.append('file', file);
        return request<{ message: string; media: Media }>('POST', '/media', formData, true);
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
    listTags(params?: { page?: number; limit?: number; search?: string }) {
        const searchParams = new URLSearchParams();
        if (params?.page && params.page > 1) searchParams.set('page', String(params.page));
        if (params?.limit && params.limit !== 20) searchParams.set('limit', String(params.limit));
        if (params?.search) searchParams.set('search', params.search);
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
    listUsers(params?: { page?: number; limit?: number; search?: string }) {
        const searchParams = new URLSearchParams();
        if (params?.page && params.page > 1) searchParams.set('page', String(params.page));
        if (params?.limit && params.limit !== 20) searchParams.set('limit', String(params.limit));
        if (params?.search) searchParams.set('search', params.search);
        const qs = searchParams.toString();
        return request<UserListResponse>('GET', `/admin/users${qs ? '?' + qs : ''}`);
    },

    updateUserRole(userId: string, role: string) {
        return request<{ message: string }>('PUT', `/admin/users/${userId}/role`, { role });
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
    listAuthors(params?: { page?: number; limit?: number; search?: string }) {
        const searchParams = new URLSearchParams();
        if (params?.page && params.page > 1) searchParams.set('page', String(params.page));
        if (params?.limit && params.limit !== 20) searchParams.set('limit', String(params.limit));
        if (params?.search) searchParams.set('search', params.search);
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
