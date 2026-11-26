import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  createPriceAlertSchema,
  lastMinuteQuerySchema,
  objectIdSchema,
  priceCalendarQuerySchema,
  priceHistoryQuerySchema,
  recommendationsQuerySchema,
} from '@stayscape/shared';
import type { Container } from '@/container';
import { sendMessage, sendSuccess } from '@/lib/http';
import { requireAuth, validatedParams, validatedQuery } from '@/lib/request-context';
import { validate } from '@/middleware/validate';

const idOrSlug = z.object({ idOrSlug: z.string().regex(/^[a-z0-9-]{3,140}$|^[a-f\d]{24}$/i) });
const slug = (req: Request) => validatedParams<{ idOrSlug: string }>(req).idOrSlug;

/** /api/v1/recommendations, /price-intelligence, /price-alerts, /deals */
export function createIntelligenceRouters(container: Container) {
  const { intelligence } = container.services;

  const recommendations = Router();
  recommendations.get(
    '/',
    container.authenticate,
    validate({ query: recommendationsQuerySchema }),
    async (req, res) => {
      res.setHeader('Cache-Control', 'private, no-store');
      sendSuccess(
        res,
        await intelligence.recommendations(
          requireAuth(req).userId,
          validatedQuery<{ limit: number }>(req).limit,
        ),
      );
    },
  );

  const prices = Router();
  prices.get(
    '/:idOrSlug/calendar',
    validate({ params: idOrSlug, query: priceCalendarQuerySchema }),
    async (req, res) =>
      sendSuccess(res, await intelligence.priceCalendar(slug(req), validatedQuery(req))),
  );
  prices.get(
    '/:idOrSlug/history',
    validate({ params: idOrSlug, query: priceHistoryQuerySchema }),
    async (req, res) =>
      sendSuccess(
        res,
        await intelligence.priceHistory(
          slug(req),
          validatedQuery<{ stayDate: string }>(req).stayDate,
        ),
      ),
  );

  const alerts = Router();
  alerts.use(container.authenticate);
  alerts.get('/', async (req, res) =>
    sendSuccess(res, await intelligence.listAlerts(requireAuth(req).userId)),
  );
  alerts.post('/', validate({ body: createPriceAlertSchema }), async (req, res) =>
    sendSuccess(res, await intelligence.createAlert(requireAuth(req).userId, req.body), 201),
  );
  alerts.delete(
    '/:id',
    validate({ params: z.object({ id: objectIdSchema }) }),
    async (req, res) => {
      await intelligence.deleteAlert(
        requireAuth(req).userId,
        validatedParams<{ id: string }>(req).id,
      );
      sendMessage(res, 'Alert removed.');
    },
  );

  const deals = Router();
  deals.get('/last-minute', validate({ query: lastMinuteQuerySchema }), async (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=300');
    sendSuccess(res, await intelligence.lastMinuteDeals(validatedQuery(req)));
  });
  return { recommendations, prices, alerts, deals };
}
