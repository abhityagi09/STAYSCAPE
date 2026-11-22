import type { Request, Response } from 'express';
import type {
  ChangePasswordInput,
  ForgotPasswordInput,
  LoginInput,
  RegisterPayload,
  ResendVerificationInput,
  ResetPasswordInput,
  VerifyEmailInput,
} from '@stayscape/shared';
import type { Container } from '@/container';
import { sendMessage, sendSuccess } from '@/lib/http';
import { requestContext, requireAuth } from '@/lib/request-context';
import { clearAuthCookies, readRefreshCookie, setAuthCookies } from './auth.cookies';
import type { AuthResult } from './auth.service';

const GENERIC_RESET_MESSAGE =
  'If an account exists for that email, a password reset link is on its way. Check your inbox.';
const GENERIC_RESEND_MESSAGE =
  'If that email belongs to an unverified account, a new verification link has been sent.';

export function createAuthController(container: Container) {
  const { auth } = container.services;
  const { config } = container;

  const respondWithSession = (res: Response, result: AuthResult, status = 200) => {
    setAuthCookies(res, config, result.refreshToken, result.refreshExpiresAt);
    res.setHeader('Cache-Control', 'no-store');
    return sendSuccess(res, result.session, status);
  };

  return {
    register: async (req: Request, res: Response) => {
      const result = await auth.register(req.body as RegisterPayload, requestContext(req));
      respondWithSession(res, result, 201);
    },

    login: async (req: Request, res: Response) => {
      const result = await auth.login(req.body as LoginInput, requestContext(req));
      respondWithSession(res, result);
    },

    refresh: async (req: Request, res: Response) => {
      try {
        const result = await auth.refresh(readRefreshCookie(req), requestContext(req));
        respondWithSession(res, result);
      } catch (error) {
        clearAuthCookies(res, config);
        throw error;
      }
    },

    logout: async (req: Request, res: Response) => {
      await auth.logout(readRefreshCookie(req), requestContext(req));
      clearAuthCookies(res, config);
      sendMessage(res, 'You have been signed out.');
    },

    logoutAll: async (req: Request, res: Response) => {
      const { userId } = requireAuth(req);
      const revoked = await auth.logoutAll(userId, requestContext(req));
      clearAuthCookies(res, config);
      sendSuccess(res, {
        message: 'You have been signed out of all devices.',
        revokedSessions: revoked,
      });
    },

    forgotPassword: async (req: Request, res: Response) => {
      await auth.forgotPassword((req.body as ForgotPasswordInput).email, requestContext(req));
      sendMessage(res, GENERIC_RESET_MESSAGE, 202);
    },

    resetPassword: async (req: Request, res: Response) => {
      const body = req.body as ResetPasswordInput;
      await auth.resetPassword(body.token, body.password, requestContext(req));
      clearAuthCookies(res, config);
      sendMessage(res, 'Your password has been reset. Sign in with your new password.');
    },

    verifyEmail: async (req: Request, res: Response) => {
      const user = await auth.verifyEmail(
        (req.body as VerifyEmailInput).token,
        requestContext(req),
      );
      sendSuccess(res, { message: 'Your email address is verified.', user });
    },

    resendVerification: async (req: Request, res: Response) => {
      await auth.resendVerification(
        (req.body as ResendVerificationInput).email,
        requestContext(req),
      );
      sendMessage(res, GENERIC_RESEND_MESSAGE, 202);
    },

    changePassword: async (req: Request, res: Response) => {
      const { userId, sessionId } = requireAuth(req);
      await auth.changePassword(
        userId,
        sessionId,
        req.body as ChangePasswordInput,
        requestContext(req),
      );
      sendMessage(res, 'Your password has been changed. Other devices have been signed out.');
    },

    me: async (req: Request, res: Response) => {
      const { userId } = requireAuth(req);
      sendSuccess(res, await auth.me(userId));
    },
  };
}
