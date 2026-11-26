import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import type { Permission } from '@stayscape/shared';
import { PageSpinner } from '@/components/ui';
import { homeFor, useAuth } from './use-auth';
import { tr } from '@/lib/tr';

interface RequireAuthProps {
  /** Every listed permission is required. */
  permissions?: Permission[];
  /** At least one listed permission is required. */
  anyPermissions?: Permission[];
  children?: ReactNode;
}

/**
 * Client-side route guard. This is a UX convenience only — the API enforces every
 * permission independently, so bypassing it in the browser reveals no data.
 */
export function RequireAuth({ permissions, anyPermissions, children }: RequireAuthProps) {
  const { status, can, canAny, sessionExpired } = useAuth();
  const location = useLocation();

  if (status === 'initializing') return <PageSpinner label={tr('Checking your session')} />;
  if (status === 'unauthenticated') {
    const params = new URLSearchParams({ redirect: `${location.pathname}${location.search}` });
    if (sessionExpired) params.set('reason', 'expired');
    return <Navigate to={`/login?${params.toString()}`} replace />;
  }
  if (permissions && !can(...permissions)) return <Navigate to="/403" replace />;
  if (anyPermissions && !canAny(...anyPermissions)) return <Navigate to="/403" replace />;
  return children ?? <Outlet />;
}

/** Keeps signed-in users away from the sign-in and registration screens. */
export function RedirectIfAuthenticated({ children }: { children?: ReactNode }) {
  const { status, user } = useAuth();
  const location = useLocation();
  if (status === 'initializing') return <PageSpinner label={tr('Checking your session')} />;
  if (status === 'authenticated' && user) {
    const redirect = new URLSearchParams(location.search).get('redirect');
    return (
      <Navigate
        to={
          redirect && redirect.startsWith('/') && !redirect.startsWith('//')
            ? redirect
            : homeFor(user)
        }
        replace
      />
    );
  }
  return children ?? <Outlet />;
}
