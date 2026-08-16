// 共享类型定义

export interface User {
    id: string;
    username: string;
    role: 'guest' | 'user' | 'admin';
    banned?: number;
    createdAt?: string;
    updatedAt?: string;
    /** 系统账户（API 服务账户）：禁止删除/降级/封禁 */
    isSystemUser?: boolean;
}

/** 公开用户主页的媒体统计（/api/users/:id） */
export interface PublicUserStats {
    total: number;
    video: number;
    audio: number;
    image: number;
}

/** 公开作者主页的媒体统计（/api/authors/:id） */
export interface PublicAuthorStats {
    total: number;
    video: number;
    audio: number;
    image: number;
}

export interface Media {
    id: string;
    title: string;
    description: string;
    fileName: string;
    filePath: string;
    fileHash?: string | null;
    fileSize: number;
    mimeType: string;
    minRole: string;
    duration: number | null;
    thumbPath: string | null;
    mediaInfo?: string | null;
    thumbUrl?: string | null;
    /** 来源 URL */
    source?: string | null;
    sourceMeta?: string | null;
    /** 作者 */
    author?: { id: string; name: string; altNames: string[]; urls: string[] } | null;
    /** 列表平铺返回的作者字段（listMedia） */
    authorId?: string | null;
    authorName?: string | null;
    uploaderId: string;
    deletedAt?: string | null;
    createdAt: string;
    updatedAt: string;
    uploaderName: string | null;
    /** 带签名的临时流媒体访问链接（后端生成，有过期时间） */
    streamUrl?: string;
    /** 带签名的临时下载链接（后端生成，有过期时间） */
    downloadUrl?: string;
    /** 标签列表 */
    tags?: { id: string; name: string }[];
}

/** 首页概览统计（/api/media/stats） */
export interface MediaStats {
    total: number;
    video: number;
    audio: number;
    image: number;
    /** 总大小，仅管理员返回；其他角色该字段缺失（后端全局 prune 移除 null） */
    totalSize?: number;
}

export interface StatsResponse {
    media: MediaStats;
    /** 标签数，仅管理员返回；其他角色该字段缺失 */
    tags?: number;
    /** 作者数，仅管理员返回；其他角色该字段缺失 */
    authors?: number;
    /** 用户数，仅管理员返回；其他角色该字段缺失 */
    users?: number;
    /** 最近上传（可见范围内，最新 8 条） */
    recent: (Pick<Media, 'id' | 'title' | 'mimeType' | 'fileSize' | 'duration' | 'createdAt'> & {
        streamUrl?: string;
        thumbUrl?: string | null;
        tags?: { id: string; name: string }[];
    })[];
}

export interface Tag {
    id: string;
    name: string;
    altNames?: string[];
    createdAt: string;
    mediaCount?: number;
}

export interface Author {
    id: string;
    name: string;
    altNames: string[];
    urls: string[];
    mediaCount?: number;
}

export interface Pagination {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    sortBy?: string;
    sortOrder?: string;
}

export interface MediaListResponse {
    items: Media[];
    pagination: Pagination;
}

export interface AuthResponse {
    message: string;
    user: User;
    token: string;
    refreshToken: string;
}

export interface UserListResponse {
    users: User[];
    pagination?: Pagination;
}

export interface TagListResponse {
    tags: Tag[];
    pagination?: Pagination;
}
