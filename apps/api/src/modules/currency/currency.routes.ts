import { Router } from 'express';
import { z } from 'zod';
import { CURRENCIES, type CurrencyCode } from '@stayscape/shared';
import type { Container } from '@/container';
import { sendSuccess } from '@/lib/http';
import { validatedQuery } from '@/lib/request-context';
import { validate } from '@/middleware/validate';

/** /api/v1/currency — published reference rates for approximate display conversions. */
export function createCurrencyRouter(container: Container): Router {
  const router = Router();
  const { currency } = container.services;
  router.get('/rates', async (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=900');
    sendSuccess(res, await currency.publicRates());
  });
  router.get('/convert', validate({ query: z.object({ amountMinor: z.coerce.number().int().min(0).max(1e12), from: z.enum(CURRENCIES), to: z.enum(CURRENCIES) }) }), async (req, res) => {
    const q = validatedQuery<{ amountMinor: number; from: CurrencyCode; to: CurrencyCode }>(req);
    sendSuccess(res, { converted: await currency.convert(q.amountMinor, q.from, q.to) });
  });
  return router;
}
