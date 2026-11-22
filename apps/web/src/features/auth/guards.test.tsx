import { act, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useLocation } from 'react-router';
import { makeUser, renderWithProviders } from '@/test/render';
import { sessionExpired } from './auth-slice';
import { RequireAuth } from './guards';

function LoginProbe() {
  const location = useLocation();
  return <p data-testid="login">{`${location.pathname}${location.search}`}</p>;
}

const routes = [
  { path: '/login', element: <LoginProbe /> },
  { path: '/403', element: <h1>Forbidden</h1> },
  {
    path: '/account',
    element: (
      <RequireAuth>
        <h1>Account</h1>
      </RequireAuth>
    ),
  },
  {
    path: '/admin/users',
    element: (
      <RequireAuth permissions={['admin:access', 'users:read']}>
        <h1>Users admin</h1>
      </RequireAuth>
    ),
  },
];

describe('protected routes', () => {
  it('shows a loading state while the session is being restored', () => {
    renderWithProviders(routes, { route: '/account' });
    expect(screen.getByRole('status')).toHaveTextContent('Checking your session');
  });

  it('redirects signed-out visitors to login with a return path', async () => {
    renderWithProviders(routes, { route: '/admin/users?page=2', user: null });
    expect(await screen.findByTestId('login')).toHaveTextContent(
      '/login?redirect=%2Fadmin%2Fusers%3Fpage%3D2',
    );
  });

  it('renders protected content for authorised users', async () => {
    renderWithProviders(routes, { route: '/account', user: makeUser() });
    expect(await screen.findByRole('heading', { name: 'Account' })).toBeInTheDocument();
  });

  it('sends users without the required permissions to 403', async () => {
    renderWithProviders(routes, { route: '/admin/users', user: makeUser({ roles: ['CUSTOMER'] }) });
    expect(await screen.findByRole('heading', { name: 'Forbidden' })).toBeInTheDocument();
  });

  it('allows administrators through', async () => {
    renderWithProviders(routes, { route: '/admin/users', user: makeUser({ roles: ['ADMIN'] }) });
    expect(await screen.findByRole('heading', { name: 'Users admin' })).toBeInTheDocument();
  });

  it('redirects with an expiry reason when the session ends mid-visit', async () => {
    const { store } = renderWithProviders(routes, { route: '/account', user: makeUser() });
    expect(await screen.findByRole('heading', { name: 'Account' })).toBeInTheDocument();
    act(() => {
      store.dispatch(sessionExpired());
    });
    expect(await screen.findByTestId('login')).toHaveTextContent('reason=expired');
  });
});
