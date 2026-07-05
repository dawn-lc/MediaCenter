import { Link, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { changeLanguage, LANGUAGES } from '../i18n';
import { toast } from 'sonner';
import { Api } from '../api';
import Modal from './Modal';
import { useClickOutside } from '../hooks/useClickOutside';
import { TOAST_DURATION, STORAGE_PREFIX } from '../config';

export default function Navbar() {
    const { t, i18n } = useTranslation();
    const { user, isLoggedIn, isAdmin, logout } = useAuthStore();
    const location = useLocation();
    const [showLogin, setShowLogin] = useState(false);
    const [loginUser, setLoginUser] = useState('');
    const [loginPass, setLoginPass] = useState('');
    const [isRegister, setIsRegister] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [userMenuOpen, setUserMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const userMenuRef = useRef<HTMLDivElement>(null);

    useClickOutside(userMenuRef, () => setUserMenuOpen(false), userMenuOpen);

    // 路由变化时关闭移动端菜单
    useEffect(() => {
        setMenuOpen(false);
    }, [location]);

    // 点击外部关闭菜单（排除汉堡按钮本身）
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            const toggle = document.querySelector('.navbar-toggle');
            if (!menuRef.current || !menuOpen) return;
            if (toggle && toggle.contains(e.target as Node)) return;
            if (!menuRef.current.contains(e.target as Node)) {
                setMenuOpen(false);
            }
        };
        document.addEventListener('click', handler);
        return () => document.removeEventListener('click', handler);
    }, [menuOpen]);

    const isActive = (path: string) => (location.pathname === path ? 'active' : '');

    const handleAuth = async (e: React.SyntheticEvent<HTMLFormElement>) => {
        e.preventDefault();
        try {
            if (isRegister) {
                const data = await Api.register(loginUser, loginPass);
                localStorage.setItem(STORAGE_PREFIX + 'auth', data.token);
                useAuthStore.setState({
                    user: data.user,
                    token: data.token,
                    isLoggedIn: true,
                    isAdmin: data.user.role === 'admin',
                    ready: true
                });
            } else {
                await useAuthStore.getState().login(loginUser, loginPass);
            }
            setShowLogin(false);
            setLoginUser('');
            setLoginPass('');
            toast.success(isRegister ? t('auth.registerSuccess') : t('auth.loginSuccess'), {
                position: 'top-center'
            });
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : t('auth.loginFailed'), {
                duration: TOAST_DURATION,
                position: 'top-center'
            });
        }
    };

    return (
        <>
            <nav className="navbar">
                <Link to="/" className="navbar-brand">
                    <div className="brand-icon">▶</div>
                    {t('nav.brand')}
                </Link>
                {/* 汉堡菜单按钮 */}
                <button className={`navbar-toggle ${menuOpen ? 'open' : ''}`} onClick={() => setMenuOpen((v) => !v)} aria-label="Toggle navigation menu">
                    <span></span>
                    <span></span>
                    <span></span>
                </button>
                <div className={`navbar-menu ${menuOpen ? 'open' : ''}`} ref={menuRef}>
                    <div className="navbar-nav">
                        <Link to="/" className={`nav-link ${isActive('/')}`}>
                            {t('nav.mediaLib')}
                        </Link>
                        {isAdmin && (
                            <>
                                <Link
                                    to="/admin"
                                    className={`nav-link ${isActive('/admin') && !location.pathname.startsWith('/admin/tags') && !location.pathname.startsWith('/admin/authors') && !location.pathname.startsWith('/admin/users') ? 'active' : ''}`}
                                >
                                    {t('nav.admin')}
                                </Link>
                                <Link to="/admin/tags" className={`nav-link ${isActive('/admin/tags')}`}>
                                    {t('nav.tags')}
                                </Link>
                                <Link to="/admin/authors" className={`nav-link ${isActive('/admin/authors')}`}>
                                    {t('nav.authors')}
                                </Link>
                                <Link to="/admin/users" className={`nav-link ${isActive('/admin/users')}`}>
                                    {t('nav.users')}
                                </Link>
                            </>
                        )}
                        {isLoggedIn ? (
                            <>
                                <Link to="/upload" className={`nav-link ${isActive('/upload')}`}>
                                    {t('nav.upload')}
                                </Link>
                                <div className="nav-user-menu" ref={userMenuRef}>
                                    <div className="nav-user-avatar" onClick={() => setUserMenuOpen((v) => !v)}>
                                        {user?.username?.charAt(0).toUpperCase() || '?'}
                                    </div>
                                    <div className={`nav-user-dropdown${userMenuOpen ? ' open' : ''}`}>
                                        <div className="dropdown-header">
                                            {user?.username}
                                            {isAdmin && <span className="dropdown-role-badge">{t('admin.users.adminLabel')}</span>}
                                        </div>
                                        <button className="dropdown-item danger" onClick={() => { setUserMenuOpen(false); logout(); }}>
                                            {t('common.logout')}
                                        </button>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <button className="nav-link nav-link-login" onClick={() => setShowLogin(true)}>
                                {t('common.login')}
                            </button>
                        )}
                        <select
                            className="form-input form-select nav-lang-select"
                            value={i18n.language}
                            onChange={(e) => changeLanguage(e.target.value)}
                        >
                            {LANGUAGES.map((lang) => (
                                <option key={lang.code} value={lang.code}>
                                    {lang.label}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>
            </nav>

            <Modal
                open={showLogin}
                title=""
                onClose={() => setShowLogin(false)}
                footer={
                    <div className="auth-footer">
                        <button className="btn btn-primary" type="submit" form="auth-form">
                            {isRegister ? t('auth.registerBtn') : t('auth.loginBtn')}
                        </button>
                        <button className="btn btn-secondary" type="button" onClick={() => setShowLogin(false)}>
                            {t('common.cancel')}
                        </button>
                    </div>
                }
            >
                <div className="modal-auth-icon">
                    <div className="auth-avatar"></div>
                </div>
                <form id="auth-form" onSubmit={handleAuth}>
                    <div className="form-group">
                        <label>{t('common.username')}</label>
                        <input
                            className="form-input"
                            placeholder={t('common.username')}
                            value={loginUser}
                            onChange={(e) => setLoginUser(e.target.value)}
                            autoFocus
                            required
                        />
                    </div>
                    <div className="form-group">
                        <label>{t('common.password')}</label>
                        <input
                            className="form-input"
                            type="password"
                            placeholder={t('common.password')}
                            value={loginPass}
                            onChange={(e) => setLoginPass(e.target.value)}
                            required
                        />
                    </div>
                </form>
                <div className="modal-auth-toggle">
                    {isRegister ? t('auth.hasAccount') : t('auth.noAccount')}
                    {' '}
                    <a
                        onClick={(e) => {
                            e.preventDefault();
                            setIsRegister(!isRegister);
                        }}
                    >
                        {isRegister ? t('auth.loginNow') : t('auth.registerNow')}
                    </a>
                </div>
            </Modal>
        </>
    );
}
