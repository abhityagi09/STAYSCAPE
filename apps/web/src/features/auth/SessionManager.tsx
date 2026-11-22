import { useEffect, useRef, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAppDispatch } from '@/app/store';
import { hasSessionCookie, refreshSession, setSessionEvents } from '@/lib/api/client';
import { sessionExpired, signedIn, userUpdated } from './auth-slice';

/**
 * Restores the session on load (via the HttpOnly refresh cookie) and connects the API
 * client's refresh/expiry events to the Redux store.
 */
export function SessionManager({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch();
  const queryClient = useQueryClient();
  const started = useRef(false);

  useEffect(() => {
    setSessionEvents({
      onRefreshed: (session) => dispatch(userUpdated(session.user)),
      onExpired: () => {
        queryClient.clear();
        dispatch(sessionExpired());
      },
    });
  }, [dispatch, queryClient]);

  useEffect(() => {
    if (started.current) return; // React StrictMode runs effects twice in development
    started.current = true;
    if (!hasSessionCookie()) {
      dispatch(sessionExpired()); // anonymous visitor: nothing to restore
      return;
    }
    refreshSession()
      .then((session) => dispatch(signedIn(session.user)))
      .catch(() => dispatch(sessionExpired()));
  }, [dispatch]);

  return children;
}
