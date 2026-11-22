import { Router, type Request, type Response } from 'express';
import { newsletterSubscribeSchema } from '@stayscape/shared';
import type { Container } from '@/container';
import { sendMessage } from '@/lib/http';
import type { RateLimiters } from '@/middleware/rate-limit';
import { validate } from '@/middleware/validate';
import { NewsletterSubscriptionModel } from './newsletter-subscription.model';

export function createNewsletterRouter(_container: Container, limiters: RateLimiters): Router {
  const router = Router();
  router.post(
    '/subscriptions',
    limiters.auth,
    validate({ body: newsletterSubscribeSchema }),
    async (req: Request, res: Response) => {
      const { email, source } = req.body as { email: string; source: string };
      // Idempotent upsert: repeated subscriptions leave a single record and the same response.
      await NewsletterSubscriptionModel.updateOne(
        { email },
        {
          $set: { status: 'SUBSCRIBED' },
          $setOnInsert: { source, consentedAt: new Date(), ipAddress: req.ip ?? null },
        },
        { upsert: true },
      ).exec();
      sendMessage(res, 'Thanks — you are subscribed to STAYSCAPE travel updates.', 201);
    },
  );
  return router;
}
