import { Router, type Request } from 'express';
import multer from 'multer';
import { Types } from 'mongoose';
import { z } from 'zod';
import {
  DOCUMENT_MAX_BYTES,
  commissionPreviewSchema,
  commissionRuleSchema,
  createSettlementSchema,
  ledgerQuerySchema,
  objectIdSchema,
  pageQuerySchema,
  periodQuerySchema,
  settlementPaymentFieldsSchema,
  settlementReasonSchema,
  settlementsQuerySchema,
  type CommissionRuleInputDto,
} from '@stayscape/shared';
import type { Container } from '@/container';
import { Errors } from '@/lib/errors';
import { sendSuccess } from '@/lib/http';
import { requestContext, requireAuth, validatedParams, validatedQuery } from '@/lib/request-context';
import { validate, zodErrorDetails } from '@/middleware/validate';
import { requirePermission } from '@/modules/permissions/permission.middleware';
import type { LedgerAccount, SettlementStatus } from './finance.models';

const idParam = z.object({ id: objectIdSchema });
const evidenceUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: DOCUMENT_MAX_BYTES, files: 1, fields: 6 } });
const oid = (v: string | undefined) => (v ? new Types.ObjectId(v) : undefined);

export function periodFrom(q: { from?: string | undefined; to?: string | undefined }) {
  const to = q.to ? new Date(q.to) : new Date();
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - 30 * 86_400_000);
  return { from, to };
}

/** /api/v1/partner/finance — the partner's own payables and settlements (owner only: partner-wide data). */
export function createPartnerFinanceRouter(container: Container): Router {
  const router = Router();
  const { finance, partnerAccess } = container.services;
  router.use(container.authenticate);
  const partner = async (req: Request) => (await partnerAccess.requireApprovedOwner(requireAuth(req)))._id;
  router.get('/summary', async (req, res) => sendSuccess(res, await finance.partnerBalance(await partner(req))));
  router.get('/ledger', validate({ query: pageQuerySchema }), async (req, res) => {
    const q = validatedQuery<{ page: number; limit: number }>(req);
    sendSuccess(res, await finance.ledger({ partnerId: await partner(req) }, q.page, q.limit));
  });
  router.get('/settlements', validate({ query: pageQuerySchema }), async (req, res) => {
    const q = validatedQuery<{ page: number; limit: number }>(req);
    sendSuccess(res, await finance.listSettlements({ partnerId: await partner(req) }, q.page, q.limit));
  });
  router.get('/settlements/:id/entries', validate({ params: idParam }), async (req, res) => {
    sendSuccess(res, await finance.settlementEntries(validatedParams<{ id: string }>(req).id, await partner(req)));
  });
  return router;
}

/** /api/v1/admin/(commissions|finance|settlements) */
export function createAdminFinanceRouter(container: Container): Router {
  const router = Router();
  const { finance, media } = container.services;
  router.use(['/commissions', '/finance', '/settlements'], container.authenticate, requirePermission('admin:access'));
  const id = (req: Request) => validatedParams<{ id: string }>(req).id;
  const actor = (req: Request) => requireAuth(req).userId;

  // Commission rules
  router.get('/commissions', requirePermission('payments:read'), async (_req, res) => sendSuccess(res, await finance.listRules()));
  router.post('/commissions', requirePermission('commissions:manage'), validate({ body: commissionRuleSchema }), async (req, res) => {
    sendSuccess(res, await finance.saveRule(actor(req), null, req.body as CommissionRuleInputDto, requestContext(req)), 201);
  });
  router.put('/commissions/:id', requirePermission('commissions:manage'), validate({ params: idParam, body: commissionRuleSchema }), async (req, res) => {
    sendSuccess(res, await finance.saveRule(actor(req), id(req), req.body as CommissionRuleInputDto, requestContext(req)));
  });
  router.post('/commissions/preview', requirePermission('payments:read'), validate({ body: commissionPreviewSchema }), async (req, res) => {
    const body = req.body as z.output<typeof commissionPreviewSchema>;
    sendSuccess(res, await finance.previewCommission(body.partnerId, body.hotelId, body.totals));
  });

  // Ledger & financial summary
  router.get('/finance/ledger', requirePermission('payments:read'), validate({ query: ledgerQuerySchema }), async (req, res) => {
    const q = validatedQuery<{ page: number; limit: number; partnerId?: string; account?: LedgerAccount; from?: string; to?: string }>(req);
    sendSuccess(res, await finance.ledger({ partnerId: oid(q.partnerId), ...(q.account ? { account: q.account } : {}), ...(q.from ? { from: new Date(q.from) } : {}), ...(q.to ? { to: new Date(q.to) } : {}) }, q.page, q.limit));
  });
  router.get('/finance/summary', requirePermission('payments:read'), validate({ query: periodQuerySchema }), async (req, res) => {
    const { from, to } = periodFrom(validatedQuery(req));
    sendSuccess(res, { from: from.toISOString(), to: to.toISOString(), ...(await finance.accountTotals(from, to)) });
  });

  // Settlements
  router.get('/settlements', requirePermission('payments:read'), validate({ query: settlementsQuerySchema }), async (req, res) => {
    const q = validatedQuery<{ page: number; limit: number; partnerId?: string; status?: SettlementStatus }>(req);
    sendSuccess(res, await finance.listSettlements({ ...(q.partnerId ? { partnerId: new Types.ObjectId(q.partnerId) } : {}), ...(q.status ? { status: q.status } : {}) }, q.page, q.limit));
  });
  router.post('/settlements', requirePermission('settlements:manage'), validate({ body: createSettlementSchema }), async (req, res) => {
    sendSuccess(res, await finance.createSettlement(actor(req), (req.body as { partnerId: string }).partnerId, requestContext(req)), 201);
  });
  router.get('/settlements/:id/entries', requirePermission('payments:read'), validate({ params: idParam }), async (req, res) => sendSuccess(res, await finance.settlementEntries(id(req))));
  router.post('/settlements/:id/hold', requirePermission('settlements:manage'), validate({ params: idParam, body: settlementReasonSchema }), async (req, res) => {
    sendSuccess(res, await finance.hold(actor(req), id(req), (req.body as { reason: string }).reason, requestContext(req)));
  });
  router.post('/settlements/:id/release', requirePermission('settlements:manage'), validate({ params: idParam }), async (req, res) => sendSuccess(res, await finance.release(actor(req), id(req), requestContext(req))));
  router.post('/settlements/:id/fail', requirePermission('settlements:manage'), validate({ params: idParam, body: settlementReasonSchema }), async (req, res) => {
    sendSuccess(res, await finance.fail(actor(req), id(req), (req.body as { reason: string }).reason, requestContext(req)));
  });
  router.post('/settlements/:id/initiate-payout', requirePermission('settlements:manage'), validate({ params: idParam }), async (req, res) => {
    sendSuccess(res, await finance.initiatePayout(actor(req), id(req)));
  });
  /** Evidence-backed "paid": multipart fields method, providerReference, paidAt + file (PDF/JPEG/PNG). */
  router.post('/settlements/:id/record-payment', requirePermission('settlements:manage'), validate({ params: idParam }), evidenceUpload.single('file'), async (req, res) => {
    const parsed = settlementPaymentFieldsSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw Errors.validation(zodErrorDetails(parsed.error));
    if (!req.file) throw Errors.validation({ fieldErrors: { file: ['Attach the transfer confirmation'] } });
    const asset = await media.uploadPrivateFile({ uploadedBy: actor(req), purpose: 'SETTLEMENT_EVIDENCE', file: req.file });
    sendSuccess(res, await finance.recordPayment(actor(req), id(req), { ...parsed.data, documentKey: asset._id.toString() }, requestContext(req)));
  });
  return router;
}
