import { Router } from 'express';
import { streamMedia, downloadMedia, serveThumbnail } from '../controllers/streamController';

const router = Router();

// 流式传输媒体（认证由 resolveStreamUser 前置中间件处理）
router.get('/:id', streamMedia);

// 下载媒体文件
router.get('/:id/download', downloadMedia);

// 缩略图文件
router.get('/:id/thumb', serveThumbnail);

export default router;
