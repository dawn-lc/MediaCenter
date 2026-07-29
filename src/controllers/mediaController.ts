import type { Request, Response } from 'express';
import { v4 as uuidv4, validate } from 'uuid';
import { basename, extname, dirname, join } from 'path';
import { rename } from 'fs/promises';
import { eq, ilike, like, and, or, desc, count, sql, inArray, notInArray, isNull, type SQL } from 'drizzle-orm';
import { getDatabase, schema } from '../db/index';
import { similarity } from '../db/index';
import { deleteFile, isSupportedMimeType } from '../utils/storage';
import mime from 'mime-types';
import { generateSignedUrl } from '../utils/signUrl';
import { hasMinRole, ALL_ROLES, USER_ROLES } from '../utils/roles';
import { parseExpr, evaluateExpr } from '../utils/exprParser';
import type { ExprNode } from '../utils/exprParser';
import { computeFileHash } from '../utils/hash';
import { probeMedia, serializeMediaInfo, type MediaInfo } from '../utils/ffprobe';
import { resolveBestMimeType } from '../utils/mimeType';
import config from '../config';
import { isString, isNumber, isArray, isNotEmpty, isPresent, isNullOrUndefined, isUndefined, toNumberOrNull, toStringOrNull, createPicker, prune, checkFileExists } from '../utils/env';

// ========== 表达式求值器（标签 / 作者维度）==========

/** 获取所有未删除的媒体 ID（NOT 运算全集） */
async function getAllMediaIds(): Promise<Set<string>> {
    const db = getDatabase();
    const rows = await db
        .select({ id: schema.media.id })
        .from(schema.media)
        .where(isNull(schema.media.deletedAt))
        .execute();
    return new Set(rows.map((r) => r.id));
}

/** 标签维度求值：叶子 → 匹配 tags.name / altNames */
async function evaluateTagAst(node: ExprNode): Promise<Set<string>> {
    return evaluateExpr(node, async (name) => {
        const db = getDatabase();
        const rows = await db
            .select({ mediaId: schema.mediaTags.mediaId })
            .from(schema.mediaTags)
            .innerJoin(schema.tags, eq(schema.mediaTags.tagId, schema.tags.id))
            .where(
                or(
                    eq(schema.tags.name, name),
                    sql`${name} = ANY(${schema.tags.altNames})`
                )
            )
            .execute();
        return new Set(rows.map((r) => r.mediaId));
    }, getAllMediaIds);
}

/** 作者维度求值：叶子 → 匹配 authors.name / altNames → 反查 media */
async function evaluateAuthorAst(node: ExprNode): Promise<Set<string>> {
    return evaluateExpr(node, async (name) => {
        const db = getDatabase();
        const authorRows = await db
            .select({ id: schema.authors.id })
            .from(schema.authors)
            .where(
                or(
                    eq(schema.authors.name, name),
                    sql`${name} = ANY(${schema.authors.altNames})`
                )
            )
            .execute();
        const authorIds = authorRows.map((a) => a.id);
        if (authorIds.length === 0) return new Set<string>();

        const mediaRows = await db
            .select({ id: schema.media.id })
            .from(schema.media)
            .where(inArray(schema.media.authorId, authorIds))
            .execute();
        return new Set(mediaRows.map((r) => r.id));
    }, getAllMediaIds);
}

// ========== 标签同步 ==========

/**
 * 同步媒体标签：创建不存在的标签，建立关联，移除旧关联
 * @param db - 数据库实例
 * @param mediaId - 媒体 ID
 * @param tagNames - 标签名称数组
 * @returns 标签列表 [{ id, name }]
 */
async function syncMediaTags(db: ReturnType<typeof getDatabase>, mediaId: string, tagNames: string[], userRole: string): Promise<{ id: string; name: string }[]> {
    // 1. 批量查找已有标签
    const names = tagNames.map((n) => n.trim()).filter(isNotEmpty).unique();
    if (names.length === 0) return [];

    const existingTags = await db.select({ id: schema.tags.id, name: schema.tags.name }).from(schema.tags).where(inArray(schema.tags.name, names)).execute();

    const existingMap = new Map(existingTags.map((t) => [t.name, t]));
    const tagRecords: { id: string; name: string }[] = [...existingTags];

    // 2. 检查是否有不存在的标签
    const newNames = names.filter((n) => !existingMap.has(n));
    if (newNames.length > 0) {
        if (userRole !== 'admin') {
            // 非管理员不能创建新标签（但可以关联已有标签）
            throw new Error('media.forbiddenTag');
        }
        const inserted = await db
            .insert(schema.tags)
            .values(newNames.map((name) => ({ name })))
            .returning({ id: schema.tags.id, name: schema.tags.name })
            .execute();
        tagRecords.push(...inserted);
    }

    // 2. 删除旧的关联
    await db.delete(schema.mediaTags).where(eq(schema.mediaTags.mediaId, mediaId)).execute();

    // 3. 建立新的关联
    if (tagRecords.length > 0) {
        await db
            .insert(schema.mediaTags)
            .values(tagRecords.map((t) => ({ mediaId, tagId: t.id })))
            .execute();
    }

    return tagRecords;
}

/**
 * 为媒体列表批量加载标签
 * @param mediaIds - 媒体 ID 数组
 * @returns Map<mediaId, tags[]>
 */
async function loadTagsForMedia(mediaIds: string[]): Promise<Map<string, { id: string; name: string }[]>> {
    if (mediaIds.length === 0) return new Map();
    const db = getDatabase();
    const tagMap = new Map<string, { id: string; name: string }[]>();
    const BATCH = 5000;

    for (let i = 0; i < mediaIds.length; i += BATCH) {
        const batch = mediaIds.slice(i, i + BATCH);
        const rows = await db
            .select({
                mediaId: schema.mediaTags.mediaId,
                tagId: schema.tags.id,
                tagName: schema.tags.name
            })
            .from(schema.mediaTags)
            .innerJoin(schema.tags, eq(schema.mediaTags.tagId, schema.tags.id))
            .where(inArray(schema.mediaTags.mediaId, batch))
            .execute();

        for (const row of rows) {
            const list = tagMap.get(row.mediaId) || [];
            list.push({ id: row.tagId, name: row.tagName });
            tagMap.set(row.mediaId, list);
        }
    }
    return tagMap;
}

/**
 * 将作者名称解析为 authorId：查找已有作者，管理员可创建新作者
 */
async function resolveAuthorId(name: string | undefined, userRole: string): Promise<string | null> {
    if (!isString(name) || !isNotEmpty(name.trim())) return null;
    const db = getDatabase();
    const trimmed = name.trim();
    // 同时匹配主名称和别名
    const [existing] = await db
        .select({ id: schema.authors.id })
        .from(schema.authors)
        .where(
            or(
                eq(schema.authors.name, trimmed),
                sql`${trimmed} = ANY(${schema.authors.altNames})`
            )
        )
        .limit(1)
        .execute();
    if (existing) return existing.id;
    // 非管理员不能创建新作者
    if (userRole !== 'admin') {
        throw new Error('media.forbiddenAuthor');
    }
    const [created] = await db.insert(schema.authors).values({ name: trimmed }).returning({ id: schema.authors.id }).execute();
    return created.id;
}

/**
 * 获取媒体列表（支持分页和过滤）
 * GET /api/media?page=1&limit=20&type=video&search=keyword&sortBy=title&sortOrder=asc
 */
export async function listMedia(req: Request, res: Response): Promise<void> {
    try {
        const db = getDatabase();
        const qPage = isString(req.query.page) ? parseInt(req.query.page, 10) : NaN;
        const page = Math.max(1, qPage || 1);
        const qLimit = isString(req.query.limit) ? parseInt(req.query.limit, 10) : NaN;
        const rawLimit = qLimit;
        const noLimit = rawLimit === 0;
        const limit = noLimit ? 0 : Math.min(100, Math.max(1, rawLimit || 20));
        const offset = noLimit ? 0 : (page - 1) * limit;
        const type = isString(req.query.type) ? req.query.type : undefined;
        const search = isString(req.query.search) ? req.query.search : undefined;
        const fileHash = isString(req.query.fileHash) ? req.query.fileHash : undefined;
        const filePath = isString(req.query.filePath) ? req.query.filePath : undefined;
        const fileName = isString(req.query.fileName) ? req.query.fileName : undefined;
        const tagsExpr = isString(req.query.tags) ? req.query.tags : undefined;
        const authorExpr = isString(req.query.authorExpr) ? req.query.authorExpr : undefined;
        const uploaderId = isString(req.query.uploaderId) ? req.query.uploaderId : undefined;
        const sortBy = isString(req.query.sortBy) ? req.query.sortBy : 'createdAt';
        const sortOrder = isString(req.query.sortOrder) && req.query.sortOrder.toLowerCase() === 'asc' ? 'asc' : 'desc';

        // 构建查询条件
        const conditions: SQL[] = [];
        // 非管理员看不到已软删除的内容，管理员可见全部
        if (req.user?.role !== 'admin') {
            conditions.push(isNull(schema.media.deletedAt));
        }

        if (type) {
            conditions.push(ilike(schema.media.mimeType, `${type}/%`));
        }

        if (search) {
            conditions.push(or(ilike(schema.media.title, `%${search}%`), ilike(schema.media.description, `%${search}%`))!);
        }

        if (fileHash) {
            // 仅管理员允许通过 fileHash 精确查找媒体
            if (req.user?.role !== 'admin') {
                res.status(403).json({ error: 'admin.required' });
                return;
            }
            conditions.push(eq(schema.media.fileHash, fileHash));
        }

        if (filePath) {
            // 仅管理员允许通过 filePath 精确查找媒体
            if (req.user?.role !== 'admin') {
                res.status(403).json({ error: 'admin.required' });
                return;
            }
            conditions.push(ilike(schema.media.filePath, `%${filePath}%`));
        }

        if (fileName) {
            // 仅管理员允许通过 fileName 精确查找媒体
            if (req.user?.role !== 'admin') {
                res.status(403).json({ error: 'admin.required' });
                return;
            }
            conditions.push(ilike(schema.media.fileName, `%${fileName}%`));
        }


        // 标签表达式筛选：?tags=A&(B|C)|D  支持 ! 排除
        if (tagsExpr) {
            try {
                const ast = parseExpr(tagsExpr);
                if (ast) {
                    if (ast.type === 'not') {
                        // 顶层 NOT → 只求 child，用 NOT IN 避免全量补集
                        const idSet = await evaluateTagAst(ast.child);
                        const ids = [...idSet];
                        if (ids.length > 0) {
                            conditions.push(notInArray(schema.media.id, ids));
                        }
                    } else {
                        const idSet = await evaluateTagAst(ast);
                        const ids = [...idSet];
                        if (ids.length === 0) {
                            res.json({ items: [], pagination: { page, limit, total: 0, totalPages: 0, sortBy, sortOrder } });
                            return;
                        }
                        conditions.push(inArray(schema.media.id, ids));
                    }
                }
            } catch {
                res.status(400).json({ error: 'media.invalidTagExpr' });
                return;
            }
        }

        // 作者表达式筛选：?authorExpr=A&(B|C)|D  支持 ! 排除
        if (authorExpr) {
            try {
                const ast = parseExpr(authorExpr);
                if (ast) {
                    if (ast.type === 'not') {
                        const idSet = await evaluateAuthorAst(ast.child);
                        const ids = [...idSet];
                        if (ids.length > 0) {
                            conditions.push(notInArray(schema.media.id, ids));
                        }
                    } else {
                        const idSet = await evaluateAuthorAst(ast);
                        const ids = [...idSet];
                        if (ids.length === 0) {
                            res.json({ items: [], pagination: { page, limit, total: 0, totalPages: 0, sortBy, sortOrder } });
                            return;
                        }
                        conditions.push(inArray(schema.media.id, ids));
                    }
                }
            } catch {
                res.status(400).json({ error: 'media.invalidAuthorExpr' });
                return;
            }
        }

        if (uploaderId) {
            conditions.push(eq(schema.media.uploaderId, uploaderId));
        }

        // 按角色过滤可见的媒体
        // guest → 仅公开；user → 公开 + 登录用户 + 自己的 owner；admin → 全部
        const userRole = req.user?.role ?? 'guest';
        if (userRole === 'admin') {
            // 管理员看到全部（包括 owner）
        } else if (req.user?.id) {
            // 已登录用户：可看 guest/user 以及自己的 owner 媒体
            conditions.push(or(inArray(schema.media.minRole, ['guest', 'user']), and(eq(schema.media.minRole, 'owner'), eq(schema.media.uploaderId, req.user.id)))!);
        } else {
            // 未登录访客：仅公开媒体
            conditions.push(eq(schema.media.minRole, 'guest'));
        }

        const where = conditions.length > 0 ? and(...conditions) : undefined;

        // 查询总数
        const countResult = await db.select({ total: count() }).from(schema.media).where(where).execute();

        const total = Number(countResult[0]?.total || 0);

        // 排序：始终按客户端指定的排序字段和顺序
        let orderBy: SQL;
        if (sortBy === 'relevance' && search) {
            orderBy = desc(similarity(schema.media.title, search));
        } else {
            const sortMap: Record<string, any> = {
                title: schema.media.title,
                createdAt: schema.media.createdAt,
                fileSize: schema.media.fileSize,
                mimeType: schema.media.mimeType
            };
            const orderColumn = sortMap[sortBy] || schema.media.createdAt;
            orderBy = sortOrder === 'asc' ? orderColumn : desc(orderColumn);
        }

        // 查询列表（仅返回列表渲染必需字段）
        let query = db
            .select({
                id: schema.media.id,
                title: schema.media.title,
                fileSize: schema.media.fileSize,
                mimeType: schema.media.mimeType,
                duration: schema.media.duration,
                thumbPath: schema.media.thumbPath,
                fileHash: schema.media.fileHash,
                deletedAt: schema.media.deletedAt,
                createdAt: schema.media.createdAt
            })
            .from(schema.media)
            .where(where)
            .orderBy(orderBy);

        if (!noLimit) {
            query = query.limit(limit).offset(offset) as typeof query;
        }

        const allItems = await query.execute();

        // 批量加载标签
        const tagMap = await loadTagsForMedia(allItems.map((i) => i.id));

        // 为每个媒体生成签名访问链接并附加标签
        const itemsWithUrls = allItems.map((item) => {
            const { thumbPath, ...rest } = item;
            return prune({
                ...rest,
                streamUrl: generateSignedUrl(item.id, 'stream', req.user?.id || null, { role: req.user?.role }),
                thumbUrl: thumbPath
                    ? generateSignedUrl(item.id, 'thumb', req.user?.id || null, {
                        expiresIn: 24 * 3600,
                        role: req.user?.role
                    })
                    : null,
                tags: tagMap.get(item.id) || []
            });
        });

        // filteredTotal 在无 limit 时返回总数，否则返回当前页过滤后的数量（近似）
        const filteredTotal = noLimit ? allItems.length : total;

        res.json({
            items: itemsWithUrls,
            pagination: {
                page,
                limit,
                total: filteredTotal,
                totalPages: noLimit ? 1 : Math.ceil(filteredTotal / limit),
                sortBy,
                sortOrder
            }
        });
    } catch (err) {
        console.error('[Media] 获取列表失败:', err);
        res.status(500).json({ error: 'error.internal' });
    }
}

/**
 * 获取单个媒体详情
 * GET /api/media/:id
 */
export async function getMedia(req: Request, res: Response): Promise<void> {
    try {
        const id = req.params.id;
        if (!isString(id) || !validate(id)) {
            res.status(404).json({ error: 'media.notFound' });
            return;
        }

        const db = getDatabase();
        const result = await db
            .select({
                id: schema.media.id,
                title: schema.media.title,
                description: schema.media.description,
                fileName: schema.media.fileName,
                filePath: schema.media.filePath,
                fileSize: schema.media.fileSize,
                fileHash: schema.media.fileHash,
                mimeType: schema.media.mimeType,
                minRole: schema.media.minRole,
                duration: schema.media.duration,
                thumbPath: schema.media.thumbPath,
                mediaInfo: schema.media.mediaInfo,
                sourceMeta: schema.media.sourceMeta,
                uploaderId: schema.media.uploaderId,
                deletedAt: schema.media.deletedAt,
                createdAt: schema.media.createdAt,
                updatedAt: schema.media.updatedAt,
                uploaderName: schema.users.username,
                authorId: schema.media.authorId,
                authorName: schema.authors.name,
                authorAltNames: schema.authors.altNames,
                authorUrls: schema.authors.urls
            })
            .from(schema.media)
            .leftJoin(schema.users, eq(schema.media.uploaderId, schema.users.id))
            .leftJoin(schema.authors, eq(schema.media.authorId, schema.authors.id))
            .where(
                and(
                    eq(schema.media.id, id),
                    req.user?.role !== 'admin' ? isNull(schema.media.deletedAt) : undefined
                )
            )
            .limit(1)
            .execute();

        const mediaRecord = result[0];

        if (!mediaRecord) {
            res.status(404).json({ error: 'media.notFound' });
            return;
        }

        // 权限检查：用户角色必须满足媒体的最低角色要求
        // owner 级别的媒体允许上传者和管理员访问
        const minRole = mediaRecord.minRole ?? 'guest';
        if (minRole === 'owner') {
            if (req.user!.role !== 'admin' && req.user!.id !== mediaRecord.uploaderId) {
                res.status(403).json({ error: 'media.permissionDenied' });
                return;
            }
        } else if (!hasMinRole(req.user!.role ?? 'guest', minRole)) {
            res.status(403).json({ error: 'media.permissionDenied' });
            return;
        }

        // 生成带签名的临时访问链接（供原生媒体标签使用）
        const streamUrl = generateSignedUrl(mediaRecord.id, 'stream', req.user?.id || null, { role: req.user?.role });
        const downloadUrl = generateSignedUrl(mediaRecord.id, 'download', req.user?.id || null, { role: req.user?.role });
        const thumbUrl = mediaRecord.thumbPath
            ? generateSignedUrl(mediaRecord.id, 'thumb', req.user?.id || null, {
                expiresIn: 24 * 3600,
                role: req.user?.role
            })
            : null;

        // 加载标签
        const tagMap = await loadTagsForMedia([mediaRecord.id]);
        const tags = tagMap.get(mediaRecord.id) || [];

        const { authorId, authorName, authorAltNames, authorUrls, thumbPath, ...mediaData } = mediaRecord;

        const isAdmin = req.user?.role === 'admin';

        const response: Record<string, unknown> = {
            ...mediaData,
            streamUrl,
            downloadUrl,
            thumbUrl,
            tags,
            author: authorId
                ? {
                    id: authorId,
                    name: authorName,
                    altNames: authorAltNames,
                    urls: authorUrls
                }
                : null
        };

        // 非管理员不返回内部路径和详细元数据
        if (!isAdmin) {
            delete response.filePath;
            delete response.fileName;
            delete response.mediaInfo;
            delete response.fileHash;
        }

        res.json({ media: response });
    } catch (err) {
        console.error('[Media] 获取详情失败:', err);
        res.status(500).json({ error: 'error.internal' });
    }
}

/**
 * 刷新流媒体签名令牌（前端定期调用，避免长视频签名过期）
 * GET /api/media/:id/stream-token
 */
export async function refreshStreamToken(req: Request, res: Response): Promise<void> {
    try {
        const id = req.params.id;
        if (!isString(id) || !validate(id)) {
            res.status(404).json({ error: 'media.notFound' });
            return;
        }

        const db = getDatabase();
        const result = await db.select({ minRole: schema.media.minRole, uploaderId: schema.media.uploaderId }).from(schema.media).where(and(eq(schema.media.id, id), req.user?.role !== 'admin' ? isNull(schema.media.deletedAt) : undefined)).limit(1).execute();

        const mediaRecord = result[0];
        if (!mediaRecord) {
            res.status(404).json({ error: 'media.notFound' });
            return;
        }

        // 权限检查
        const minRole = mediaRecord.minRole ?? 'guest';
        if (minRole === 'owner') {
            if (req.user!.role !== 'admin' && req.user!.id !== mediaRecord.uploaderId) {
                res.status(403).json({ error: 'media.permissionDenied' });
                return;
            }
        } else if (!hasMinRole(req.user!.role ?? 'guest', minRole)) {
            res.status(403).json({ error: 'media.permissionDenied' });
            return;
        }

        const streamUrl = generateSignedUrl(id, 'stream', req.user?.id || null, { role: req.user?.role });
        const downloadUrl = generateSignedUrl(id, 'download', req.user?.id || null, { role: req.user?.role });

        // 防止 Express 的 ETag 缓存导致同一秒内的请求返回 304
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.set('Pragma', 'no-cache');
        res.json({ streamUrl, downloadUrl });
    } catch (err) {
        console.error('[Media] 刷新签名令牌失败:', err);
        res.status(500).json({ error: 'error.internal' });
    }
}

// ========== 媒体记录创建（uploadMedia / createMedia 共享）==========

/** 检查文件是否已存在，是则返回 409 */
async function checkDuplicate(fileHash: string | null): Promise<{ id: string; title: string } | null> {
    if (!fileHash) return null;
    const db = getDatabase();
    const [row] = await db
        .select({ id: schema.media.id, title: schema.media.title })
        .from(schema.media)
        .where(eq(schema.media.fileHash, fileHash))
        .limit(1)
        .execute();
    return row ?? null;
}

/** 解析 uploaderId：API 令牌无用户 ID 时回退为首个管理员 */
async function resolveUploaderId(req: Request): Promise<string> {
    if (req.user!.id) return req.user!.id;
    const db = getDatabase();
    const [u] = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.role, 'admin'))
        .limit(1)
        .execute();
    return u!.id; // ensureDefaultUsers 保证管理员存在
}

/** 探测媒体文件，返回归一化后的 probe 结果；失败返回 null */
async function probeMediaFile(
    filePath: string,
    currentMimeType: string
): Promise<{ info: MediaInfo; bestMimeType: string; serialized: string } | null> {
    const info = await probeMedia(filePath);
    if (!info) return null;
    return {
        info,
        bestMimeType: resolveBestMimeType(currentMimeType, info.videoCodec),
        serialized: serializeMediaInfo(info)!
    };
}

/** 探测媒体 → 写入 DB → 返回新记录的 id */
async function createMediaRecord(
    req: Request,
    params: {
        originalname: string;
        filePath: string;
        fileHash: string | null;
        fileSize: number;
        mimeType: string;
        sourceMeta?: string | null;
        id?: string;
    }
): Promise<string> {
    const db = getDatabase();

    const id = params.id ?? uuidv4();
    const uploaderId = await resolveUploaderId(req);

    const probe = await probeMediaFile(params.filePath, params.mimeType);
    if (!probe) {
        throw new Error('无法识别媒体类型');
    }

    await db
        .insert(schema.media)
        .values({
            id,
            title: basename(params.originalname, extname(params.originalname)).slice(0, config.maxTitleLength),
            description: '',
            fileName: params.originalname,
            filePath: params.filePath,
            fileHash: params.fileHash,
            fileSize: params.fileSize,
            duration: probe.info.duration,
            mimeType: probe.bestMimeType,
            mediaInfo: probe.serialized,
            sourceMeta: params.sourceMeta ?? null,
            uploaderId,
            minRole: 'owner'
        } satisfies typeof schema.media.$inferInsert)
        .execute();

    return id;
}

/** 探测媒体文件并更新数据库记录（探针失败时静默返回原值） */
export async function updateMediaInfo(
    mediaId: string,
    filePath: string,
    currentMimeType: string
): Promise<{ duration: number | null; mimeType: string; mediaInfo: string | null }> {
    const probe = await probeMediaFile(filePath, currentMimeType);
    if (!probe) {
        return { duration: null, mimeType: currentMimeType, mediaInfo: null };
    }

    const db = getDatabase();
    await db
        .update(schema.media)
        .set({
            duration: probe.info.duration,
            mimeType: probe.bestMimeType,
            mediaInfo: probe.serialized
        })
        .where(eq(schema.media.id, mediaId))
        .execute();

    return { duration: probe.info.duration, mimeType: probe.bestMimeType, mediaInfo: probe.serialized };
}

/**
 * 上传媒体文件（Multer multipart/form-data）
 * POST /api/media/upload
 */
export async function uploadMedia(req: Request, res: Response): Promise<void> {
    try {
        if (!req.file) {
            res.status(400).json({ error: 'media.noFile' });
            return;
        }

        const filePath = req.file.path;
        const fileHash = await computeFileHash(filePath);

        // 检查重复（在 rename 前，以便清理临时文件）
        const dup = await checkDuplicate(fileHash);
        if (dup) {
            try { deleteFile(filePath); } catch { /* ignore */ }
            res.status(409).json({ error: 'media.duplicateFile', existingId: dup.id, existingTitle: dup.title });
            return;
        }

        const id = uuidv4();
        const ext = extname(filePath);
        const finalPath = join(dirname(filePath), `${id}${ext}`);
        await rename(filePath, finalPath);

        await createMediaRecord(req, {
            originalname: req.file.originalname,
            filePath: finalPath,
            fileHash,
            fileSize: req.file.size,
            mimeType: req.file.mimetype,
            id
        });

        res.status(201).json({ message: 'media.uploadSuccess', id });
    } catch (err) {
        console.error('[Media] 上传失败:', err);
        res.status(500).json({ error: 'error.internal' });
    }
}

/**
 * 导入本地媒体文件（管理员指定服务器本地路径）
 * POST /api/media
 */
export async function createMedia(req: Request, res: Response): Promise<void> {
    try {
        if (req.user?.role !== 'admin') {
            res.status(403).json({ error: 'media.forbiddenLocalPath' });
            return;
        }

        const filePath = req.body.filePath;
        if (!isString(filePath)) {
            res.status(400).json({ error: 'media.noFilePath' });
            return;
        }

        let mimeType: string;
        if (isString(req.body.mimeType)) {
            mimeType = req.body.mimeType;
        } else {
            const detected = mime.lookup(filePath) || 'application/octet-stream';
            if (!isSupportedMimeType(detected)) {
                res.status(415).json({ error: `不支持的媒体类型: ${detected}` });
                return;
            }
            mimeType = detected;
        }

        const fileHash = isString(req.body.fileHash) ? req.body.fileHash : null;
        const dup = await checkDuplicate(fileHash);
        if (dup) {
            res.status(409).json({ error: 'media.duplicateFile', existingId: dup.id, existingTitle: dup.title });
            return;
        }

        const id = await createMediaRecord(req, {
            originalname: basename(filePath),
            filePath,
            fileHash,
            fileSize: isNumber(req.body.fileSize) ? req.body.fileSize! : 0,
            mimeType,
            sourceMeta: isString(req.body.sourceMeta) ? req.body.sourceMeta : null
        });

        res.status(201).json({ message: 'media.importSuccess', id });
    } catch (err) {
        console.error('[Media] 导入本地文件失败:', err);
        res.status(500).json({ error: 'error.internal' });
    }
}

/**
 * 更新媒体元数据
 * PUT /api/media/:id
 */
export async function updateMedia(req: Request, res: Response): Promise<void> {
    try {
        const id = req.params.id;
        if (!isString(id) || !validate(id)) {
            res.status(404).json({ error: 'media.notFound' });
            return;
        }
        const db = getDatabase();
        // 查询现有记录（需要 filePath 和 mimeType 用于更新前 probe）
        const existing = await db
            .select({
                uploaderId: schema.media.uploaderId,
                filePath: schema.media.filePath,
                mimeType: schema.media.mimeType
            })
            .from(schema.media)
            .where(and(eq(schema.media.id, id), req.user?.role !== 'admin' ? isNull(schema.media.deletedAt) : undefined))
            .limit(1)
            .execute();
        const mediaRecord = existing[0];
        if (!mediaRecord) {
            res.status(404).json({ error: 'media.notFound' });
            return;
        }
        // 权限检查：仅管理员或上传者可修改
        if (req.user!.role !== 'admin' && mediaRecord.uploaderId !== req.user!.id) {
            res.status(403).json({ error: 'media.modifyDenied' });
            return;
        }

        const body = req.body as Record<string, unknown>;
        const isAdmin = req.user!.role === 'admin';
        const updates: Record<string, unknown> = {};

        const pick = createPicker(body, updates);

        // ── 通用字段（管理员/上传者均可修改）──
        pick('title', isString, (v) => v.slice(0, config.maxTitleLength));
        pick('description', isString, (v) => v.slice(0, config.maxDescLength));

        const minRole = body.minRole;
        if (isString(minRole)) {
            const allowed = isAdmin ? ALL_ROLES : USER_ROLES;
            if (allowed.some((r) => r === minRole)) updates.minRole = minRole;
        }

        // ── 管理员专属字段 ──
        if (isAdmin) {
            pick('fileName', isString);
            pick('mimeType', isString);
            pick('uploaderId', isString);
            pick('createdAt', isString);
            pick('updatedAt', isString);
            pick('source', isString);
            pick('sourceMeta', isString);
            pick('mediaInfo', isString);
            pick('fileSize', isPresent, (v) => Number(v));
            pick('fileHash', isPresent, toStringOrNull);
            pick('thumbPath', isPresent, toStringOrNull);
            pick('duration', isPresent, toNumberOrNull);

            // filePath 需额外检查文件是否存在
            const filePath = body.filePath;
            if (isString(filePath) && (await checkFileExists(filePath))) {
                updates.filePath = filePath;
            }

            // author 需异步解析为 authorId
            const author = body.author;
            if (isString(author)) {
                updates.authorId = await resolveAuthorId(author, req.user!.role!);
            }
        }

        const hasTagUpdate = isArray(body.tags);

        if (Object.keys(updates).length === 0 && !hasTagUpdate) {
            res.status(400).json({ error: 'media.noUpdate' });
            return;
        }

        // 探测媒体信息并并入 updates（先 probe，再一次 DB 写入）
        const targetFilePath = (updates.filePath as string) ?? mediaRecord.filePath;
        const targetMimeType = (updates.mimeType as string) ?? mediaRecord.mimeType;
        const probe = await probeMediaFile(targetFilePath, targetMimeType);
        if (probe) {
            updates.duration = probe.info.duration;
            updates.mimeType = probe.bestMimeType;
            updates.mediaInfo = probe.serialized;
        }

        // 执行更新
        if (Object.keys(updates).length > 0) {
            if (isUndefined(updates.updatedAt)) updates.updatedAt = new Date().toISOString();
            await db.update(schema.media).set(updates).where(eq(schema.media.id, id)).execute();
        }

        // 处理标签（上传者也可以管理标签）
        if (hasTagUpdate) {
            await syncMediaTags(db, id, body.tags as string[], req.user!.role!);
        }

        // 查询更新后的完整记录
        const updatedResult = await db
            .select({
                id: schema.media.id,
                title: schema.media.title,
                description: schema.media.description,
                fileName: schema.media.fileName,
                filePath: schema.media.filePath,
                fileSize: schema.media.fileSize,
                mimeType: schema.media.mimeType,
                minRole: schema.media.minRole,
                duration: schema.media.duration,
                thumbPath: schema.media.thumbPath,
                mediaInfo: schema.media.mediaInfo,
                uploaderId: schema.media.uploaderId,
                deletedAt: schema.media.deletedAt,
                createdAt: schema.media.createdAt,
                updatedAt: schema.media.updatedAt,
                uploaderName: schema.users.username,
                authorId: schema.media.authorId,
                authorName: schema.authors.name,
                authorAltNames: schema.authors.altNames,
                authorUrls: schema.authors.urls
            })
            .from(schema.media)
            .leftJoin(schema.users, eq(schema.media.uploaderId, schema.users.id))
            .leftJoin(schema.authors, eq(schema.media.authorId, schema.authors.id))
            .where(and(eq(schema.media.id, id), req.user?.role !== 'admin' ? isNull(schema.media.deletedAt) : undefined))
            .limit(1)
            .execute();

        // 加载标签
        const tagMap = await loadTagsForMedia([id]);
        const tags = tagMap.get(id) || [];

        const { authorId: resId, authorName: resName, authorAltNames: resAlt, authorUrls: resUrls, thumbPath: resThumb, ...mediaData } = updatedResult[0];

        res.json({
            message: 'media.updateSuccess',
            media: {
                ...mediaData,
                thumbUrl: resThumb
                    ? generateSignedUrl(id, 'thumb', req.user?.id || null, {
                        expiresIn: 24 * 3600,
                        role: req.user?.role
                    })
                    : null,
                tags,
                author: resId ? { id: resId, name: resName, altNames: resAlt, urls: resUrls } : null
            }
        });
    } catch (err) {
        console.error('[Media] 更新失败:', err);
        const message = err instanceof Error ? err.message : 'error.internal';
        const forbidden = ['media.forbiddenTag', 'media.forbiddenAuthor'];
        if (forbidden.includes(message)) {
            res.status(403).json({ error: message });
        } else {
            res.status(500).json({ error: 'error.internal' });
        }
    }
}

/**
 * 删除媒体文件
 * DELETE /api/media/:id
 */
export async function deleteMedia(req: Request, res: Response): Promise<void> {
    try {
        const id = req.params.id;
        if (!isString(id) || !validate(id)) {
            res.status(404).json({ error: 'media.notFound' });
            return;
        }

        const db = getDatabase();

        const existing = await db
            .select({
                uploaderId: schema.media.uploaderId,
                filePath: schema.media.filePath,
                thumbPath: schema.media.thumbPath
            })
            .from(schema.media)
            .where(and(eq(schema.media.id, id), req.user?.role !== 'admin' ? isNull(schema.media.deletedAt) : undefined))
            .limit(1)
            .execute();

        const mediaRecord = existing[0];
        if (!mediaRecord) {
            res.status(404).json({ error: 'media.notFound' });
            return;
        }

        // 权限检查：只有管理员或上传者本人可以删除
        if (req.user!.role !== 'admin' && mediaRecord.uploaderId !== req.user!.id) {
            res.status(403).json({ error: 'media.deleteDenied' });
            return;
        }

        if (req.user!.role === 'admin') {
            // 管理员：硬删除 — 删除物理文件 + 数据库记录
            deleteFile(mediaRecord.filePath);
            if (mediaRecord.thumbPath) {
                deleteFile(mediaRecord.thumbPath);
            }
            await db.delete(schema.media).where(eq(schema.media.id, id)).execute();
        } else {
            // 普通用户：软删除 — 仅标记 deletedAt，保留数据库记录和物理文件
            await db
                .update(schema.media)
                .set({ deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
                .where(eq(schema.media.id, id))
                .execute();
        }

        res.json({ message: 'media.deleteSuccess' });
    } catch (err) {
        console.error('[Media] 删除失败:', err);
        res.status(500).json({ error: 'error.internal' });
    }
}

/**
 * 恢复已软删除的媒体（仅管理员）
 * 注：因 JSON body prune 中间件会过滤 null 值，无法通过 updateMedia 传递 deletedAt=null，故设独立路由
 * PUT /api/media/:id/restore
 */
export async function restoreMedia(req: Request, res: Response): Promise<void> {
    try {
        const id = req.params.id;
        if (!isString(id) || !validate(id)) {
            res.status(404).json({ error: 'media.notFound' });
            return;
        }

        if (req.user?.role !== 'admin') {
            res.status(403).json({ error: 'media.permissionDenied' });
            return;
        }

        const db = getDatabase();
        const [existing] = await db
            .select({ deletedAt: schema.media.deletedAt })
            .from(schema.media)
            .where(eq(schema.media.id, id))
            .limit(1)
            .execute();

        if (!existing) {
            res.status(404).json({ error: 'media.notFound' });
            return;
        }

        if (!existing.deletedAt) {
            res.status(400).json({ error: 'media.notDeleted' });
            return;
        }

        await db
            .update(schema.media)
            .set({ deletedAt: null, updatedAt: new Date().toISOString() })
            .where(eq(schema.media.id, id))
            .execute();

        res.json({ message: 'media.restoreSuccess' });
    } catch (err) {
        console.error('[Media] 恢复失败:', err);
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
