import { Router } from 'express';
import { claimReferralSchema, redeemPointsSchema } from '@stayscape/shared';
import type { Container } from '@/container';
import { sendSuccess } from '@/lib/http';
import { requestContext, requireAuth } from '@/lib/request-context';
import { validate } from '@/middleware/validate';

/** /api/v1/rewards — the signed-in customer's points and referrals. */
export function createRewardsRouter(container: Container): Router {
  const router = Router();
  const { rewards } = container.services;
  router.use(container.authenticate);
  router.get('/loyalty', async (req, res) =>
    sendSuccess(res, await rewards.summary(requireAuth(req).userId)),
  );
  router.post('/loyalty/redeem', validate({ body: redeemPointsSchema }), async (req, res) =>
    sendSuccess(
      res,
      await rewards.redeem(
        requireAuth(req).userId,
        (req.body as { points: number }).points,
        requestContext(req),
      ),
      201,
    ),
  );
  router.get('/referrals', async (req, res) =>
    sendSuccess(res, await rewards.referralSummary(requireAuth(req).userId)),
  );
  router.post('/referrals/claim', validate({ body: claimReferralSchema }), async (req, res) =>
    sendSuccess(
      res,
      await rewards.claim(
        requireAuth(req).userId,
        (req.body as { code: string }).code,
        requestContext(req),
      ),
      201,
    ),
  );
  return router;
}
