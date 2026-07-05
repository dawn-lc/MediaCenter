import { Router } from 'express';
import { listAuthors, createAuthor, updateAuthor, deleteAuthor } from '../controllers/authorsController';
import { authenticate, requireAdmin } from '../middleware/auth';

const router = Router();

// 列表可供所有登录用户查看（用于选择作者）
router.get('/', authenticate, listAuthors);

// 创建/更新/删除仅限管理员
router.post('/', authenticate, requireAdmin, createAuthor);
router.put('/:id', authenticate, requireAdmin, updateAuthor);
router.delete('/:id', authenticate, requireAdmin, deleteAuthor);

export default router;
