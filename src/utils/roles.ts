import config from '../config';
import './env';

type Role = keyof typeof config.roles;
const ROLES = config.roles;

/** 媒体可见性角色枚举 */
export enum MediaRole {
    Guest = 'guest',
    User = 'user',
    Owner = 'owner',
    Admin = 'admin'
}

/** 所有媒体可见性级别 */
export const ALL_ROLES = Object.values(MediaRole);
/** 上传者可用的媒体可见性级别（不含 admin） */
export const USER_ROLES = ALL_ROLES.difference([MediaRole.Admin]);

/** 角色层级权重（用于媒体访问控制） */
const ROLE_WEIGHT: Record<MediaRole, number> = {
    [MediaRole.Guest]: 0,
    [MediaRole.User]: 1,
    [MediaRole.Owner]: 2,
    [MediaRole.Admin]: 3
};

/** 判断字符串是否为有效的 MediaRole */
function isMediaRole(value: string): value is MediaRole {
    return Object.values(MediaRole).some((r) => r === value);
}

/** 判断字符串是否为有效的 Role */
function isRole(value: string): value is Role {
    return value in ROLES;
}

/**
 * 检查用户角色是否满足媒体的最低可见性要求
 */
export function hasMinRole(userRole: string, minRole: string): boolean {
    if (!isMediaRole(userRole) || !isMediaRole(minRole)) return false;
    return ROLE_WEIGHT[userRole] >= ROLE_WEIGHT[minRole];
}

/**
 * 检查角色是否有足够的权限
 */
export function hasPermission(role: string, minLevel: number): boolean {
    return isRole(role) ? ROLES[role] >= minLevel : ROLES.guest >= minLevel;
}

/**
 * 获取角色等级
 */
export function getRoleLevel(role: string): number {
    return isRole(role) ? ROLES[role] : ROLES.guest;
}

export { ROLES };
