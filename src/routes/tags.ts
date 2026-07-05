import { Router } from 'express';
import { listTags, createTag, updateTag, deleteTag } from '../controllers/tagsController';
import { authenticate, requireAdmin } from '../middleware/auth';

const router = Router();

// 获取所有标签（公开）
router.get('/', authenticate, listTags);

// 创建标签（仅管理员）
router.post('/', authenticate, requireAdmin, createTag);

// 更新标签（仅管理员）
router.put('/:id', authenticate, requireAdmin, updateTag);

// 删除标签（仅管理员）
router.delete('/:id', authenticate, requireAdmin, deleteTag);

export default router;
