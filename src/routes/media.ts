import { Router } from 'express';
import { listMedia, getMedia, refreshStreamToken, createMedia, updateMedia, deleteMedia, restoreMedia } from '../controllers/mediaController';
import { authenticate, requireAuth } from '../middleware/auth';
import upload from '../middleware/upload';

const router = Router();

// 获取媒体列表（根据权限过滤）
router.get('/', authenticate, listMedia);

// 获取单个媒体详情（根据权限过滤）
router.get('/:id', authenticate, getMedia);

// 刷新流媒体签名令牌（前端调用）
router.get('/:id/stream-token', authenticate, refreshStreamToken);

// 上传媒体文件（需登录）
router.post('/', authenticate, requireAuth, upload.single('file'), createMedia);

// 更新媒体元数据（需登录，仅上传者或管理员）
router.put('/:id', authenticate, requireAuth, updateMedia);

// 删除媒体文件（需登录，仅上传者或管理员）
router.delete('/:id', authenticate, requireAuth, deleteMedia);

// 恢复已软删除的媒体（仅管理员）
// 独立路由而非 updateMedia，因为 JSON body prune 中间件会过滤 null 值
router.put('/:id/restore', authenticate, requireAuth, restoreMedia);

export default router;
