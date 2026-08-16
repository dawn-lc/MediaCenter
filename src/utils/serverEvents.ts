import { EventEmitter } from 'events';
import { hasMinRole } from './roles';

/**
 * 服务端事件总线：SSE 推送的来源。
 * 各媒体写入路径 emit 业务事件，/api/events 端点统一转发给已连接的客户端。
 */
export const serverEvents = new EventEmitter();
// SSE 客户端连接数可能较多，避免 maxListeners 告警
serverEvents.setMaxListeners(0);

/** 允许通过 SSE 对外推送的事件名（新增事件需同步加入） */
export const PUSH_EVENTS = ['media.updated'] as const;

/** SSE 连接的用户身份（与 req.user 一致） */
export interface SseUser {
    id: string | null;
    username: string;
    role: string;
}

/** 媒体可见性描述（用于按连接用户过滤推送，与 listMedia 的角色过滤一致） */
export interface MediaVisibility {
    uploaderId: string | null;
    minRole: string;
}

/** media.updated 事件负载 */
export interface MediaEventPayload {
    type: 'created' | 'updated' | 'deleted' | 'restored' | 'scanned';
    /** 触发者 id：不推回给触发者本人（其 UI 已反映变更） */
    actorId?: string;
    /** 具体变更媒体的 id（客户端可做增量处理） */
    mediaId?: string;
    /** 媒体可见性：仅推送给能看到该媒体的用户 */
    visibility?: MediaVisibility;
}

/**
 * 判断用户是否能看到该媒体（与 listMedia 的角色过滤保持一致）：
 * - 管理员：全部
 * - 已登录用户：guest/user 级媒体，以及自己上传的 owner 级媒体
 * - 访客：仅 guest 级媒体
 */
export function canSeeMedia(user: SseUser, vis: MediaVisibility): boolean {
    if (user.role === 'admin') return true;
    if (user.id) {
        return hasMinRole(user.role, vis.minRole) || (vis.minRole === 'owner' && vis.uploaderId === user.id);
    }
    return vis.minRole === 'guest';
}
