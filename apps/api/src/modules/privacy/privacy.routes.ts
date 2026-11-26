import { Router } from 'express';
import { deleteAccountSchema, type DeleteAccountInput } from '@stayscape/shared';
import type { Container } from '@/container';
import { clearAuthCookies } from '@/modules/auth/auth.cookies';
import { sendMessage, sendSuccess } from '@/lib/http';
import { requestContext, requireAuth } from '@/lib/request-context';
import { validate } from '@/middleware/validate';

/** /api/v1/users/me/(export|deletion) — data-subject rights for the signed-in account. */
export function createPrivacyRouter(container: Container): Router {
  const router = Router();
  const { privacy } = container.services;
  router.use(container.authenticate);

  router.get('/export', async (req, res) => {
    const data = await privacy.exportData(requireAuth(req).userId, requestContext(req));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="stayscape-data-${new Date().toISOString().slice(0, 10)}.json"`,
    );
    sendSuccess(res, data);
  });
  router.get('/deletion', async (req, res) =>
    sendSuccess(res, { blockers: await privacy.deletionBlockers(requireAuth(req).userId) }),
  );
  router.post('/deletion', validate({ body: deleteAccountSchema }), async (req, res) => {
    const body = req.body as DeleteAccountInput;
    await privacy.deleteAccount(requireAuth(req).userId, body.password, requestContext(req));
    clearAuthCookies(res, container.config);
    sendMessage(res, 'Your account has been deleted.');
  });
  return router;
}
