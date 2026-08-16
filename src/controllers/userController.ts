import { Request, Response } from 'express';
import { and, count, eq, inArray, or } from 'drizzle-orm';
import { getDatabase, schema, API_USERNAME } from '../db/index';

/**
 * GET /api/users/:id — 公开用户主页（需登录）
 * 返回用户公开信息 + 按「当前用户可见范围」过滤的媒体统计
 * （与 listMedia 的角色可见性一致：admin 全部 / 登录 guest+user+自己 owner / 访客仅公开）
 */
export async function getUserPublic(req: Request, res: Response): Promise<void> {
    const db = getDatabase();
    const { id } = req.params;
    if (!id || typeof id !== 'string') {
        res.status(400).json({ error: 'user.invalidId' });
        return;
    }

    const [row] = await db
        .select({
            id: schema.users.id,
            username: schema.users.username,
            role: schema.users.role,
            createdAt: schema.users.createdAt
        })
        .from(schema.users)
        .where(eq(schema.users.id, id))
        .limit(1)
        .execute();

    if (!row) {
        res.status(404).json({ error: 'user.notFound' });
        return;
    }

    // 媒体统计：uploaderId = id 且按当前用户可见性过滤
    const userRole = req.user?.role ?? 'guest';
    const conditions = [eq(schema.media.uploaderId, id)];
    if (userRole !== 'admin') {
        if (req.user?.id) {
            conditions.push(
                or(
                    inArray(schema.media.minRole, ['guest', 'user']),
                    and(eq(schema.media.minRole, 'owner'), eq(schema.media.uploaderId, req.user.id))
                )!
            );
        } else {
            conditions.push(eq(schema.media.minRole, 'guest'));
        }
    }
    const where = and(...conditions);

    const [agg] = await db
        .select({ total: count() })
        .from(schema.media)
        .where(where)
        .execute();

    // 按类型计数（mimeType 前缀聚合）
    const typeRows = await db
        .select({ mimeType: schema.media.mimeType, c: count() })
        .from(schema.media)
        .where(where)
        .groupBy(schema.media.mimeType)
        .execute();
    let video = 0;
    let audio = 0;
    let image = 0;
    for (const r of typeRows) {
        const m = (r.mimeType || '').toLowerCase();
        const c = Number(r.c || 0);
        if (m.startsWith('video/')) video += c;
        else if (m.startsWith('audio/')) audio += c;
        else if (m.startsWith('image/')) image += c;
    }

    res.json({
        user: {
            id: row.id,
            username: row.username,
            role: row.role,
            createdAt: row.createdAt,
            isSystemUser: row.username === API_USERNAME
        },
        stats: {
            total: Number(agg?.total || 0),
            video,
            audio,
            image
        }
    });
}
