import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  hasAllPermissions,
  hasAnyPermission,
  type AuthSessionDto,
  type Permission,
  type UserDto,
} from '@stayscape/shared';
import { useAppDispatch, useAppSelector } from '@/app/store';
import { tokenStore } from '@/lib/api/token-store';
import { authApi } from './api';
import { signedIn, signedOut } from './auth-slice';

export function useAuth() {
  const { status, user, sessionExpired } = useAppSelector((state) => state.auth);
  const can = useCallback(
    (...permissions: Permission[]) => (user ? hasAllPermissions(user.roles, permissions) : false),
    [user],
  );
  const canAny = useCallback(
    (...permissions: Permission[]) => (user ? hasAnyPermission(user.roles, permissions) : false),
    [user],
  );
  return { status, user, sessionExpired, isAuthenticated: status === 'authenticated', can, canAny };
}

/** Store a freshly issued session. */
export function useEstablishSession() {
  const dispatch = useAppDispatch();
  return useCallback(
    (session: AuthSessionDto) => {
      tokenStore.set(session.accessToken);
      dispatch(signedIn(session.user));
    },
    [dispatch],
  );
}

export function useSignOut() {
  const dispatch = useAppDispatch();
  const queryClient = useQueryClient();
  return useCallback(
    async (scope: 'current' | 'all' = 'current') => {
      try {
        if (scope === 'all') await authApi.logoutAll();
        else await authApi.logout();
      } finally {
        // Clear local state even if the network call failed — the user asked to leave.
        tokenStore.clear();
        queryClient.clear();
        dispatch(signedOut());
      }
    },
    [dispatch, queryClient],
  );
}

/** Where to send a user after sign-in when no explicit redirect was requested. */
export function homeFor(user: UserDto): string {
  if (hasAnyPermission(user.roles, ['admin:access'])) return '/admin';
  if (hasAnyPermission(user.roles, ['partner:access'])) return '/partner';
  return '/account';
}
