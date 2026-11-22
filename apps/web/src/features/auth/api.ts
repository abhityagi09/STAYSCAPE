import type {
  AuthSessionDto,
  ChangePasswordInput,
  ForgotPasswordInput,
  LoginInput,
  MessageDto,
  RegisterInput,
  ResetPasswordInput,
  UserDto,
} from '@stayscape/shared';
import { http, unwrap } from '@/lib/api/client';

export const authApi = {
  register: (input: RegisterInput) => unwrap<AuthSessionDto>(http.post('/auth/register', input)),
  login: (input: LoginInput) => unwrap<AuthSessionDto>(http.post('/auth/login', input)),
  logout: () => unwrap<MessageDto>(http.post('/auth/logout')),
  logoutAll: () => unwrap<MessageDto & { revokedSessions: number }>(http.post('/auth/logout-all')),
  me: (signal?: AbortSignal) => unwrap<UserDto>(http.get('/auth/me', { signal })),
  forgotPassword: (input: ForgotPasswordInput) =>
    unwrap<MessageDto>(http.post('/auth/forgot-password', input)),
  resetPassword: (input: ResetPasswordInput) =>
    unwrap<MessageDto>(http.post('/auth/reset-password', input)),
  verifyEmail: (token: string) =>
    unwrap<MessageDto & { user: UserDto }>(http.post('/auth/verify-email', { token })),
  resendVerification: (email: string) =>
    unwrap<MessageDto>(http.post('/auth/resend-verification', { email })),
  changePassword: (input: ChangePasswordInput) =>
    unwrap<MessageDto>(http.post('/auth/change-password', input)),
};
