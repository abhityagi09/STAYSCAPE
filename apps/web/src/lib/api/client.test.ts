import {
  AxiosError,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, refreshHttp, refreshSession, setSessionEvents } from './client';
import { ApiClientError, normalizeApiError } from './errors';
import { tokenStore } from './token-store';

const ok = (config: InternalAxiosRequestConfig, data: unknown, status = 200): AxiosResponse => ({
  data,
  status,
  statusText: 'OK',
  headers: {},
  config,
});

const fail = (config: InternalAxiosRequestConfig, status: number, code: string, message = 'nope') =>
  new AxiosError(
    message,
    String(status),
    config,
    {},
    ok(config, { success: false, error: { code, message, requestId: 'req-1' } }, status),
  );

const session = (token: string) => ({
  success: true,
  data: {
    accessToken: token,
    expiresIn: 900,
    user: { id: 'u1', email: 'a@b.co', roles: ['CUSTOMER'] },
  },
});

describe('API client token refresh', () => {
  const originalHttp = http.defaults.adapter;
  const originalRefresh = refreshHttp.defaults.adapter;

  beforeEach(() => {
    tokenStore.set('expired-token');
    document.cookie = 'ss_csrf=csrf-value; path=/';
  });
  afterEach(() => {
    http.defaults.adapter = originalHttp;
    refreshHttp.defaults.adapter = originalRefresh;
    tokenStore.clear();
    setSessionEvents({ onExpired: undefined, onRefreshed: undefined });
  });

  it('refreshes exactly once for concurrent 401s and retries every request', async () => {
    const refreshAdapter = vi.fn<AxiosAdapter>(async (config) => {
      expect(config.headers.get('x-csrf-token')).toBe('csrf-value');
      await new Promise((resolve) => setTimeout(resolve, 10));
      return ok(config, session('fresh-token'));
    });
    refreshHttp.defaults.adapter = refreshAdapter;
    http.defaults.adapter = async (config) => {
      const auth = config.headers.get('Authorization');
      if (auth === 'Bearer fresh-token') return ok(config, { success: true, data: config.url });
      throw fail(config, 401, 'TOKEN_EXPIRED');
    };

    const results = await Promise.all([http.get('/a'), http.get('/b'), http.get('/c')]);
    expect(results.map((r) => r.data.data)).toEqual(['/a', '/b', '/c']);
    expect(refreshAdapter).toHaveBeenCalledTimes(1);
    expect(tokenStore.get()).toBe('fresh-token');
  });

  it('ends the session when the refresh token is rejected', async () => {
    const onExpired = vi.fn();
    setSessionEvents({ onExpired });
    refreshHttp.defaults.adapter = async (config) => {
      throw fail(config, 401, 'REFRESH_TOKEN_REUSED');
    };
    http.defaults.adapter = async (config) => {
      throw fail(config, 401, 'TOKEN_EXPIRED');
    };

    await expect(http.get('/users/profile')).rejects.toMatchObject({
      status: 401,
      code: 'TOKEN_EXPIRED',
    });
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(tokenStore.get()).toBeNull();
  });

  it('does not attempt a refresh for credential endpoints', async () => {
    const refreshAdapter = vi.fn<AxiosAdapter>();
    refreshHttp.defaults.adapter = refreshAdapter;
    http.defaults.adapter = async (config) => {
      throw fail(config, 401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    };
    await expect(http.post('/auth/login', {})).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
      message: 'Email or password is incorrect.',
    });
    expect(refreshAdapter).not.toHaveBeenCalled();
  });

  it('shares one in-flight refresh between direct callers', async () => {
    const refreshAdapter = vi.fn<AxiosAdapter>(async (config) => ok(config, session('t2')));
    refreshHttp.defaults.adapter = refreshAdapter;
    const [a, b] = await Promise.all([refreshSession(), refreshSession()]);
    expect(a.accessToken).toBe('t2');
    expect(b).toBe(a);
    expect(refreshAdapter).toHaveBeenCalledTimes(1);
  });

  it('never sends the access token to the refresh endpoint', async () => {
    refreshHttp.defaults.adapter = async (config) => {
      expect(config.headers.get('Authorization')).toBeUndefined();
      return ok(config, session('t3'));
    };
    await refreshSession();
  });
});

describe('error normalisation', () => {
  it('maps API envelopes, network failures and timeouts', () => {
    const config = { headers: {} } as InternalAxiosRequestConfig;
    const apiError = normalizeApiError(
      new AxiosError(
        'x',
        '422',
        config,
        {},
        ok(
          config,
          {
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid',
              details: { fieldErrors: { email: ['Bad email'] } },
              requestId: 'r',
            },
          },
          422,
        ),
      ),
    );
    expect(apiError).toBeInstanceOf(ApiClientError);
    expect(apiError.firstFieldError('email')).toBe('Bad email');
    expect(apiError.requestId).toBe('r');

    const network = normalizeApiError(new AxiosError('Network Error', 'ERR_NETWORK', config));
    expect(network.code).toBe('NETWORK_ERROR');
    expect(network.isNetworkError).toBe(true);

    const timeout = normalizeApiError(new AxiosError('timeout', 'ECONNABORTED', config));
    expect(timeout.code).toBe('TIMEOUT');

    const html500 = normalizeApiError(
      new AxiosError('x', '502', config, {}, ok(config, '<html>Bad gateway</html>', 502)),
    );
    expect(html500.code).toBe('SERVICE_UNAVAILABLE');
    expect(html500.message).not.toContain('<html>');
  });
});
