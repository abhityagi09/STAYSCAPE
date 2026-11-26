import { createAdminCouponsRouter, createCouponsRouter } from '@/modules/coupons/coupons.routes';
import { createAdminFinanceRouter, createPartnerFinanceRouter } from '@/modules/finance/finance.routes';
import { createAdminAnalyticsRouter, createPartnerAnalyticsRouter } from '@/modules/analytics/analytics.routes';
import { createAdminSupportRouter, createPartnerSupportRouter } from '@/modules/support/support-console.routes';
import { createAdminManagementRouter, createCategoriesRouter } from '@/modules/admin/admin-management.routes';
import { createAdminContentRouter, createPublicContentRouter } from '@/modules/content/content.routes';
import { createIntelligenceRouters } from '@/modules/intelligence/intelligence.routes';
import { scopeMiddleware } from '@/lib/scope';
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { API_PREFIX, REQUEST_ID_HEADER } from '@stayscape/shared';
import type { Container } from '@/container';
import { buildOpenApiDocument } from '@/docs/openapi';
import { LocalStorageProvider } from '@/infrastructure/storage/storage.provider';
import { AppError } from '@/lib/errors';
import { createErrorHandler, notFoundHandler } from '@/middleware/error-handler';
import { createRateLimiters, type RateLimiters } from '@/middleware/rate-limit';
import { requestId } from '@/middleware/request-id';
import { createAuditRouter } from '@/modules/audit/audit.routes';
import { createAuthRouter } from '@/modules/auth/auth.routes';
import { createHealthRouter, type HealthChecks } from '@/modules/health/health.routes';
import { createNewsletterRouter } from '@/modules/newsletter/newsletter.routes';
import { createNotificationsRouter } from '@/modules/notifications/notifications.routes';
import { createPermissionsRouter } from '@/modules/permissions/permissions.routes';
import { createRolesRouter } from '@/modules/roles/roles.routes';
import { createUsersRouter } from '@/modules/users/users.routes';
import { createAdminHotelsRouter, createPartnerHotelsRouter } from '@/modules/hotels/hotels.routes';
import {
  createAdminPartnersRouter,
  createPartnerApplicationRouter,
} from '@/modules/partners/partners.routes';
import { createPublicRouters } from '@/modules/search/public.routes';
import {
  createAccountRouter,
  createBookingsRouter,
  createPaymentWebhookHandler,
  createPublicReviewsHandler,
  createReviewsRouter,
  createSupportRouter,
  createWishlistRouters,
} from '@/modules/bookings/bookings.routes';
import {
  createAdminOperationsRouter,
  createPartnerBookingsRouter,
} from '@/modules/bookings/partner-admin.routes';

export interface AppOptions {
  healthChecks?: Partial<HealthChecks>;
  rateLimiters?: RateLimiters;
}

export function createApp(container: Container, options: AppOptions = {}): Express {
  const { config, logger } = container;
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY);
  app.set('query parser', 'simple');

  app.use(requestId);
  app.use(scopeMiddleware);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).requestId,
      customProps: (req) => ({ requestId: (req as express.Request).requestId }),
      autoLogging: { ignore: (req) => req.url?.startsWith('/health') ?? false },
      serializers: {
        req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // swagger-ui needs inline styles/scripts on the docs page only
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      hsts: config.isProduction ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    }),
  );

  const allowed = new Set(config.corsOrigins);
  app.use(
    cors({
      origin: (origin, callback) => {
        // Same-origin and non-browser requests have no Origin header.
        if (!origin || allowed.has(origin)) return callback(null, true);
        callback(new AppError(403, 'FORBIDDEN', 'Origin not allowed by CORS policy.'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Request-Id'],
      exposedHeaders: [REQUEST_ID_HEADER, 'RateLimit', 'RateLimit-Policy', 'Retry-After'],
      maxAge: 600,
    }),
  );

  // Payment webhooks need the exact raw bytes for signature verification: registered before the
  // JSON parser and outside the rate limiter (authenticated by HMAC signature instead).
  app.post(`${API_PREFIX}/payments/webhooks/razorpay`, ...createPaymentWebhookHandler(container));

  app.use(express.json({ limit: config.REQUEST_BODY_LIMIT }));
  app.use(express.urlencoded({ extended: false, limit: config.REQUEST_BODY_LIMIT }));
  app.use(cookieParser());

  // Health endpoints sit outside the versioned API and the rate limiter (used by orchestrators).
  const health = createHealthRouter(container, options.healthChecks);
  app.use('/health', health);

  const limiters = options.rateLimiters ?? createRateLimiters(config, container.redis);
  const api = express.Router();
  api.use(limiters.global);
  api.use('/health', health);
  api.use('/auth', createAuthRouter(container, limiters));
  api.use('/users', createUsersRouter(container));
  api.use('/roles', createRolesRouter(container));
  api.use('/permissions', createPermissionsRouter(container));
  api.use('/notifications', createNotificationsRouter(container));
  api.use('/audit', createAuditRouter(container));
  api.use('/newsletter', createNewsletterRouter(container, limiters));
  const publicRouters = createPublicRouters(container);
  api.get('/hotels/:idOrSlug/reviews', ...createPublicReviewsHandler(container));
  api.use('/hotels', publicRouters.hotels);
  api.use('/destinations', publicRouters.destinations);
  api.use('/amenities', publicRouters.amenities);
  api.use('/availability', publicRouters.availability);
  const wishlistRouters = createWishlistRouters(container);
  api.use('/wishlist', wishlistRouters.heart);
  api.use('/wishlists', wishlistRouters.lists);
  api.use('/bookings', createBookingsRouter(container));
  api.use('/account', createAccountRouter(container));
  api.use('/reviews', createReviewsRouter(container));
  api.use('/support', createSupportRouter(container));
  api.use('/partner/hotels', createPartnerBookingsRouter(container));
  api.use('/admin', createAdminOperationsRouter(container));
  api.use('/admin', createAdminFinanceRouter(container));
  api.use('/admin', createAdminCouponsRouter(container));
  api.use('/coupons', createCouponsRouter(container));
  api.use('/partner/finance', createPartnerFinanceRouter(container));
  api.use('/partner/analytics', createPartnerAnalyticsRouter(container));
  api.use('/partner/support', createPartnerSupportRouter(container));
  api.use('/admin/support', createAdminSupportRouter(container));
  api.use('/admin', createAdminManagementRouter(container));
  api.use('/categories', createCategoriesRouter(container));
  api.use('/admin/content', createAdminContentRouter(container));
  api.use('/content', createPublicContentRouter(container));
  const intelligenceRouters = createIntelligenceRouters(container);
  api.use('/recommendations', intelligenceRouters.recommendations);
  api.use('/price-intelligence', intelligenceRouters.prices);
  api.use('/price-alerts', intelligenceRouters.alerts);
  api.use('/deals', intelligenceRouters.deals);
  api.use('/admin', createAdminAnalyticsRouter(container));
  api.use('/partner/hotels', createPartnerHotelsRouter(container));
  api.use('/partner', createPartnerApplicationRouter(container, limiters));
  api.use('/admin/partners', createAdminPartnersRouter(container));
  api.use('/admin/hotels', createAdminHotelsRouter(container));

  if (container.storage instanceof LocalStorageProvider) {
    api.use(
      '/media',
      express.static(container.storage.root, {
        fallthrough: false,
        index: false,
        dotfiles: 'deny',
        maxAge: '7d',
        setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
      }),
    );
  }

  if (config.API_DOCS_ENABLED) {
    const document = buildOpenApiDocument(config);
    api.get('/openapi.json', (_req, res) => res.json(document));
    api.use(
      '/docs',
      swaggerUi.serve,
      swaggerUi.setup(document, { customSiteTitle: 'STAYSCAPE API' }),
    );
  }

  app.use(API_PREFIX, api);
  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));
  return app;
}
