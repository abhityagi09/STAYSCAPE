import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Provider } from 'react-redux';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';
import type { UserDto } from '@stayscape/shared';
import { createStore } from '@/app/store';
import { ToastProvider } from '@/components/ui';
import { sessionExpired, signedIn } from '@/features/auth/auth-slice';

export function makeUser(overrides: Partial<UserDto> = {}): UserDto {
  return {
    id: '64b000000000000000000001',
    firstName: 'Asha',
    lastName: 'Rao',
    email: 'asha@example.com',
    phone: null,
    avatarUrl: null,
    roles: ['CUSTOMER'],
    permissions: ['bookings:create', 'bookings:read-own'],
    accountStatus: 'ACTIVE',
    emailVerified: true,
    emailVerifiedAt: new Date().toISOString(),
    phoneVerifiedAt: null,
    preferences: {
      language: 'en',
      currency: 'INR',
      notifications: {
        emailBookingUpdates: true,
        emailPromotions: false,
        emailSecurityAlerts: true,
        smsBookingUpdates: false,
        pushEnabled: false,
      },
    },
    lastLoginAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Render routes with real providers; `user: null` means a signed-out visitor. */
export function renderWithProviders(
  ui: ReactElement | RouteObject[],
  options: { user?: UserDto | null; route?: string } = {},
) {
  const store = createStore();
  if (options.user) store.dispatch(signedIn(options.user));
  else if (options.user === null) store.dispatch(sessionExpired());
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const routes: RouteObject[] = Array.isArray(ui) ? ui : [{ path: '*', element: ui }];
  const router = createMemoryRouter(routes, { initialEntries: [options.route ?? '/'] });
  const result = render(
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </QueryClientProvider>
    </Provider>,
  );
  return { ...result, store, router, queryClient };
}
