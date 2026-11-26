import { Router, type Request } from 'express';
import multer from 'multer';
import { z } from 'zod';
import {
  CONTENT_LOCALES,
  CONTENT_TYPES,
  IMAGE_MAX_BYTES,
  contentAdminQuerySchema,
  contentPublicQuerySchema,
  createContentSchema,
  objectIdSchema,
  publishContentSchema,
  updateContentSchema,
  type ContentLocale,
  type ContentType,
} from '@stayscape/shared';
import type { Container } from '@/container';
import { sendSuccess } from '@/lib/http';
import { requestContext, requireAuth, validatedParams, validatedQuery } from '@/lib/request-context';
import { validate } from '@/middleware/validate';
import { requirePermission } from '@/modules/permissions/permission.middleware';

const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: IMAGE_MAX_BYTES, files: 1, fields: 2 } });
const idParam = z.object({ id: objectIdSchema });
const id = (req: Request) => validatedParams<{ id: string }>(req).id;
const actor = (req: Request) => requireAuth(req).userId;

/** /api/v1/admin/content — content:manage. */
export function createAdminContentRouter(container: Container): Router {
  const router = Router();
  const { content } = container.services;
  router.use(container.authenticate, requirePermission('content:manage'));
  router.get('/', validate({ query: contentAdminQuerySchema }), async (req, res) => sendSuccess(res, await content.list(validatedQuery(req))));
  router.post('/', validate({ body: createContentSchema }), async (req, res) => sendSuccess(res, await content.create(actor(req), req.body as Parameters<typeof content.create>[1], requestContext(req)), 201));
  router.post('/images', imageUpload.single('file'), async (req, res) => sendSuccess(res, await content.uploadImage(actor(req), req.file), 201));
  router.get('/:id', validate({ params: idParam }), async (req, res) => sendSuccess(res, await content.detail(id(req))));
  router.get('/:id/revisions', validate({ params: idParam }), async (req, res) => sendSuccess(res, await content.revisions(id(req))));
  router.put('/:id', validate({ params: idParam, body: updateContentSchema }), async (req, res) => sendSuccess(res, await content.update(actor(req), id(req), req.body as Parameters<typeof content.update>[2], requestContext(req))));
  router.post('/:id/publish', validate({ params: idParam, body: publishContentSchema }), async (req, res) => sendSuccess(res, await content.publish(actor(req), id(req), req.body as { publishAt: string | null; unpublishAt: string | null }, requestContext(req))));
  router.post('/:id/unpublish', validate({ params: idParam }), async (req, res) => sendSuccess(res, await content.unpublish(actor(req), id(req), requestContext(req))));
  router.post('/:id/archive', validate({ params: idParam }), async (req, res) => sendSuccess(res, await content.archive(actor(req), id(req), true, requestContext(req))));
  router.post('/:id/restore', validate({ params: idParam }), async (req, res) => sendSuccess(res, await content.archive(actor(req), id(req), false, requestContext(req))));
  router.post('/:id/preview', validate({ params: idParam }), async (req, res) => sendSuccess(res, await content.createPreview(actor(req), id(req), requestContext(req)), 201));
  return router;
}

/** /api/v1/content — published content only; schedules are evaluated per request. */
export function createPublicContentRouter(container: Container): Router {
  const router = Router();
  const { content } = container.services;
  router.get('/', validate({ query: contentPublicQuerySchema }), async (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=60');
    sendSuccess(res, await content.publicList(validatedQuery(req)));
  });
  router.get('/preview/:token', validate({ params: z.object({ token: z.string().regex(/^[\w-]{40,64}$/) }) }), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    sendSuccess(res, await content.preview(validatedParams<{ token: string }>(req).token));
  });
  router.get(
    '/:type/:slug',
    validate({
      params: z.object({ type: z.string().transform((v) => v.toUpperCase()).pipe(z.enum(CONTENT_TYPES)), slug: z.string().regex(/^[a-z0-9-]{2,100}$/) }),
      query: z.object({ locale: z.enum(CONTENT_LOCALES).default('en') }),
    }),
    async (req, res) => {
      const p = validatedParams<{ type: ContentType; slug: string }>(req);
      res.setHeader('Cache-Control', 'public, max-age=60');
      sendSuccess(res, await content.publicEntry(p.type, p.slug, validatedQuery<{ locale: ContentLocale }>(req).locale));
    },
  );
  return router;
}
