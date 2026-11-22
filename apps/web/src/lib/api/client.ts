import axios, {
  type AxiosInstance,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { AUTH_COOKIES, CSRF_HEADER, type ApiSuccess, type AuthSessionDto } from '@stayscape/shared';
import { ApiClientError, normalizeApiError } from './errors';
import { tokenStore } from './token-store';

export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL || '/api/v1';

interface RetriableConfig extends InternalAxiosRequestConfig {
  _retried?: boolean;
}

export interface SessionEvents {
  onRefreshed?: (session: AuthSessionDto) => void;
  onExpired?: () => void;
}

const events: SessionEvents = {};
export function setSessionEvents(handlers: SessionEvents) {
  Object.assign(events, handlers);
}

function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const match = document.cookie.split('; ').find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : undefined;
}

/**
 * The readable CSRF cookie is issued alongside the HttpOnly refresh cookie and shares its
 * lifetime, so its absence means there is no session to restore (no request needed).
 */
export function hasSessionCookie(): boolean {
  return Boolean(readCookie(AUTH_COOKIES.csrfToken));
}

function csrfHeaders(): Record<string, string> {
  const token = readCookie(AUTH_COOKIES.csrfToken);
  return token ? { [CSRF_HEADER]: token } : {};
}

function createInstance(): AxiosInstance {
  return axios.create({
    baseURL: API_BASE_URL,
    withCredentials: true,
    timeout: 20_000,
    headers: { Accept: 'application/json' },
  });
}

/** Main client used by every feature. */
export const http = createInstance();
/** Bare client for the refresh call so it never recurses through the 401 interceptor. */
export const refreshHttp = createInstance();

/** Endpoints where a 401 means "bad credentials/token", not "access token expired". */
const NO_REFRESH =
  /\/auth\/(login|register|refresh|logout|forgot-password|reset-password|verify-email|resend-verification)$/;

let inFlightRefresh: Promise<AuthSessionDto> | null = null;

async function withCrossTabLock<T>(work: () => Promise<T>): Promise<T> {
  // Serialise refreshes across tabs: rotating tokens means two tabs refreshing with the same
  // cookie would trip reuse detection. The second tab waits and then uses the rotated cookie.
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (locks?.request) return locks.request('stayscape-auth-refresh', work) as Promise<T>;
  return work();
}

/**
 * Exchange the refresh cookie for a new access token. Concurrent callers share one request
 * (single-flight), so a burst of 401s triggers exactly one refresh.
 */
export function refreshSession(): Promise<AuthSessionDto> {
  inFlightRefresh ??= withCrossTabLock(async () => {
    const response = await refreshHttp.post<ApiSuccess<AuthSessionDto>>('/auth/refresh', null, {
      headers: csrfHeaders(),
    });
    return response.data.data;
  })
    .then((session) => {
      tokenStore.set(session.accessToken);
      events.onRefreshed?.(session);
      return session;
    })
    .catch((error: unknown) => {
      tokenStore.clear();
      throw normalizeApiError(error);
    })
    .finally(() => {
      inFlightRefresh = null;
    });
  return inFlightRefresh;
}

http.interceptors.request.use((config) => {
  const token = tokenStore.get();
  if (token) config.headers.set('Authorization', `Bearer ${token}`);
  const method = (config.method ?? 'get').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    for (const [key, value] of Object.entries(csrfHeaders())) config.headers.set(key, value);
  }
  return config;
});

http.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    const normalized = normalizeApiError(error);
    const config = (error as { config?: RetriableConfig }).config;
    const shouldRefresh =
      normalized.status === 401 &&
      config &&
      !config._retried &&
      !NO_REFRESH.test(config.url ?? '') &&
      normalized.code !== 'ACCOUNT_SUSPENDED';

    if (!shouldRefresh) throw normalized;

    config._retried = true;
    try {
      const session = await refreshSession();
      config.headers.set('Authorization', `Bearer ${session.accessToken}`);
      return await http.request(config);
    } catch (retryError) {
      const final = normalizeApiError(retryError);
      // Only a failed *refresh* means the session is over; a failed retry is reported as-is.
      if (
        final.status === 401 ||
        final.code.startsWith('REFRESH_TOKEN') ||
        final.code === 'CSRF_INVALID'
      ) {
        tokenStore.clear();
        events.onExpired?.();
        throw new ApiClientError(
          'Your session has expired. Please sign in again.',
          401,
          'TOKEN_EXPIRED',
        );
      }
      throw final;
    }
  },
);

/** Unwrap the `{ success, data }` envelope. */
export async function unwrap<T>(request: Promise<AxiosResponse<ApiSuccess<T>>>): Promise<T> {
  const response = await request;
  return response.data.data;
}
