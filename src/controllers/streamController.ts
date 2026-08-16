import type { Request, Response } from 'express';
import { eq, and, isNull } from 'drizzle-orm';
import { isUuid } from '../utils/uuid';
import mime from 'mime-types';
import send from 'send';
import { getDatabase, schema } from '../db/index';
import { hasMinRole } from '../utils/roles';
import { isString } from '../utils/env';
import { updateMediaInfo } from './mediaController';
import { access } from 'fs/promises';

/**
 * 流式传输媒体文件
 * 支持 HTTP Range 请求，实现拖拽播放和分段传输
 * GET /api/stream/:id
 */
export async function streamMedia(req: Request, res: Response): Promise<void> {
    try {
        const id = req.params.id;
        if (!isString(id) || !isUuid(id)) {
            res.status(404).json({ error: 'media.notFound' });
            return;
        }

        const db = getDatabase();
        const result = await db
            .select({
                id: schema.media.id,
                filePath: schema.media.filePath,
                mimeType: schema.media.mimeType,
                minRole: schema.media.minRole,
                fileName: schema.media.fileName,
                uploaderId: schema.media.uploaderId,
                mediaInfo: schema.media.mediaInfo,
                fileSize: schema.media.fileSize
            })
            .from(schema.media)
            .where(and(eq(schema.media.id, id), req.user?.role !== 'admin' ? isNull(schema.media.deletedAt) : undefined))
            .limit(1)
            .execute();

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

        const filePath = mediaRecord.filePath;

        try { await access(filePath); } catch {
            res.status(404).json({ error: 'media.fileNotFound' });
            return;
        }

        // 首次访问时阻塞 probe（已有 mediaInfo 则跳过）
        let mimeType = mediaRecord.mimeType;
        if (!mediaRecord.mediaInfo) {
            const updated = await updateMediaInfo(id, filePath, mimeType);
            mimeType = updated.mimeType;
        }

        send(req, filePath, {
            etag: false,
            dotfiles: 'deny',
            maxAge: '1y'
        })
            .on('headers', (res) => {
                // mimeType 已在 probe 阶段由 resolveBestMimeType 归一化为浏览器兼容值
                res.setHeader('Content-Type', mediaRecord.mimeType);
                res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
                res.setHeader('X-Content-Type-Options', 'nosniff');
            })
            .on('error', (err) => {
                console.error('[Stream] 发送错误:', err);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'media.streamError' });
                }
            })
            .pipe(res);
    } catch (err) {
        console.error('[Stream] 流媒体传输失败:', err);
        if (!res.headersSent) {
            res.status(500).json({ error: 'media.streamFailed' });
        }
    }
}

/**
 * 下载媒体文件
 * GET /api/stream/:id/download
 */
export async function downloadMedia(req: Request, res: Response): Promise<void> {
    try {
        const id = req.params.id;
        if (!isString(id) || !isUuid(id)) {
            res.status(404).json({ error: 'media.notFound' });
            return;
        }

        const db = getDatabase();
        const result = await db
            .select({
                id: schema.media.id,
                filePath: schema.media.filePath,
                mimeType: schema.media.mimeType,
                minRole: schema.media.minRole,
                fileName: schema.media.fileName,
                uploaderId: schema.media.uploaderId
            })
            .from(schema.media)
            .where(and(eq(schema.media.id, id), req.user?.role !== 'admin' ? isNull(schema.media.deletedAt) : undefined))
            .limit(1)
            .execute();

        const mediaRecord = result[0];

        if (!mediaRecord) {
            res.status(404).json({ error: 'media.notFound' });
            return;
        }

        // 权限检查：与流媒体一致（含 owner 特例，上传者可下载自己的 owner 媒体）
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

        const filePath = mediaRecord.filePath;
        try { await access(filePath); } catch {
            res.status(404).json({ error: 'media.fileNotFound' });
            return;
        }

        const mimeType = mediaRecord.mimeType;

        send(req, filePath, { etag: false, dotfiles: 'deny' })
            .on('headers', (res) => {
                res.setHeader('Content-Type', mimeType);
                res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(mediaRecord.fileName)}"`);
                res.setHeader('Cache-Control', 'no-cache');
            })
            .on('error', (err) => {
                console.error('[Download] 下载错误:', err);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'media.downloadError' });
                }
            })
            .pipe(res);
    } catch (err) {
        console.error('[Download] 下载失败:', err);
        if (!res.headersSent) {
            res.status(500).json({ error: 'media.downloadError' });
        }
    }
}

/**
 * 提供缩略图文件（仅返回已生成的 thumbPath；未生成 → 404，由前端生成兜底）
 * GET /api/stream/:id/thumb
 * 注：服务端缩略图在 updateMedia 时主动生成（SERVER_THUMBNAILS 开启时）
 */
export async function serveThumbnail(req: Request, res: Response): Promise<void> {
    try {
        const id = req.params.id;
        if (!isString(id) || !isUuid(id)) {
            res.status(404).json({ error: 'media.notFound' });
            return;
        }

        const db = getDatabase();
        const result = await db.select({ thumbPath: schema.media.thumbPath, minRole: schema.media.minRole, uploaderId: schema.media.uploaderId }).from(schema.media).where(and(eq(schema.media.id, id), req.user?.role !== 'admin' ? isNull(schema.media.deletedAt) : undefined)).limit(1).execute();

        const mediaRecord = result[0];

        if (!mediaRecord || !mediaRecord.thumbPath) {
            res.status(404).json({ error: 'media.thumbNotFound' });
            return;
        }

        // 权限检查：与流媒体一致，按媒体可见性 minRole 校验（含 owner 特例）
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

        const filePath = mediaRecord.thumbPath;
        try { await access(filePath); } catch {
            res.status(404).json({ error: 'media.fileNotFound' });
            return;
        }

        const mimeType = mime.lookup(filePath) || 'image/jpeg';

        // 缩略图目录为 .thumbnails（隐藏目录），须允许 dotfiles；路径来自内部生成，可信
        send(req, filePath, { etag: false, dotfiles: 'allow', maxAge: '1y' })
            .on('headers', (res) => {
                res.setHeader('Content-Type', mimeType);
                res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            })
            .on('error', (err) => {
                console.error('[Thumbnail] 读取错误:', err);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'media.thumbError' });
                }
            })
            .pipe(res);
    } catch (err) {
        console.error('[Thumbnail] 服务失败:', err);
        if (!res.headersSent) {
            res.status(500).json({ error: 'media.thumbError' });
        }
    }
}
