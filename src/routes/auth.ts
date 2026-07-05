import { Router } from 'express';
import { register, login, refreshToken, getProfile } from '../controllers/authController';
import { authenticate, requireAuth } from '../middleware/auth';

const router = Router();

// 用户注册（开放）
router.post('/register', register);

// 用户登录（开放）
router.post('/login', login);

// 刷新令牌（开放）
router.post('/refresh', refreshToken);

// 获取当前用户信息（需登录）
router.get('/profile', authenticate, requireAuth, getProfile);

export default router;
