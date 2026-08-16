import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { getUserPublic } from '../controllers/userController';

const router = Router();

// 公开用户主页（无需登录：用户信息/统计公开；媒体列表按访问者可见性过滤）
router.get('/:id', authenticate, getUserPublic);

export default router;
