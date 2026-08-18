/**
 * 路由配置（react-router 7 data router）
 * - 页面 React.lazy 懒加载，按路由自动分包，首屏只加载必要 chunk
 * - App 为布局壳（Navbar / Toaster / ConfirmDialog / Outlet / ScrollRestoration）
 */
import { lazy } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import App from './App';

const HomePage = lazy(() => import('./pages/HomePage'));
const MediaLibraryPage = lazy(() => import('./pages/MediaLibraryPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
// 公开详情页（单数命名，按用途归 public/）
const UserPage = lazy(() => import('./pages/public/UserPage'));
const AuthorPage = lazy(() => import('./pages/public/AuthorPage'));
const PlayerPage = lazy(() => import('./pages/PlayerPage'));
const EditMediaPage = lazy(() => import('./pages/EditMediaPage'));
const UploadPage = lazy(() => import('./pages/UploadPage'));
// 管理页（复数命名，按用途归 admin/）
const AdminPage = lazy(() => import('./pages/admin/AdminPage'));
const TagsPage = lazy(() => import('./pages/admin/TagsPage'));
const AuthorsPage = lazy(() => import('./pages/admin/AuthorsPage'));
const UsersPage = lazy(() => import('./pages/admin/UsersPage'));

export const router = createBrowserRouter([
    {
        path: '/',
        element: <App />,
        children: [
            { index: true, element: <HomePage /> },
            { path: 'library', element: <MediaLibraryPage /> },
            { path: 'profile', element: <ProfilePage /> },
            { path: 'user/:id', element: <UserPage /> },
            { path: 'author/:id', element: <AuthorPage /> },
            { path: 'view/:id', element: <PlayerPage /> },
            { path: 'edit/:id', element: <EditMediaPage /> },
            { path: 'upload', element: <UploadPage /> },
            { path: 'admin', element: <AdminPage /> },
            { path: 'admin/tags', element: <TagsPage /> },
            { path: 'admin/authors', element: <AuthorsPage /> },
            { path: 'admin/users', element: <UsersPage /> }
        ]
    }
]);
