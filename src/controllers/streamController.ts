import type { Request, Response } from 'express';
import { eq, and, isNull } from 'drizzle-orm';
import { validate } from 'uuid';
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
        if (!isString(id) || !validate(id)) {
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
        if (!isString(id) || !validate(id)) {
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
                fileName: schema.media.fileName
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

        // 权限检查：resolveStreamUser 中间件已验证签名
        if (!hasMinRole(req.user!.role ?? 'guest', mediaRecord.minRole ?? 'guest')) {
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
 * 提供缩略图文件
 * GET /api/stream/:id/thumb
 */
export async function serveThumbnail(req: Request, res: Response): Promise<void> {
    try {
        const id = req.params.id;
        if (!isString(id) || !validate(id)) {
            res.status(404).json({ error: 'media.notFound' });
            return;
        }

        const db = getDatabase();
        const result = await db.select({ thumbPath: schema.media.thumbPath }).from(schema.media).where(and(eq(schema.media.id, id), req.user?.role !== 'admin' ? isNull(schema.media.deletedAt) : undefined)).limit(1).execute();

        const mediaRecord = result[0];

        if (!mediaRecord || !mediaRecord.thumbPath) {
            res.status(404).json({ error: 'media.thumbNotFound' });
            return;
        }

        // 权限检查：resolveStreamUser 中间件已验证签名
        if (!hasMinRole(req.user!.role ?? 'guest', 'guest')) {
            res.status(403).json({ error: 'media.permissionDenied' });
            return;
        }

        const filePath = mediaRecord.thumbPath;
        try { await access(filePath); } catch {
            res.status(404).json({ error: 'media.fileNotFound' });
            return;
        }

        const mimeType = mime.lookup(filePath) || 'image/jpeg';

        send(req, filePath, { etag: false, dotfiles: 'deny', maxAge: '1y' })
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
