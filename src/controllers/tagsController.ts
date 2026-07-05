import type { Request, Response } from 'express';
import { eq, count, like, or, sql } from 'drizzle-orm';
import { getDatabase, schema } from '../db/index';
import { validate } from 'uuid';
import { isString, isNotEmpty, isArray, isUndefined } from '../utils/env';

/**
 * 获取标签列表（支持分页和搜索）
 * GET /api/tags?page=1&limit=20&search=xxx
 */
export async function listTags(req: Request, res: Response): Promise<void> {
    try {
        const db = getDatabase();
        const page = Math.max(1, parseInt(req.query.page as string) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
        const offset = (page - 1) * limit;
        const search = (req.query.search as string)?.trim();

        // 构建 WHERE 条件：搜索名称或别名
        const where = search
            ? or(
                like(schema.tags.name, `%${search}%`),
                sql`EXISTS (SELECT 1 FROM unnest(${schema.tags.altNames}) AS alt WHERE alt ILIKE ${`%${search}%`})`
            )
            : undefined;

        // 查总数
        const [countResult] = await db
            .select({ total: count() })
            .from(schema.tags)
            .where(where)
            .execute();

        const total = countResult?.total ?? 0;

        // 查当前页
        const result = await db
            .select({
                id: schema.tags.id,
                name: schema.tags.name,
                altNames: schema.tags.altNames,
                createdAt: schema.tags.createdAt,
                mediaCount: count(schema.mediaTags.tagId)
            })
            .from(schema.tags)
            .leftJoin(schema.mediaTags, eq(schema.tags.id, schema.mediaTags.tagId))
            .where(where)
            .groupBy(schema.tags.id, schema.tags.name, schema.tags.altNames, schema.tags.createdAt)
            .orderBy(schema.tags.name)
            .limit(limit)
            .offset(offset)
            .execute();

        res.json({
            tags: result,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (err) {
        console.error('[Tags] 获取列表失败:', err);
        res.status(500).json({ error: 'error.internal' });
    }
}

/**
 * 创建标签
 * POST /api/tags
 */
export async function createTag(req: Request, res: Response): Promise<void> {
    try {
        const { name } = req.body;
        if (!isString(name)) {
            res.status(400).json({ error: 'tag.nameEmpty' });
            return;
        }

        const trimmed = name.trim();
        const db = getDatabase();

        // 检查是否已存在
        const existing = await db.select({ id: schema.tags.id }).from(schema.tags).where(eq(schema.tags.name, trimmed)).limit(1).execute();

        if (existing[0]) {
            res.json({ tag: existing[0] });
            return;
        }

        const [tag] = await db.insert(schema.tags).values({ name: trimmed }).returning().execute();

        res.status(201).json({ tag });
    } catch (err) {
        console.error('[Tags] 创建失败:', err);
        res.status(500).json({ error: 'error.internal' });
    }
}

/**
 * 删除标签
 * DELETE /api/tags/:id
 */
export async function deleteTag(req: Request, res: Response): Promise<void> {
    try {
        const id = req.params.id;
        if (!isString(id)) {
            res.status(400).json({ error: 'tag.invalidParam' });
            return;
        }
        const db = getDatabase();

        const existing = await db.select({ id: schema.tags.id }).from(schema.tags).where(eq(schema.tags.id, id)).limit(1).execute();

        if (!existing[0]) {
            res.status(404).json({ error: 'tag.notFound' });
            return;
        }

        // 先删除关联
        await db.delete(schema.mediaTags).where(eq(schema.mediaTags.tagId, id)).execute();

        await db.delete(schema.tags).where(eq(schema.tags.id, id)).execute();

        res.json({ message: 'admin.tagDeleted' });
    } catch (err) {
        console.error('[Tags] 删除失败:', err);
        res.status(500).json({ error: 'error.internal' });
    }
}

/**
 * 更新标签（别名等）
 * PUT /api/tags/:id
 * Body: { altNames?: string[] }
 */
export async function updateTag(req: Request, res: Response): Promise<void> {
    try {
        const id = req.params.id;
        if (!isString(id) || !validate(id)) {
            res.status(400).json({ error: 'tag.invalidParam' });
            return;
        }

        const { altNames } = req.body;
        const db = getDatabase();

        const existing = await db.select({ id: schema.tags.id }).from(schema.tags).where(eq(schema.tags.id, id)).limit(1).execute();

        if (!existing[0]) {
            res.status(404).json({ error: 'tag.notFound' });
            return;
        }

        const updates: Partial<typeof schema.tags.$inferInsert> = {};
        if (!isUndefined(altNames)) {
            updates.altNames = isArray(altNames) ? altNames.map((s) => isString(s) ? s.trim() : '').filter(isNotEmpty) : [];
        }

        if (Object.keys(updates).length === 0) {
            res.status(400).json({ error: 'tag.noUpdate' });
            return;
        }

        await db.update(schema.tags).set(updates).where(eq(schema.tags.id, id)).execute();

        const [tag] = await db.select().from(schema.tags).where(eq(schema.tags.id, id)).execute();

        res.json({ tag });
    } catch (err) {
        console.error('[Tags] 更新失败:', err);
        res.status(500).json({ error: 'error.internal' });
    }
}
