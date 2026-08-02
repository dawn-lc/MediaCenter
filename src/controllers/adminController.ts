import type { Request, Response } from 'express';
import { sql, eq, like, count, desc } from 'drizzle-orm';
import { validate } from 'uuid';
import { getDatabase, schema, ensureDefaultUsers, syncSchemaInternal } from '../db/index';
import { isString } from '../utils/env';

/**
 * 重置数据库 — 清空所有数据并重新初始化
 * POST /api/admin/reset-db
 */
export async function resetDatabase(req: Request, res: Response): Promise<void> {
    // 进入维护模式：阻断所有非重置请求
    req.app.set('maintenance', true);
    console.log('[Admin] 进入维护模式，开始重置数据库...');

    try {
        const db = getDatabase();

        // 1. 删除当前数据库的 public 模式（仅清理当前库，不影响其他库）
        await db.execute(sql`
            DROP SCHEMA IF EXISTS public CASCADE;
            CREATE SCHEMA public;
        `);
        console.log('[Admin] 数据库已清空');

        // 2. 重建 pg_trgm 扩展（被 CASCADE 删除后需要重新启用）
        await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
        console.log('[Admin] pg_trgm 扩展已重建');

        // 3. 根据 schema.ts 重建表结构
        await syncSchemaInternal(db);
        console.log('[Admin] 表结构已重建');

        // 4. 重新创建默认管理员
        await ensureDefaultUsers();

        res.json({ message: 'admin.dbReset' });
    } catch (err) {
        console.error('[Admin] 重置数据库失败:', err);
        res.status(500).json({ error: 'admin.resetError' });
    } finally {
        // 退出维护模式
        req.app.set('maintenance', false);
        console.log('[Admin] 退出维护模式');
    }
}

/**
 * 管理员：删除用户
 * DELETE /api/admin/users/:id
 */
export async function deleteUser(req: Request, res: Response): Promise<void> {
    try {
        const id = req.params.id;
        if (!isString(id)) {
            res.status(400).json({ error: 'admin.invalidId' });
            return;
        }

        // 不能删除自己
        if (id === req.user!.id) {
            res.status(400).json({ error: 'admin.cannotDeleteSelf' });
            return;
        }

        const db = getDatabase();
        const existing = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, id)).limit(1).execute();

        if (!existing[0]) {
            res.status(404).json({ error: 'auth.userNotFound' });
            return;
        }

        await db.delete(schema.users).where(eq(schema.users.id, id)).execute();

        console.log(`[Admin] 用户 ${id} 已被删除`);
        res.json({ message: 'admin.userDeleted' });
    } catch (err) {
        console.error('[Admin] 删除用户失败:', err);
        res.status(500).json({ error: 'error.internal' });
    }
}

/**
 * 管理员：切换用户封禁状态
 * POST /api/admin/users/:id/toggle-ban
 */
export async function toggleBan(req: Request, res: Response): Promise<void> {
    try {
        const id = req.params.id;
        if (!isString(id)) {
            res.status(400).json({ error: 'admin.invalidId' });
            return;
        }

        // 不能封禁自己
        if (id === req.user!.id) {
            res.status(400).json({ error: 'admin.cannotBanSelf' });
            return;
        }

        const db = getDatabase();
        const existing = await db.select({ id: schema.users.id, banned: schema.users.banned }).from(schema.users).where(eq(schema.users.id, id)).limit(1).execute();

        const user = existing[0];
        if (!user) {
            res.status(404).json({ error: 'auth.userNotFound' });
            return;
        }

        const newBanned = user.banned ? 0 : 1;

        await db.update(schema.users).set({ banned: newBanned }).where(eq(schema.users.id, id)).execute();

        console.log(`[Admin] 用户 ${id} 封禁状态已切换为 ${newBanned}`);
        res.json({
            message: newBanned ? 'admin.userBanned' : 'admin.userUnbanned',
            banned: !!newBanned
        });
    } catch (err) {
        console.error('[Admin] 切换封禁状态失败:', err);
        res.status(500).json({ error: 'error.internal' });
    }
}

/**
 * 管理员：获取所有用户列表
 * GET /api/admin/users
 */
export async function listUsers(req: Request, res: Response): Promise<void> {
    try {
        const db = getDatabase();
        const page = Math.max(1, parseInt(req.query.page as string) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
        const offset = (page - 1) * limit;
        const search = (req.query.search as string)?.trim();

        const where = search ? like(schema.users.username, `%${search}%`) : undefined;

        const [countResult] = await db
            .select({ total: count() })
            .from(schema.users)
            .where(where)
            .execute();
        const total = countResult?.total ?? 0;

        const users = await db
            .select({
                id: schema.users.id,
                username: schema.users.username,
                role: schema.users.role,
                banned: schema.users.banned,
                createdAt: schema.users.createdAt,
                updatedAt: schema.users.updatedAt
            })
            .from(schema.users)
            .where(where)
            .orderBy(desc(schema.users.createdAt))
            .limit(limit)
            .offset(offset)
            .execute();

        res.json({
            users,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (err) {
        console.error('[Admin] 获取用户列表失败:', err);
        res.status(500).json({ error: 'error.internal' });
    }
}

/**
 * 管理员：更新用户角色
 * PUT /api/admin/users/:id/role
 */
export async function updateUserRole(req: Request, res: Response): Promise<void> {
    try {
        const id = req.params.id;
        if (!isString(id) || !validate(id)) {
            res.status(404).json({ error: 'auth.userNotFound' });
            return;
        }

        const { role } = req.body;
        if (!isString(role)) {
            res.status(400).json({ error: 'error.invalidRole' });
            return;
        }
        const validRoles = ['guest', 'user', 'admin'];

        if (!validRoles.includes(role)) {
            res.status(400).json({ error: 'error.invalidRole' });
            return;
        }

        const db = getDatabase();

        const existing = await db.select({ id: schema.users.id, username: schema.users.username }).from(schema.users).where(eq(schema.users.id, id)).limit(1).execute();

        const user = existing[0];
        if (!user) {
            res.status(404).json({ error: 'auth.userNotFound' });
            return;
        }

        // 不能修改自己的角色
        if (user.id === req.user!.id) {
            res.status(400).json({ error: 'error.cannotSelfChange' });
            return;
        }

        await db.update(schema.users).set({ role, updatedAt: new Date().toISOString() }).where(eq(schema.users.id, id)).execute();

        res.json({
            message: 'admin.roleUpdated',
            user: { id: user.id, username: user.username, role }
        });
    } catch (err) {
        console.error('[Admin] 更新用户角色失败:', err);
        res.status(500).json({ error: 'error.internal' });
    }
}
