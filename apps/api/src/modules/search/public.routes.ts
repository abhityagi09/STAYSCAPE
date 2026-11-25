import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  compareQuerySchema,
  destinationSuggestionQuerySchema,
  nearbyQuerySchema,
  quoteRequestSchema,
  roomOffersQuerySchema,
  searchCriteriaSchema,
  searchQuerySchema,
  type SearchCriteria,
} from '@stayscape/shared';
import type { Container } from '@/container';
import { sendSuccess } from '@/lib/http';
import { validatedParams, validatedQuery } from '@/lib/request-context';
import { validate } from '@/middleware/validate';

const limitQuery = z.object({ limit: z.coerce.number().int().min(1).max(24).default(8) });
const idOrSlug = z.object({
  idOrSlug: z.string().regex(/^[a-z0-9-]{3,140}$|^[a-f\d]{24}$/i, 'Invalid property reference'),
});

/** /api/v1/hotels, /destinations, /amenities, /availability — public discovery. */
export function createPublicRouters(container: Container) {
  const { search, quotes } = container.services;

  const hotels = Router();
  hotels.get('/', validate({ query: searchQuerySchema }), async (req, res) =>
    sendSuccess(res, await search.search(validatedQuery<SearchCriteria>(req))),
  );
  hotels.get('/featured', validate({ query: limitQuery }), async (req, res) =>
    sendSuccess(res, await search.featured(validatedQuery<{ limit: number }>(req).limit)),
  );
  hotels.get('/trending', validate({ query: limitQuery }), async (req, res) =>
    sendSuccess(res, await search.trending(validatedQuery<{ limit: number }>(req).limit)),
  );
  hotels.get('/nearby', validate({ query: nearbyQuerySchema }), async (req, res) =>
    sendSuccess(res, await search.nearby(validatedQuery(req))),
  );
  hotels.get('/compare', validate({ query: compareQuerySchema }), async (req, res) =>
    sendSuccess(res, await search.compare(validatedQuery(req))),
  );
  hotels.get('/:idOrSlug', validate({ params: idOrSlug }), async (req, res) =>
    sendSuccess(res, await search.detail(validatedParams<{ idOrSlug: string }>(req).idOrSlug)),
  );
  hotels.get(
    '/:idOrSlug/offers',
    validate({ params: idOrSlug, query: roomOffersQuerySchema }),
    async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      sendSuccess(
        res,
        await search.roomOffers(
          validatedParams<{ idOrSlug: string }>(req).idOrSlug,
          validatedQuery(req),
        ),
      );
    },
  );
  hotels.get('/:idOrSlug/similar', validate({ params: idOrSlug }), async (req, res) =>
    sendSuccess(res, await search.similar(validatedParams<{ idOrSlug: string }>(req).idOrSlug)),
  );

  const destinations = Router();
  destinations.get('/', async (_req, res) => sendSuccess(res, await search.destinations()));
  destinations.get(
    '/suggestions',
    validate({ query: destinationSuggestionQuerySchema }),
    async (req, res) =>
      sendSuccess(res, await search.suggestions(validatedQuery<{ q: string }>(req).q)),
  );

  const amenities = Router();
  amenities.get('/', async (_req, res) => sendSuccess(res, await search.amenities()));

  const availability = Router();
  availability.post(
    '/search',
    validate({ body: searchCriteriaSchema }),
    async (req: Request, res: Response) => {
      res.setHeader('Cache-Control', 'no-store');
      sendSuccess(res, await search.search(req.body as SearchCriteria));
    },
  );
  availability.post('/quote', validate({ body: quoteRequestSchema }), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    sendSuccess(res, await quotes.quote(req.body));
  });
  availability.post(
    '/quote/revalidate',
    validate({ body: z.strictObject({ quoteToken: z.string().min(10).max(4000) }) }),
    async (req, res) => {
      sendSuccess(res, await quotes.revalidate((req.body as { quoteToken: string }).quoteToken));
    },
  );

  return { hotels, destinations, amenities, availability };
}
