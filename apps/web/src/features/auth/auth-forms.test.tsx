import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '@/lib/api/errors';
import { makeUser, renderWithProviders } from '@/test/render';
import { authApi } from './api';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';

vi.mock('./api', () => ({
  authApi: {
    login: vi.fn(),
    register: vi.fn(),
    forgotPassword: vi.fn(),
    resetPassword: vi.fn(),
  },
}));

const mocked = vi.mocked(authApi);

beforeEach(() => vi.clearAllMocks());

function loginRoutes() {
  return [
    { path: '/login', element: <LoginPage /> },
    { path: '/account', element: <h1>Account home</h1> },
    { path: '/admin', element: <h1>Admin home</h1> },
    { path: '/account/security', element: <h1>Security page</h1> },
  ];
}

describe('LoginPage', () => {
  it('shows validation messages without calling the API', async () => {
    const user = userEvent.setup();
    renderWithProviders(loginRoutes(), { route: '/login', user: null });
    await user.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Email is required')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Email/)).toHaveAttribute('aria-invalid', 'true');
    expect(mocked.login).not.toHaveBeenCalled();
  });

  it('shows the server error for invalid credentials', async () => {
    mocked.login.mockRejectedValue(
      new ApiClientError('Email or password is incorrect.', 401, 'INVALID_CREDENTIALS'),
    );
    const user = userEvent.setup();
    renderWithProviders(loginRoutes(), { route: '/login', user: null });
    await user.type(await screen.findByLabelText(/^Email/), 'asha@example.com');
    await user.type(screen.getByLabelText(/^Password/), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.');
  });

  it('signs in and follows a safe redirect', async () => {
    mocked.login.mockResolvedValue({ accessToken: 't', expiresIn: 900, user: makeUser() });
    const user = userEvent.setup();
    const { store } = renderWithProviders(loginRoutes(), {
      route: '/login?redirect=/account/security',
      user: null,
    });
    await user.type(await screen.findByLabelText(/^Email/), 'ASHA@example.com ');
    await user.type(screen.getByLabelText(/^Password/), 'Str0ng-Passw0rd');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Security page' })).toBeInTheDocument();
    expect(mocked.login).toHaveBeenCalledWith({
      email: 'asha@example.com',
      password: 'Str0ng-Passw0rd',
    });
    expect(store.getState().auth.status).toBe('authenticated');
  });

  it('ignores open-redirect attempts', async () => {
    mocked.login.mockResolvedValue({ accessToken: 't', expiresIn: 900, user: makeUser() });
    const user = userEvent.setup();
    renderWithProviders(loginRoutes(), { route: '/login?redirect=//evil.example', user: null });
    await user.type(await screen.findByLabelText(/^Email/), 'asha@example.com');
    await user.type(screen.getByLabelText(/^Password/), 'Str0ng-Passw0rd');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Account home' })).toBeInTheDocument();
  });

  it('explains an expired session', async () => {
    renderWithProviders(loginRoutes(), { route: '/login?reason=expired', user: null });
    expect(await screen.findByText(/your session has ended/i)).toBeInTheDocument();
  });
});

describe('RegisterPage', () => {
  const routes = [
    { path: '/register', element: <RegisterPage /> },
    { path: '/account', element: <h1>Account home</h1> },
  ];

  async function fill(
    user: ReturnType<typeof userEvent.setup>,
    overrides: Partial<Record<string, string>> = {},
  ) {
    const values = {
      first: 'Asha',
      last: 'Rao',
      email: 'asha@example.com',
      password: 'Str0ng-Passw0rd',
      confirm: 'Str0ng-Passw0rd',
      ...overrides,
    };
    await user.type(await screen.findByLabelText(/^First name/), values.first);
    await user.type(screen.getByLabelText(/^Last name/), values.last);
    await user.type(screen.getByLabelText(/^Email/), values.email);
    await user.type(screen.getByLabelText(/^Password\*?$/), values.password);
    await user.type(screen.getByLabelText(/^Confirm password/), values.confirm);
  }

  it('validates password confirmation and terms acceptance', async () => {
    const user = userEvent.setup();
    renderWithProviders(routes, { route: '/register', user: null });
    await fill(user, { confirm: 'Different-Passw0rd' });
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument();
    expect(screen.getByText('You must accept the terms to continue')).toBeInTheDocument();
    expect(mocked.register).not.toHaveBeenCalled();
  });

  it('shows live password requirements and strength errors', async () => {
    const user = userEvent.setup();
    renderWithProviders(routes, { route: '/register', user: null });
    await fill(user, { password: 'weakpass', confirm: 'weakpass' });
    expect(screen.getByText(/One uppercase letter/).textContent).toContain('(not met)');
    expect(screen.getByText(/One lowercase letter/).textContent).toContain('(met)');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText(/at least 10 characters/)).toBeInTheDocument();
  });

  it('submits without the confirm field and maps server field errors', async () => {
    mocked.register.mockRejectedValue(
      new ApiClientError('Some fields are invalid.', 409, 'EMAIL_TAKEN', {
        email: ['An account with this email already exists.'],
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(routes, { route: '/register', user: null });
    await fill(user);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(
      await screen.findByText('An account with this email already exists.'),
    ).toBeInTheDocument();
    const payload = mocked.register.mock.calls[0]?.[0];
    expect(payload).not.toHaveProperty('confirmPassword');
    expect(payload).toMatchObject({ email: 'asha@example.com', acceptTerms: true });
  });
});

describe('password reset forms', () => {
  it('forgot password shows the generic confirmation', async () => {
    mocked.forgotPassword.mockResolvedValue({
      message: 'If an account exists for that email, a password reset link is on its way.',
    });
    const user = userEvent.setup();
    renderWithProviders([{ path: '/forgot-password', element: <ForgotPasswordPage /> }], {
      route: '/forgot-password',
      user: null,
    });
    await user.type(await screen.findByLabelText(/^Email/), 'asha@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText(/If an account exists/)).toBeInTheDocument();
  });

  it('reset password rejects a missing token and offers a new link on expiry', async () => {
    renderWithProviders([{ path: '/reset-password', element: <ResetPasswordPage /> }], {
      route: '/reset-password',
      user: null,
    });
    expect(await screen.findByText(/reset link is incomplete/i)).toBeInTheDocument();
  });

  it('reset password surfaces an expired token', async () => {
    mocked.resetPassword.mockRejectedValue(
      new ApiClientError(
        'This reset link is invalid or has expired.',
        400,
        'VERIFICATION_TOKEN_INVALID',
      ),
    );
    const user = userEvent.setup();
    renderWithProviders([{ path: '/reset-password', element: <ResetPasswordPage /> }], {
      route: `/reset-password?token=${'a'.repeat(43)}`,
      user: null,
    });
    await user.type(await screen.findByLabelText(/^New password/), 'Brand-New-Passw0rd');
    await user.type(screen.getByLabelText(/^Confirm new password/), 'Brand-New-Passw0rd');
    await user.click(screen.getByRole('button', { name: 'Update password' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('invalid or has expired'),
    );
    expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });
});
