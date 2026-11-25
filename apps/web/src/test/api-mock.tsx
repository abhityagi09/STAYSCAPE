import { vi } from 'vitest';
import type { HotelCardDto, ImageDto } from '@stayscape/shared';

type Handler = (
  url: string,
  body?: unknown,
  config?: { params?: Record<string, unknown> },
) => unknown;
export const routes: Array<{ method: string; match: RegExp; handler: Handler }> = [];
export const calls: Array<{ method: string; url: string; body?: unknown }> = [];

export function resetApi() {
  routes.length = 0;
  calls.length = 0;
}

export function on(
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  match: RegExp,
  handler: Handler,
) {
  routes.unshift({ method, match, handler });
}

function respond(method: string) {
  return async (
    url: string,
    bodyOrConfig?: unknown,
    maybeConfig?: { params?: Record<string, unknown> },
  ) => {
    const config = (method === 'get' || method === 'delete' ? bodyOrConfig : maybeConfig) as
      { params?: Record<string, unknown> } | undefined;
    const body = method === 'get' || method === 'delete' ? undefined : bodyOrConfig;
    const query = config?.params
      ? `?${new URLSearchParams(
          Object.entries(config.params)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => [k, String(v)]),
        ).toString()}`
      : '';
    calls.push({ method, url: url + query, body });
    const route = routes.find((r) => r.method === method && r.match.test(url + query));
    if (!route)
      throw Object.assign(new Error(`Unmocked ${method.toUpperCase()} ${url}`), {
        response: {
          status: 404,
          data: { success: false, error: { code: 'NOT_FOUND', message: 'Not mocked' } },
        },
      });
    const result = await route.handler(url + query, body, config);
    if (result instanceof Error) throw result;
    return { data: { success: true, data: result } };
  };
}

/** Use inside vi.mock('@/lib/api/client', () => apiClientMock()). */
export function apiClientMock() {
  return {
    API_BASE_URL: '/api/v1',
    http: {
      get: vi.fn(respond('get')),
      post: vi.fn(respond('post')),
      put: vi.fn(respond('put')),
      patch: vi.fn(respond('patch')),
      delete: vi.fn(respond('delete')),
    },
    refreshHttp: {},
    unwrap: async <T,>(p: Promise<{ data: { data: T } }>) => (await p).data.data,
    refreshSession: vi.fn(),
    setSessionEvents: vi.fn(),
    hasSessionCookie: () => false,
  };
}

export const image = (id: string): ImageDto => ({
  id,
  alt: `Photo ${id}`,
  width: 1600,
  height: 1067,
  dominantColor: '#336655',
  variants: {
    sm: `/m/${id}-sm.webp`,
    md: `/m/${id}-md.webp`,
    lg: `/m/${id}-lg.webp`,
    avif: `/m/${id}.avif`,
  },
});

export function hotelCard(overrides: Partial<HotelCardDto> = {}): HotelCardDto {
  return {
    id: '64b0000000000000000000a1',
    slug: 'lakeview-haveli-udaipur',
    name: 'Lakeview Haveli',
    propertyType: 'BOUTIQUE',
    starCategory: 4,
    city: 'Udaipur',
    state: 'Rajasthan',
    country: 'IN',
    location: { lat: 24.57, lng: 73.68 },
    shortDescription: 'Restored haveli',
    coverImage: image('c1'),
    ratingSummary: { average: 4.6, count: 120, source: 'REVIEWS' },
    amenities: ['wifi', 'pool'],
    featured: false,
    instantConfirmation: true,
    distanceKm: null,
    price: null,
    ...overrides,
  };
}

export const paginated = (items: unknown[], extra: Record<string, unknown> = {}) => ({
  items,
  pagination: { page: 1, limit: 12, total: items.length, totalPages: 1 },
  availabilityChecked: false,
  nights: null,
  ...extra,
});
