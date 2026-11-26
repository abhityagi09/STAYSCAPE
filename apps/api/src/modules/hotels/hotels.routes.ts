import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import {
  IMAGE_MAX_BYTES,
  hotelContentPatchSchema,
  hotelContentSchema,
  hotelDecisionSchema,
  inventoryQuerySchema,
  accessibilityDeclarationSchema,
  accessibilityVerificationSchema,
  inventoryBlockSchema,
  inventoryUpdateSchema,
  listAdminHotelsQuerySchema,
  objectIdSchema,
  pricingRuleSchema,
  quoteRequestSchema,
  ratePlanSchema,
  roomTypeSchema,
  type HotelDecision,
} from '@stayscape/shared';
import type { Container } from '@/container';
import { sendMessage, sendSuccess } from '@/lib/http';
import {
  requestContext,
  requireAuth,
  validatedParams,
  validatedQuery,
} from '@/lib/request-context';
import { validate, validatePatch } from '@/middleware/validate';
import { requirePermission } from '@/modules/permissions/permission.middleware';

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMAGE_MAX_BYTES, files: 1, fields: 2 },
});
const hotelParam = z.object({ hotelId: objectIdSchema });
const sub = (name: string) => hotelParam.extend({ [name]: objectIdSchema });
const createHotelSchema = hotelContentSchema
  .partial()
  .required({ name: true, propertyType: true, city: true });

/** /api/v1/partner/hotels — property, room, rate and inventory management for owners/staff. */
export function createPartnerHotelsRouter(container: Container): Router {
  const router = Router();
  const { hotels, rooms, quotes, inventoryBlocks } = container.services;
  router.use(container.authenticate, requirePermission('partner:access'));
  const hp = (req: Request) => validatedParams<{ hotelId: string }>(req).hotelId;

  router.get('/', async (req, res) =>
    sendSuccess(res, await hotels.listForPartner(requireAuth(req))),
  );
  router.post('/', validate({ body: createHotelSchema }), async (req, res) => {
    sendSuccess(res, await hotels.create(requireAuth(req), req.body, requestContext(req)), 201);
  });
  router.get('/:hotelId', validate({ params: hotelParam }), async (req, res) =>
    sendSuccess(res, await hotels.getForPartner(requireAuth(req), hp(req))),
  );
  router.patch(
    '/:hotelId',
    validate({ params: hotelParam }),
    validatePatch(hotelContentPatchSchema),
    async (req, res) => {
      sendSuccess(
        res,
        await hotels.update(requireAuth(req), hp(req), req.body, requestContext(req)),
      );
    },
  );
  router.post('/:hotelId/submit', validate({ params: hotelParam }), async (req, res) =>
    sendSuccess(res, await hotels.submit(requireAuth(req), hp(req), requestContext(req))),
  );
  router.post('/:hotelId/publish', validate({ params: hotelParam }), async (req, res) =>
    sendSuccess(
      res,
      await hotels.setPublished(requireAuth(req), hp(req), true, requestContext(req)),
    ),
  );
  router.post('/:hotelId/unpublish', validate({ params: hotelParam }), async (req, res) =>
    sendSuccess(
      res,
      await hotels.setPublished(requireAuth(req), hp(req), false, requestContext(req)),
    ),
  );
  router.post('/:hotelId/archive', validate({ params: hotelParam }), async (req, res) =>
    sendSuccess(res, await hotels.archive(requireAuth(req), hp(req), requestContext(req))),
  );

  router.post(
    '/:hotelId/media',
    validate({ params: hotelParam }),
    imageUpload.single('file'),
    async (req: Request, res: Response) => {
      const purpose =
        (req.body as { purpose?: string }).purpose === 'ROOM_IMAGE' ? 'ROOM_IMAGE' : 'HOTEL_IMAGE';
      sendSuccess(res, await hotels.uploadImage(requireAuth(req), hp(req), purpose, req.file), 201);
    },
  );
  router.delete(
    '/:hotelId/media/:mediaId',
    validate({ params: sub('mediaId') }),
    async (req, res) => {
      await hotels.deleteImage(
        requireAuth(req),
        hp(req),
        validatedParams<{ mediaId: string }>(req).mediaId,
        requestContext(req),
      );
      sendMessage(res, 'Photo deleted.');
    },
  );

  router.get('/:hotelId/room-types', validate({ params: hotelParam }), async (req, res) =>
    sendSuccess(
      res,
      await rooms.listRoomTypes(requireAuth(req), hp(req), req.query.includeArchived === 'true'),
    ),
  );
  router.post(
    '/:hotelId/room-types',
    validate({ params: hotelParam, body: roomTypeSchema }),
    async (req, res) => {
      sendSuccess(
        res,
        await rooms.createRoomType(requireAuth(req), hp(req), req.body, requestContext(req)),
        201,
      );
    },
  );
  router.get(
    '/:hotelId/room-types/:roomTypeId',
    validate({ params: sub('roomTypeId') }),
    async (req, res) => {
      sendSuccess(
        res,
        await rooms.getRoomType(
          requireAuth(req),
          hp(req),
          validatedParams<{ roomTypeId: string }>(req).roomTypeId,
        ),
      );
    },
  );
  router.put(
    '/:hotelId/room-types/:roomTypeId',
    validate({ params: sub('roomTypeId'), body: roomTypeSchema }),
    async (req, res) => {
      sendSuccess(
        res,
        await rooms.updateRoomType(
          requireAuth(req),
          hp(req),
          validatedParams<{ roomTypeId: string }>(req).roomTypeId,
          req.body,
          requestContext(req),
        ),
      );
    },
  );
  router.delete(
    '/:hotelId/room-types/:roomTypeId',
    validate({ params: sub('roomTypeId') }),
    async (req, res) => {
      sendSuccess(
        res,
        await rooms.deleteRoomType(
          requireAuth(req),
          hp(req),
          validatedParams<{ roomTypeId: string }>(req).roomTypeId,
          requestContext(req),
        ),
      );
    },
  );

  router.get('/:hotelId/rate-plans', validate({ params: hotelParam }), async (req, res) =>
    sendSuccess(res, await rooms.listRatePlans(requireAuth(req), hp(req))),
  );
  router.post(
    '/:hotelId/rate-plans',
    validate({ params: hotelParam, body: ratePlanSchema }),
    async (req, res) => {
      sendSuccess(
        res,
        await rooms.saveRatePlan(requireAuth(req), hp(req), null, req.body, requestContext(req)),
        201,
      );
    },
  );
  router.put(
    '/:hotelId/rate-plans/:ratePlanId',
    validate({ params: sub('ratePlanId'), body: ratePlanSchema }),
    async (req, res) => {
      sendSuccess(
        res,
        await rooms.saveRatePlan(
          requireAuth(req),
          hp(req),
          validatedParams<{ ratePlanId: string }>(req).ratePlanId,
          req.body,
          requestContext(req),
        ),
      );
    },
  );
  router.delete(
    '/:hotelId/rate-plans/:ratePlanId',
    validate({ params: sub('ratePlanId') }),
    async (req, res) => {
      await rooms.deleteRatePlan(
        requireAuth(req),
        hp(req),
        validatedParams<{ ratePlanId: string }>(req).ratePlanId,
        requestContext(req),
      );
      sendMessage(res, 'Rate plan deleted.');
    },
  );

  router.get('/:hotelId/pricing-rules', validate({ params: hotelParam }), async (req, res) =>
    sendSuccess(res, await rooms.listRules(requireAuth(req), hp(req))),
  );
  router.post(
    '/:hotelId/pricing-rules',
    validate({ params: hotelParam, body: pricingRuleSchema }),
    async (req, res) => {
      sendSuccess(
        res,
        await rooms.saveRule(requireAuth(req), hp(req), null, req.body, requestContext(req)),
        201,
      );
    },
  );
  router.put(
    '/:hotelId/pricing-rules/:ruleId',
    validate({ params: sub('ruleId'), body: pricingRuleSchema }),
    async (req, res) => {
      sendSuccess(
        res,
        await rooms.saveRule(
          requireAuth(req),
          hp(req),
          validatedParams<{ ruleId: string }>(req).ruleId,
          req.body,
          requestContext(req),
        ),
      );
    },
  );
  router.delete(
    '/:hotelId/pricing-rules/:ruleId',
    validate({ params: sub('ruleId') }),
    async (req, res) => {
      await rooms.deleteRule(
        requireAuth(req),
        hp(req),
        validatedParams<{ ruleId: string }>(req).ruleId,
        requestContext(req),
      );
      sendMessage(res, 'Pricing rule deleted.');
    },
  );

  router.get(
    '/:hotelId/inventory',
    validate({ params: hotelParam, query: inventoryQuerySchema }),
    async (req, res) => {
      sendSuccess(res, await rooms.calendar(requireAuth(req), hp(req), validatedQuery(req)));
    },
  );
  router.patch(
    '/:hotelId/inventory',
    validate({ params: hotelParam, body: inventoryUpdateSchema }),
    async (req, res) => {
      sendSuccess(
        res,
        await rooms.updateInventory(requireAuth(req), hp(req), req.body, requestContext(req)),
      );
    },
  );

  // Accessibility declaration (provenance: PARTNER_DECLARED until Stayscape verifies it).
  router.put('/:hotelId/accessibility', validate({ params: hotelParam, body: accessibilityDeclarationSchema }), async (req, res) =>
    sendSuccess(res, await container.services.trust.declareAccessibility(requireAuth(req), hp(req), (req.body as { features: Array<{ code: string; note: string }> }).features, requestContext(req))),
  );

  // Maintenance / renovation / owner-use blocks.
  const blockParams = hotelParam.extend({ blockId: objectIdSchema });
  router.get('/:hotelId/inventory/blocks', validate({ params: hotelParam, query: z.object({ status: z.enum(['ACTIVE', 'RELEASED']).default('ACTIVE') }) }), async (req, res) =>
    sendSuccess(res, await inventoryBlocks.list(requireAuth(req), hp(req), validatedQuery<{ status: 'ACTIVE' }>(req).status)),
  );
  router.post('/:hotelId/inventory/blocks', validate({ params: hotelParam, body: inventoryBlockSchema }), async (req, res) =>
    sendSuccess(res, await inventoryBlocks.create(requireAuth(req), hp(req), req.body, requestContext(req)), 201),
  );
  router.post('/:hotelId/inventory/blocks/:blockId/release', validate({ params: blockParams }), async (req, res) =>
    sendSuccess(res, await inventoryBlocks.release(requireAuth(req), hp(req), validatedParams<{ blockId: string }>(req).blockId, requestContext(req))),
  );

  /** Price preview for the partner's own (possibly unpublished) listing. */
  router.post(
    '/:hotelId/quote-preview',
    validate({ params: hotelParam, body: quoteRequestSchema }),
    async (req, res) => {
      await container.services.partnerAccess.resolveHotel(
        requireAuth(req),
        hp(req),
        'pricing:manage',
      );
      sendSuccess(
        res,
        await quotes.quote({ ...req.body, hotelId: hp(req) }, { allowUnpublished: true }),
      );
    },
  );
  return router;
}

/** /api/v1/admin/hotels — listing review and moderation (hotels:moderate). */
export function createAdminHotelsRouter(container: Container): Router {
  const router = Router();
  const { hotels } = container.services;
  router.use(container.authenticate, requirePermission('hotels:moderate'));
  router.get('/', validate({ query: listAdminHotelsQuerySchema }), async (req, res) =>
    sendSuccess(res, await hotels.listForAdmin(validatedQuery(req))),
  );
  router.post('/:hotelId/accessibility/verify', validate({ params: hotelParam, body: accessibilityVerificationSchema }), async (req, res) =>
    sendSuccess(res, await container.services.trust.verifyAccessibility(requireAuth(req).userId, validatedParams<{ hotelId: string }>(req).hotelId, req.body as { codes: string[]; verified: boolean; evidence: string }, requestContext(req))),
  );
  router.get('/:hotelId', validate({ params: hotelParam }), async (req, res) =>
    sendSuccess(res, await hotels.getForAdmin(validatedParams<{ hotelId: string }>(req).hotelId)),
  );
  router.post(
    '/:hotelId/decision',
    validate({ params: hotelParam, body: hotelDecisionSchema }),
    async (req, res) => {
      sendSuccess(
        res,
        await hotels.decide(
          requireAuth(req),
          validatedParams<{ hotelId: string }>(req).hotelId,
          req.body as HotelDecision,
          requestContext(req),
        ),
      );
    },
  );
  return router;
}
