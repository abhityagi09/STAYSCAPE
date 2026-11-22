import { createBrowserRouter, type RouteObject } from 'react-router';
import { RedirectIfAuthenticated, RequireAuth } from '@/features/auth/guards';
import { AuthLayout } from '@/layouts/AuthLayout';
import { PublicLayout } from '@/layouts/PublicLayout';
import NotFoundPage, { ForbiddenPage, RouteErrorPage } from '@/pages/StatusPages';

/** Route-based code splitting: each screen group is its own chunk. */
const lazy =
  <M,>(load: () => Promise<M>, pick: (module: M) => React.ComponentType) =>
  async () => ({ Component: pick(await load()) });

const auth = () => import('@/features/auth/pages/LoginPage');
const account = () => import('@/features/account/pages/AccountPages');
const partner = () => import('@/features/partner/pages/PartnerPages');
const admin = () => import('@/features/admin/pages/AdminPages');
const legal = () => import('@/pages/LegalPages');
const workspaces = () => import('@/layouts/workspaces');

export const routes: RouteObject[] = [
  {
    errorElement: <RouteErrorPage />,
    children: [
      {
        element: <PublicLayout />,
        children: [
          {
            index: true,
            lazy: lazy(
              () => import('@/features/home/HomePage'),
              (m) => m.default,
            ),
          },
          {
            path: 'search',
            lazy: lazy(
              () => import('@/features/home/SearchPage'),
              (m) => m.default,
            ),
          },
          { path: 'partners', lazy: lazy(legal, (m) => m.PartnersLandingPage) },
          { path: 'terms', lazy: lazy(legal, (m) => m.TermsPage) },
          { path: 'privacy', lazy: lazy(legal, (m) => m.PrivacyPage) },
          { path: '403', element: <ForbiddenPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
      {
        element: <AuthLayout />,
        children: [
          {
            element: <RedirectIfAuthenticated />,
            children: [
              { path: 'login', lazy: lazy(auth, (m) => m.default) },
              {
                path: 'register',
                lazy: lazy(
                  () => import('@/features/auth/pages/RegisterPage'),
                  (m) => m.default,
                ),
              },
            ],
          },
          {
            path: 'forgot-password',
            lazy: lazy(
              () => import('@/features/auth/pages/ForgotPasswordPage'),
              (m) => m.default,
            ),
          },
          {
            path: 'reset-password',
            lazy: lazy(
              () => import('@/features/auth/pages/ResetPasswordPage'),
              (m) => m.default,
            ),
          },
          {
            path: 'verify-email',
            lazy: lazy(
              () => import('@/features/auth/pages/VerifyEmailPage'),
              (m) => m.default,
            ),
          },
        ],
      },
      {
        path: 'account',
        element: <RequireAuth />,
        children: [
          {
            lazy: lazy(workspaces, (m) => m.CustomerLayout),
            children: [
              { index: true, lazy: lazy(account, (m) => m.CustomerDashboardPage) },
              { path: 'profile', lazy: lazy(account, (m) => m.ProfilePage) },
              { path: 'preferences', lazy: lazy(account, (m) => m.PreferencesPage) },
              { path: 'security', lazy: lazy(account, (m) => m.SecurityPage) },
              { path: 'notifications', lazy: lazy(account, (m) => m.NotificationsPage) },
            ],
          },
        ],
      },
      {
        path: 'partner',
        element: <RequireAuth />,
        children: [
          {
            lazy: lazy(workspaces, (m) => m.PartnerLayout),
            children: [
              { index: true, lazy: lazy(partner, (m) => m.PartnerDashboardPage) },
              { path: 'onboarding', lazy: lazy(partner, (m) => m.PartnerOnboardingPage) },
            ],
          },
        ],
      },
      {
        path: 'admin',
        element: <RequireAuth permissions={['admin:access']} />,
        children: [
          {
            lazy: lazy(workspaces, (m) => m.AdminLayout),
            children: [
              { index: true, lazy: lazy(admin, (m) => m.AdminDashboardPage) },
              {
                path: 'users',
                element: <RequireAuth permissions={['users:read']} />,
                children: [{ index: true, lazy: lazy(admin, (m) => m.AdminUsersPage) }],
              },
              {
                path: 'audit',
                element: <RequireAuth permissions={['audit:read']} />,
                children: [{ index: true, lazy: lazy(admin, (m) => m.AdminAuditPage) }],
              },
              { path: 'settings', lazy: lazy(admin, (m) => m.AdminSettingsPage) },
            ],
          },
        ],
      },
    ],
  },
];

export function createRouter() {
  return createBrowserRouter(routes);
}
