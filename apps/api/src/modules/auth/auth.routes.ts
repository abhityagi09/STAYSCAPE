import { Router } from 'express';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from '@stayscape/shared';
import type { Container } from '@/container';
import { requireCsrf } from '@/middleware/csrf';
import type { RateLimiters } from '@/middleware/rate-limit';
import { validate } from '@/middleware/validate';
import { createAuthController } from './auth.controller';

export function createAuthRouter(container: Container, limiters: RateLimiters): Router {
  const router = Router();
  const controller = createAuthController(container);
  const csrf = requireCsrf(container.config);
  const { authenticate } = container;

  router.post('/register', limiters.auth, validate({ body: registerSchema }), controller.register);
  router.post('/login', limiters.login, validate({ body: loginSchema }), controller.login);
  // Refresh runs on every page load and needs a 384-bit secret cookie, so it is covered by the
  // global limiter rather than the strict credential limiter (which would lock out heavy users).
  router.post('/refresh', csrf, controller.refresh);
  router.post('/logout', csrf, controller.logout);
  router.post('/logout-all', authenticate, csrf, controller.logoutAll);
  router.post(
    '/forgot-password',
    limiters.auth,
    validate({ body: forgotPasswordSchema }),
    controller.forgotPassword,
  );
  router.post(
    '/reset-password',
    limiters.auth,
    validate({ body: resetPasswordSchema }),
    controller.resetPassword,
  );
  router.post(
    '/verify-email',
    limiters.auth,
    validate({ body: verifyEmailSchema }),
    controller.verifyEmail,
  );
  router.post(
    '/resend-verification',
    limiters.auth,
    validate({ body: resendVerificationSchema }),
    controller.resendVerification,
  );
  router.post(
    '/change-password',
    authenticate,
    limiters.auth,
    validate({ body: changePasswordSchema }),
    controller.changePassword,
  );
  router.get('/me', authenticate, controller.me);

  return router;
}
