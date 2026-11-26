import { Router } from 'express';
import { assistantRequestSchema } from '@stayscape/shared';
import type { Container } from '@/container';
import { sendSuccess } from '@/lib/http';
import { requireAuth } from '@/lib/request-context';
import { validate } from '@/middleware/validate';

/** /api/v1/assistant — signed-in users only (quotas are per account). */
export function createAssistantRouter(container: Container): Router {
  const router = Router();
  const { assistant } = container.services;
  router.use(container.authenticate);
  router.post('/messages', validate({ body: assistantRequestSchema }), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const body = req.body as { message: string; history: Array<{ role: 'user' | 'assistant'; content: string }> };
    sendSuccess(res, await assistant.reply({ userId: requireAuth(req).userId, message: body.message, history: body.history }));
  });
  return router;
}
