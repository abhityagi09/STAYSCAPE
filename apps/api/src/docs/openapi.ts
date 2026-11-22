import { z, type ZodType } from 'zod';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  newsletterSubscribeSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  updatePreferencesSchema,
  updateProfileSchema,
  updateUserRolesSchema,
  updateUserStatusSchema,
  verifyEmailSchema,
} from '@stayscape/shared';
import type { Config } from '@/config/env';

const json = (schema: ZodType) => z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });

const body = (schema: ZodType) => ({
  required: true,
  content: { 'application/json': { schema: json(schema) } },
});

const ok = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Success' } } },
});
const err = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
});

const secured = [{ bearerAuth: [] }];
const csrf = [{ refreshCookie: [], csrfHeader: [] }];

const standardErrors = {
  401: err('Unauthenticated'),
  403: err('Forbidden'),
  422: err('Validation error'),
  429: err('Rate limited'),
};

export function buildOpenApiDocument(config: Pick<Config, 'APP_VERSION' | 'API_PUBLIC_URL'>) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'STAYSCAPE API',
      version: config.APP_VERSION,
      description:
        'Phase 1: authentication, users, RBAC, sessions, notifications, audit and health. All responses use the `{ success, data | error }` envelope.',
    },
    servers: [{ url: `${config.API_PUBLIC_URL}/api/v1` }],
    tags: ['Auth', 'Users', 'Admin', 'Notifications', 'Audit', 'Roles', 'Health', 'Newsletter'].map(
      (name) => ({ name }),
    ),
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        refreshCookie: { type: 'apiKey', in: 'cookie', name: 'ss_rt' },
        csrfHeader: {
          type: 'apiKey',
          in: 'header',
          name: 'X-CSRF-Token',
          description: 'Must equal the ss_csrf cookie',
        },
      },
      schemas: {
        Success: {
          type: 'object',
          required: ['success', 'data'],
          properties: { success: { const: true }, data: {} },
        },
        Error: {
          type: 'object',
          required: ['success', 'error'],
          properties: {
            success: { const: false },
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                details: { type: 'object' },
                requestId: { type: 'string' },
              },
            },
          },
        },
      },
    },
    paths: {
      '/auth/register': {
        post: {
          tags: ['Auth'],
          summary: 'Create a customer account and sign in',
          requestBody: body(registerSchema),
          responses: {
            201: ok('Signed in; refresh cookie set'),
            409: err('Email already registered'),
            ...standardErrors,
          },
        },
      },
      '/auth/login': {
        post: {
          tags: ['Auth'],
          summary: 'Sign in with email and password',
          requestBody: body(loginSchema),
          responses: { 200: ok('Signed in; refresh cookie set'), ...standardErrors },
        },
      },
      '/auth/refresh': {
        post: {
          tags: ['Auth'],
          summary: 'Rotate the refresh token and issue a new access token',
          security: csrf,
          responses: { 200: ok('New access token'), ...standardErrors },
        },
      },
      '/auth/logout': {
        post: {
          tags: ['Auth'],
          summary: 'Revoke the current session',
          security: csrf,
          responses: { 200: ok('Signed out'), 403: err('CSRF check failed') },
        },
      },
      '/auth/logout-all': {
        post: {
          tags: ['Auth'],
          summary: 'Revoke every session of the current user',
          security: [{ bearerAuth: [], csrfHeader: [] }],
          responses: { 200: ok('Signed out everywhere'), ...standardErrors },
        },
      },
      '/auth/forgot-password': {
        post: {
          tags: ['Auth'],
          summary: 'Request a password reset email (generic response)',
          requestBody: body(forgotPasswordSchema),
          responses: { 202: ok('Accepted'), ...standardErrors },
        },
      },
      '/auth/reset-password': {
        post: {
          tags: ['Auth'],
          summary: 'Reset a password with a one-time token',
          requestBody: body(resetPasswordSchema),
          responses: {
            200: ok('Password reset'),
            400: err('Invalid or expired token'),
            ...standardErrors,
          },
        },
      },
      '/auth/verify-email': {
        post: {
          tags: ['Auth'],
          summary: 'Verify an email address with a one-time token',
          requestBody: body(verifyEmailSchema),
          responses: { 200: ok('Verified'), 400: err('Invalid or expired token') },
        },
      },
      '/auth/resend-verification': {
        post: {
          tags: ['Auth'],
          summary: 'Resend the verification email (generic response)',
          requestBody: body(resendVerificationSchema),
          responses: { 202: ok('Accepted') },
        },
      },
      '/auth/change-password': {
        post: {
          tags: ['Auth'],
          summary: 'Change password and sign out other sessions',
          security: secured,
          requestBody: body(changePasswordSchema),
          responses: { 200: ok('Changed'), ...standardErrors },
        },
      },
      '/auth/me': {
        get: {
          tags: ['Auth'],
          summary: 'Current user',
          security: secured,
          responses: { 200: ok('Current user'), 401: err('Unauthenticated') },
        },
      },
      '/users/profile': {
        get: {
          tags: ['Users'],
          summary: 'Get own profile',
          security: secured,
          responses: { 200: ok('Profile') },
        },
        patch: {
          tags: ['Users'],
          summary: 'Update own profile',
          security: secured,
          requestBody: body(updateProfileSchema),
          responses: { 200: ok('Updated'), ...standardErrors },
        },
      },
      '/users/preferences': {
        patch: {
          tags: ['Users'],
          summary: 'Update language, currency and notification preferences',
          security: secured,
          requestBody: body(updatePreferencesSchema),
          responses: { 200: ok('Updated'), ...standardErrors },
        },
      },
      '/users/avatar': {
        post: {
          tags: ['Users'],
          summary: 'Upload avatar (JPEG/PNG/WebP, ≤2 MB)',
          security: secured,
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  properties: { avatar: { type: 'string', format: 'binary' } },
                  required: ['avatar'],
                },
              },
            },
          },
          responses: {
            200: ok('Updated'),
            413: err('Too large'),
            415: err('Unsupported type'),
            ...standardErrors,
          },
        },
      },
      '/users/sessions': {
        get: {
          tags: ['Users'],
          summary: 'List active sessions',
          security: secured,
          responses: { 200: ok('Sessions') },
        },
      },
      '/users/sessions/{id}': {
        delete: {
          tags: ['Users'],
          summary: 'Revoke one of your sessions',
          security: secured,
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: { 200: ok('Revoked'), 404: err('Not found') },
        },
      },
      '/users': {
        get: {
          tags: ['Admin'],
          summary: 'List users (users:read)',
          security: secured,
          parameters: ['page', 'limit', 'search', 'role', 'status'].map((name) => ({
            name,
            in: 'query',
            schema: { type: 'string' },
          })),
          responses: { 200: ok('Users'), ...standardErrors },
        },
      },
      '/users/{id}/roles': {
        patch: {
          tags: ['Admin'],
          summary: 'Replace roles (users:manage; privileged roles need SUPER_ADMIN)',
          security: secured,
          requestBody: body(updateUserRolesSchema),
          responses: { 200: ok('Updated'), 404: err('Not found'), ...standardErrors },
        },
      },
      '/users/{id}/status': {
        patch: {
          tags: ['Admin'],
          summary: 'Change account status (users:manage)',
          security: secured,
          requestBody: body(updateUserStatusSchema),
          responses: { 200: ok('Updated'), 404: err('Not found'), ...standardErrors },
        },
      },
      '/notifications': {
        get: {
          tags: ['Notifications'],
          summary: 'List own notifications',
          security: secured,
          responses: { 200: ok('Notifications') },
        },
      },
      '/notifications/unread-count': {
        get: {
          tags: ['Notifications'],
          summary: 'Unread count',
          security: secured,
          responses: { 200: ok('Count') },
        },
      },
      '/notifications/read-all': {
        post: {
          tags: ['Notifications'],
          summary: 'Mark all as read',
          security: secured,
          responses: { 200: ok('Updated') },
        },
      },
      '/notifications/{id}/read': {
        patch: {
          tags: ['Notifications'],
          summary: 'Mark one as read (own only)',
          security: secured,
          responses: { 200: ok('Updated'), 404: err('Not found') },
        },
      },
      '/audit': {
        get: {
          tags: ['Audit'],
          summary: 'Query audit log (audit:read)',
          security: secured,
          responses: { 200: ok('Audit entries'), ...standardErrors },
        },
      },
      '/roles': {
        get: {
          tags: ['Roles'],
          summary: 'Role → permission matrix (users:read)',
          security: secured,
          responses: { 200: ok('Roles') },
        },
      },
      '/permissions/me': {
        get: {
          tags: ['Roles'],
          summary: 'Effective permissions of the caller',
          security: secured,
          responses: { 200: ok('Permissions') },
        },
      },
      '/newsletter/subscriptions': {
        post: {
          tags: ['Newsletter'],
          summary: 'Subscribe to the newsletter',
          requestBody: body(newsletterSubscribeSchema),
          responses: { 201: ok('Subscribed'), ...standardErrors },
        },
      },
      '/health': {
        get: { tags: ['Health'], summary: 'Health summary', responses: { 200: ok('Summary') } },
      },
      '/health/live': {
        get: { tags: ['Health'], summary: 'Liveness probe', responses: { 200: ok('Alive') } },
      },
      '/health/ready': {
        get: {
          tags: ['Health'],
          summary: 'Readiness probe',
          responses: { 200: ok('Ready'), 503: { description: 'A dependency is unavailable' } },
        },
      },
    },
  };
}
