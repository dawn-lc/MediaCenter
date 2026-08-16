import { Router } from 'express';
import { register, login, refreshToken, getProfile, logout, changePassword } from '../controllers/authController';
import { authenticate, requireAuth } from '../middleware/auth';

const router = Router();

// 用户注册（开放）
router.post('/register', register);

// 用户登录（开放）
router.post('/login', login);

// 刷新令牌（开放）
router.post('/refresh', refreshToken);

// 登出：撤销该用户所有 refresh token（需登录）
router.post('/logout', authenticate, requireAuth, logout);

// 获取当前用户信息（需登录）
router.get('/profile', authenticate, requireAuth, getProfile);

// 修改密码：验证旧密码 + 撤销旧会话（需登录）
router.post('/change-password', authenticate, requireAuth, changePassword);

export default router;
