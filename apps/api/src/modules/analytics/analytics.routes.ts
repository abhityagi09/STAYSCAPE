import { Router, type Response } from 'express';
import { analyticsQuerySchema, type AnalyticsQueryDto } from '@stayscape/shared';
import type { Container } from '@/container';
import { sendSuccess } from '@/lib/http';
import { requireAuth, validatedQuery } from '@/lib/request-context';
import { validate } from '@/middleware/validate';
import { requirePermission } from '@/modules/permissions/permission.middleware';
import { toCsv } from './analytics.service';

function sendCsv(res: Response, name: string, rows: Array<Record<string, string | number | null>>) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(toCsv(rows));
}

/** /api/v1/partner/analytics — scoped to properties where the caller holds `analytics:view`. */
export function createPartnerAnalyticsRouter(container: Container): Router {
  const router = Router();
  const { analytics } = container.services;
  router.use(container.authenticate);
  router.get('/', validate({ query: analyticsQuerySchema }), async (req, res) => {
    const q = validatedQuery<AnalyticsQueryDto>(req);
    const data = await analytics.partnerDashboard(requireAuth(req), q);
    if (q.format === 'csv') {
      const rooms = new Map(data.trend.map((t) => [t.date, t]));
      const bookings = new Map(data.bookingTrend.map((b) => [b.date, b]));
      return sendCsv(
        res,
        `stayscape-property-analytics-${data.period.from}-${data.period.to}`,
        [...rooms.values()].map((t) => ({
          date: t.date,
          currency: data.period.currency,
          bookings: bookings.get(t.date)?.bookings ?? 0,
          cancellations: bookings.get(t.date)?.cancellations ?? 0,
          room_nights_sold: t.roomNightsSold,
          available_room_nights: t.availableRoomNights,
          occupancy_percent: (t.occupancyBp / 100).toFixed(2),
          recognised_room_revenue_minor: t.revenueMinor,
        })),
      );
    }
    sendSuccess(res, data);
  });
  return router;
}

/** /api/v1/admin/dashboard and /api/v1/admin/analytics */
export function createAdminAnalyticsRouter(container: Container): Router {
  const router = Router();
  const { analytics } = container.services;
  router.use(container.authenticate);
  router.get('/dashboard', requirePermission('reports:view'), validate({ query: analyticsQuerySchema }), async (req, res) => {
    sendSuccess(res, await analytics.adminDashboard(validatedQuery<AnalyticsQueryDto>(req)));
  });
  router.get('/analytics', requirePermission('analytics:platform'), validate({ query: analyticsQuerySchema }), async (req, res) => {
    const q = validatedQuery<AnalyticsQueryDto>(req);
    const data = await analytics.adminAnalytics(q);
    if (q.format === 'csv') {
      const byDate = new Map<string, Record<string, string | number | null>>();
      const row = (date: string) => {
        if (!byDate.has(date)) byDate.set(date, { date, bookings: 0, gross_booking_value_minor: 0, commission_minor: 0, refunds_minor: 0, new_customers: 0, approved_partners: 0 });
        return byDate.get(date)!;
      };
      for (const b of data.bookingVolume) Object.assign(row(b.date), { bookings: b.bookings, gross_booking_value_minor: b.grossBookingValueMinor });
      for (const c of data.commissionRevenue) row(c.date).commission_minor = c.amountMinor;
      for (const r of data.refunds) row(r.date).refunds_minor = r.amountMinor;
      for (const c of data.customerGrowth) row(c.date).new_customers = c.newCustomers;
      for (const p of data.partnerGrowth) row(p.date).approved_partners = p.approvedPartners;
      return sendCsv(res, `stayscape-platform-analytics-${data.period.from}-${data.period.to}`, [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date))));
    }
    sendSuccess(res, data);
  });
  return router;
}
