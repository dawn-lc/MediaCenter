// 共享类型定义

export interface User {
    id: string;
    username: string;
    role: 'guest' | 'user' | 'admin';
    banned?: number;
    createdAt?: string;
    updatedAt?: string;
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
    /** 作者 */
    author?: { id: string; name: string; altNames: string[]; urls: string[] } | null;
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
