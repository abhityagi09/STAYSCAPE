import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Download } from 'lucide-react';
import {
  addDays,
  DISCOUNT_RULE_TYPES,
  PROMOTION_STATES,
  todayInTimeZone,
  type AdminPromotionDto,
  type AdminPromotionSummaryDto,
  type PromotionState,
  type AdminReviewDto,
  type AgentTicketDto,
} from '@stayscape/shared';
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Checkbox,
  DataTable,
  EmptyState,
  Input,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  Tabs,
  Textarea,
  useToast,
} from '@/components/ui';
import { useAuth } from '@/features/auth/use-auth';
import { http, unwrap } from '@/lib/api/client';
import { normalizeApiError } from '@/lib/api/errors';
import { RecordPicker } from './RecordPicker';
import { api, downloadCsv, downloadFile, useApiMutation, useApiQuery, type Page } from './api';
import {
  BarChart,
  KpiGrid,
  KpiTile,
  PeriodFilter,
  QueryState,
  SectionCard,
  StatusBadge,
  fmtDate,
  fmtDateTime,
  fmtMoney,
  fmtPct,
} from './components';
import { tr, trf } from '@/lib/tr';

const today = () => todayInTimeZone('Asia/Kolkata');
const rid = (r: { id?: string; _id?: string }) => r.id ?? r._id ?? '';
function useFail() {
  const { toast } = useToast();
  return (title: string) => (e: unknown) =>
    toast({ title, description: normalizeApiError(e).message, variant: 'error' });
}
const SORT_OPTIONS = [
  {
    value: 'newest',
    get label() {
      return tr('Newest first');
    },
  },
  {
    value: 'oldest',
    get label() {
      return tr('Oldest first');
    },
  },
  {
    value: 'amount_desc',
    get label() {
      return tr('Highest amount');
    },
  },
  {
    value: 'amount_asc',
    get label() {
      return tr('Lowest amount');
    },
  },
];
function SortSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select
      label={tr('Sort')}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      options={SORT_OPTIONS}
      containerClassName="w-44"
    />
  );
}
function usePaged() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('newest');
  return {
    page,
    setPage,
    sort,
    setSort: (v: string) => {
      setSort(v);
      setPage(1);
    },
    q,
    setQ: (v: string) => {
      setQ(v);
      setPage(1);
    },
  };
}
function Pager({
  data,
  page,
  setPage,
}: {
  data?: Page<unknown> | undefined;
  page: number;
  setPage: (p: number) => void;
}) {
  return data && data.pagination.totalPages > 1 ? (
    <Pagination page={page} totalPages={data.pagination.totalPages} onPageChange={setPage} />
  ) : null;
}

// ------------------------------------------------------------------ dashboard & reports
interface AdminDashboard {
  period: { from: string; to: string };
  metrics: Record<string, number | null>;
  comparison: Record<string, { previous: number; changeBp: number | null } | null>;
}
const METRICS: Array<[string, string, 'money' | 'count' | 'rating']> = [
  ['totalBookings', 'Bookings', 'count'],
  ['confirmedBookings', 'Confirmed', 'count'],
  ['cancelledBookings', 'Cancelled', 'count'],
  ['grossBookingValueMinor', 'Gross booking value', 'money'],
  ['commissionRevenueMinor', 'Commission revenue', 'money'],
  ['promotionExpenseMinor', 'Promotion expense', 'money'],
  ['refundVolumeMinor', 'Refunds', 'money'],
  ['pendingSettlementsMinor', 'Pending settlements', 'money'],
  ['totalCustomers', 'Active customers', 'count'],
  ['newCustomers', 'New sign-ups', 'count'],
  ['activePartners', 'Active partners', 'count'],
  ['pendingPartnerApprovals', 'Partners awaiting review', 'count'],
  ['publishedProperties', 'Published properties', 'count'],
  ['supportTickets', 'Support tickets', 'count'],
  ['averageReviewRating', 'Average rating', 'rating'],
];

export function AdminPlatformDashboardPage() {
  const [period, setPeriod] = useState({ from: addDays(today(), -30), to: addDays(today(), 1) });
  const q = useApiQuery<AdminDashboard>(['admin', 'dashboard'], '/admin/dashboard', period);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={tr('Platform dashboard')}
        description={tr(
          'Marketplace health for the selected period, compared with the period just before it.',
        )}
      />
      <PeriodFilter value={period} onChange={setPeriod} />
      <QueryState query={q} skeleton={5}>
        <KpiGrid>
          {METRICS.map(([key, label, kind]) => {
            const v = q.data?.metrics[key];
            return (
              <KpiTile
                key={key}
                label={label}
                value={kind === 'money' ? fmtMoney(v ?? null) : (v ?? '—')}
                changeBp={q.data?.comparison[key]?.changeBp}
              />
            );
          })}
        </KpiGrid>
      </QueryState>
    </div>
  );
}

interface AdminAnalytics {
  bookingVolume: Array<{ date: string; bookings: number; grossBookingValueMinor: number }>;
  commissionRevenue: Array<{ date: string; amountMinor: number }>;
  refunds: Array<{ date: string; amountMinor: number; count: number }>;
  customerGrowth: Array<{ date: string; newCustomers: number }>;
  propertyDistribution: {
    byCity: Array<{ label: string; count: number }>;
    byType: Array<{ label: string; count: number }>;
  };
  couponPerformance: Array<{
    code: string;
    redemptions: number;
    released: number;
    discountMinor: number;
  }>;
  supportPerformance: {
    created: number;
    resolved: number;
    averageFirstResponseMinutes: number | null;
    averageResolutionHours: number | null;
  };
}
export function AdminReportsPage() {
  const [period, setPeriod] = useState({ from: addDays(today(), -90), to: addDays(today(), 1) });
  const q = useApiQuery<AdminAnalytics>(['admin', 'analytics'], '/admin/analytics', period);
  const d = q.data;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={tr('Reports & analytics')}
        actions={
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void downloadCsv(
                '/admin/analytics',
                period,
                `stayscape-platform-${period.from}-${period.to}.csv`,
              )
            }
          >
            <Download className="size-4" aria-hidden="true" /> {tr('Export CSV')}
          </Button>
        }
      />
      <PeriodFilter value={period} onChange={setPeriod} />
      <QueryState query={q} skeleton={4}>
        {d && (
          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard title={tr('Bookings')}>
              <BarChart
                title={tr('Bookings per day')}
                data={d.bookingVolume.map((b) => ({ label: b.date, value: b.bookings }))}
              />
            </SectionCard>
            <SectionCard title={tr('Gross booking value')}>
              <BarChart
                title={tr('Gross booking value per day')}
                data={d.bookingVolume.map((b) => ({
                  label: b.date,
                  value: b.grossBookingValueMinor,
                }))}
                format={(v) => fmtMoney(v)}
              />
            </SectionCard>
            <SectionCard title={tr('Commission revenue')}>
              <BarChart
                title={tr('Commission per day')}
                data={d.commissionRevenue.map((c) => ({ label: c.date, value: c.amountMinor }))}
                format={(v) => fmtMoney(v)}
              />
            </SectionCard>
            <SectionCard title={tr('Refunds')}>
              <BarChart
                title={tr('Refunds per day')}
                data={d.refunds.map((r) => ({ label: r.date, value: r.amountMinor }))}
                format={(v) => fmtMoney(v)}
              />
            </SectionCard>
            <SectionCard title={tr('New customers')}>
              <BarChart
                title={tr('New customers per day')}
                data={d.customerGrowth.map((c) => ({ label: c.date, value: c.newCustomers }))}
              />
            </SectionCard>
            <SectionCard title={tr('Properties by city')}>
              <BarChart
                title={tr('Published properties by city')}
                data={d.propertyDistribution.byCity.map((c) => ({
                  label: c.label,
                  value: c.count,
                }))}
              />
            </SectionCard>
            <SectionCard title={tr('Coupons')}>
              <DataTable
                caption={tr('Coupon performance')}
                rows={d.couponPerformance}
                getRowId={(c) => c.code}
                empty={<EmptyState compact title={tr('No coupon use in this period')} />}
                columns={[
                  { id: 'c', header: tr('Code'), cell: (c) => c.code },
                  { id: 'r', header: tr('Redeemed'), cell: (c) => c.redemptions, align: 'right' },
                  { id: 'x', header: tr('Released'), cell: (c) => c.released, align: 'right' },
                  {
                    id: 'd',
                    header: tr('Discount'),
                    cell: (c) => fmtMoney(c.discountMinor),
                    align: 'right',
                  },
                ]}
              />
            </SectionCard>
            <SectionCard title={tr('Support')}>
              <KpiGrid>
                <KpiTile label={tr('Created')} value={d.supportPerformance.created} />
                <KpiTile label={tr('Resolved')} value={d.supportPerformance.resolved} />
                <KpiTile
                  label={tr('First response')}
                  value={
                    d.supportPerformance.averageFirstResponseMinutes === null
                      ? '—'
                      : `${d.supportPerformance.averageFirstResponseMinutes} min`
                  }
                />
                <KpiTile
                  label={tr('Resolution')}
                  value={
                    d.supportPerformance.averageResolutionHours === null
                      ? '—'
                      : `${d.supportPerformance.averageResolutionHours} h`
                  }
                />
              </KpiGrid>
            </SectionCard>
          </div>
        )}
      </QueryState>
    </div>
  );
}

// ------------------------------------------------------------------ customers
interface CustomerRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  roles: string[];
  accountStatus: string;
  createdAt: string;
  lastLoginAt: string | null;
}
export function AdminCustomersPage() {
  const p = usePaged();
  const [open, setOpen] = useState<string | null>(null);
  const list = useApiQuery<Page<CustomerRow>>(['admin', 'customers'], '/admin/customers', {
    page: p.page,
    q: p.q || undefined,
  });
  const detail = useApiQuery<
    CustomerRow & {
      stats: {
        bookings: number;
        tickets: number;
        spend: Array<{ currency: string; amountMinor: number }>;
      };
      recentBookings: Array<{
        reference: string;
        status: string;
        hotel: { name: string };
        checkIn: string;
        totalMinor: number;
        currency: string;
      }>;
    }
  >(['admin', 'customer'], open ? `/admin/customers/${open}` : null);
  const fail = useFail();
  const setStatus = useApiMutation(
    (v: { id: string; status: string }) =>
      api.patch(`/users/${v.id}/status`, {
        status: v.status,
        reason: 'Changed from the customer console',
      }),
    [
      ['admin', 'customers'],
      ['admin', 'customer'],
    ],
  );
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={tr('Customers')}
        description={tr('Search accounts and review their activity. Status changes are audited.')}
      />
      <SearchInput label={tr('Search by name or email')} value={p.q} onValueChange={p.setQ} />
      <DataTable
        caption={tr('Customers')}
        rows={list.data?.items}
        loading={list.isPending}
        error={list.isError ? normalizeApiError(list.error) : null}
        getRowId={(r) => r.id}
        empty={<EmptyState compact title={tr('No matching accounts')} />}
        columns={[
          {
            id: 'n',
            header: tr('Name'),
            cell: (r) => (
              <button
                type="button"
                className="text-left font-medium hover:underline"
                onClick={() => setOpen(r.id)}
              >
                {r.firstName} {r.lastName}
              </button>
            ),
          },
          { id: 'e', header: tr('Email'), cell: (r) => r.email },
          { id: 'r', header: tr('Roles'), cell: (r) => r.roles.join(', ').toLowerCase() },
          { id: 's', header: tr('Status'), cell: (r) => <StatusBadge status={r.accountStatus} /> },
          { id: 'c', header: tr('Joined'), cell: (r) => fmtDate(r.createdAt) },
        ]}
      />
      <Pager data={list.data} page={p.page} setPage={p.setPage} />
      {open && (
        <SectionCard
          title={detail.data ? `${detail.data.firstName} ${detail.data.lastName}` : tr('Customer')}
          actions={
            <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>
              {tr('Close')}
            </Button>
          }
        >
          <QueryState query={detail}>
            {detail.data && (
              <>
                <KpiGrid>
                  <KpiTile label={tr('Bookings')} value={detail.data.stats.bookings} />
                  <KpiTile label={tr('Support tickets')} value={detail.data.stats.tickets} />
                  {detail.data.stats.spend.map((s) => (
                    <KpiTile
                      key={s.currency}
                      label={trf('Spend ({0})', [s.currency])}
                      value={fmtMoney(s.amountMinor, s.currency)}
                    />
                  ))}
                </KpiGrid>
                <ul className="flex flex-col gap-1 text-sm">
                  {detail.data.recentBookings.map((b) => (
                    <li key={b.reference}>
                      {b.reference} · {b.hotel.name} · {b.checkIn} ·{' '}
                      {fmtMoney(b.totalMinor, b.currency)} · <StatusBadge status={b.status} />
                    </li>
                  ))}
                </ul>
                <div className="flex gap-2">
                  {detail.data.accountStatus === 'ACTIVE' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setStatus.mutate(
                          { id: open, status: 'SUSPENDED' },
                          { onError: fail('Could not suspend') },
                        )
                      }
                    >
                      {tr('Suspend account')}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() =>
                        setStatus.mutate(
                          { id: open, status: 'ACTIVE' },
                          { onError: fail('Could not reactivate') },
                        )
                      }
                    >
                      {tr('Reactivate account')}
                    </Button>
                  )}
                </div>
              </>
            )}
          </QueryState>
        </SectionCard>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ catalogue
type CatalogKind = 'amenities' | 'destinations' | 'categories';
const EMPTY: Record<CatalogKind, Record<string, string>> = {
  amenities: { code: '', name: '', category: 'GENERAL', icon: 'sparkles' },
  destinations: {
    name: '',
    slug: '',
    city: '',
    region: '',
    country: 'IN',
    latitude: '',
    longitude: '',
    description: '',
  },
  categories: { code: '', name: '', description: '', propertyTypes: '', amenityCodes: '' },
};
function toBody(kind: CatalogKind, f: Record<string, string>) {
  if (kind === 'destinations')
    return { ...f, latitude: Number(f.latitude), longitude: Number(f.longitude) };
  if (kind === 'categories')
    return {
      ...f,
      propertyTypes: f.propertyTypes
        ? f.propertyTypes
            .split(',')
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean)
        : [],
      amenityCodes: f.amenityCodes
        ? f.amenityCodes
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
    };
  return f;
}
function CatalogTab({ kind }: { kind: CatalogKind }) {
  const [form, setForm] = useState<Record<string, string>>(EMPTY[kind]);
  const [editing, setEditing] = useState<string | null>(null);
  const list = useApiQuery<
    Page<Record<string, unknown> & { id: string; name: string; active: boolean }>
  >(['admin', 'catalog', kind], `/admin/catalog/${kind}`);
  const fail = useFail();
  const key = [['admin', 'catalog', kind]];
  const save = useApiMutation(
    () =>
      editing
        ? api.put(`/admin/catalog/${kind}/${editing}`, toBody(kind, form))
        : api.post(`/admin/catalog/${kind}`, toBody(kind, form)),
    key,
  );
  const remove = useApiMutation((id: string) => api.del(`/admin/catalog/${kind}/${id}`), key);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(undefined, {
      onSuccess: () => {
        setForm(EMPTY[kind]);
        setEditing(null);
      },
      onError: fail('Could not save'),
    });
  };
  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={submit}
        className="flex flex-wrap items-end gap-3 rounded-xl border border-border p-4"
      >
        {Object.keys(EMPTY[kind]).map((f) => (
          <Input
            key={f}
            label={
              f === 'propertyTypes'
                ? tr('Property types (comma separated)')
                : f === 'amenityCodes'
                  ? tr('Amenity codes (comma separated)')
                  : f.replace(/([A-Z])/g, ' $1').replace(/^\w/, (c) => c.toUpperCase())
            }
            value={form[f] ?? ''}
            onChange={(e) => setForm({ ...form, [f]: e.target.value })}
            containerClassName="w-52"
            disabled={Boolean(editing) && (f === 'code' || f === 'slug')}
          />
        ))}
        <Button type="submit" loading={save.isPending}>
          {editing ? tr('Save changes') : tr('Add')}
        </Button>
        {editing && (
          <Button
            variant="ghost"
            onClick={() => {
              setEditing(null);
              setForm(EMPTY[kind]);
            }}
          >
            {tr('Cancel')}
          </Button>
        )}
      </form>
      <DataTable
        caption={trf('Catalogue: {0}', [kind])}
        rows={list.data?.items}
        loading={list.isPending}
        getRowId={(r) => r.id}
        empty={<EmptyState compact title={tr('Nothing here yet')} />}
        columns={[
          { id: 'n', header: tr('Name'), cell: (r) => r.name },
          { id: 'c', header: tr('Code'), cell: (r) => String(r.code ?? r.slug ?? '') },
          {
            id: 'a',
            header: tr('Status'),
            cell: (r) => <StatusBadge status={r.active ? 'ACTIVE' : 'PAUSED'} />,
          },
          {
            id: 'x',
            header: '',
            cell: (r) => (
              <span className="flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditing(r.id);
                    setForm(
                      Object.fromEntries(
                        Object.keys(EMPTY[kind]).map((k) => [
                          k,
                          Array.isArray(r[k])
                            ? (r[k] as string[]).join(', ')
                            : k === 'latitude'
                              ? String(
                                  (r.coordinates as { coordinates: number[] } | undefined)
                                    ?.coordinates[1] ?? '',
                                )
                              : k === 'longitude'
                                ? String(
                                    (r.coordinates as { coordinates: number[] } | undefined)
                                      ?.coordinates[0] ?? '',
                                  )
                                : String(r[k] ?? ''),
                        ]),
                      ),
                    );
                  }}
                >
                  {tr('Edit')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => remove.mutate(r.id, { onError: fail('Could not delete') })}
                >
                  {tr('Delete')}
                </Button>
              </span>
            ),
          },
        ]}
      />
    </div>
  );
}
export function AdminCatalogPage() {
  const [tab, setTab] = useState<CatalogKind>('amenities');
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={tr('Catalogue')}
        description={tr(
          'Amenities, destinations and browse categories. Items in use can be deactivated but not deleted.',
        )}
      />
      <Tabs
        label={tr('Catalogue sections')}
        value={tab}
        onValueChange={(v) => setTab(v as CatalogKind)}
        items={[
          { id: 'amenities', label: tr('Amenities'), content: null },
          { id: 'destinations', label: tr('Destinations'), content: null },
          { id: 'categories', label: tr('Property categories'), content: null },
        ]}
      />
      <CatalogTab key={tab} kind={tab} />
    </div>
  );
}

// ------------------------------------------------------------------ bookings & escalations
interface AdminBooking {
  reference: string;
  status: string;
  paymentStatus: string;
  hotel: { name: string; city: string };
  guestName: string;
  checkIn: string;
  checkOut: string;
  totalMinor: number;
  currency: string;
  escalation: { id: string; priority: string; reason: string } | null;
}
export function AdminBookingsPage() {
  const p = usePaged();
  const [status, setStatus] = useState('');
  const [escalatedOnly, setEscalatedOnly] = useState(false);
  const [reason, setReason] = useState<Record<string, string>>({});
  const list = useApiQuery<Page<AdminBooking>>(['admin', 'bookings'], '/admin/bookings', {
    page: p.page,
    q: p.q || undefined,
    status: status || undefined,
    escalated: escalatedOnly ? 'true' : undefined,
    sort: p.sort,
  });
  const fail = useFail();
  const escalate = useApiMutation(
    (v: { ref: string; reason: string }) =>
      api.post(`/admin/bookings/${v.ref}/escalations`, { reason: v.reason, priority: 'HIGH' }),
    [['admin', 'bookings']],
  );
  const resolve = useApiMutation(
    (v: { id: string; resolution: string }) =>
      api.post(`/admin/escalations/${v.id}/resolve`, { resolution: v.resolution }),
    [['admin', 'bookings']],
  );
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={tr('Bookings & escalations')}
        description={tr(
          'Find any reservation and escalate problems such as overbooking or guest-safety issues.',
        )}
      />
      <div className="flex flex-wrap items-end gap-3">
        <SearchInput
          label={tr('Reference, guest surname, email or property')}
          value={p.q}
          onValueChange={p.setQ}
        />
        <SortSelect value={p.sort} onChange={p.setSort} />
        <Select
          label={tr('Status')}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={[
            '',
            'CONFIRMED',
            'CHECKED_IN',
            'CHECKED_OUT',
            'COMPLETED',
            'CANCELLED',
            'RECONCILIATION_REQUIRED',
          ].map((s) => ({
            value: s,
            label: s ? s.replace(/_/g, ' ').toLowerCase() : 'Any status',
          }))}
          containerClassName="w-56"
        />
        <Checkbox
          label={tr('Open escalations only')}
          checked={escalatedOnly}
          onChange={(e) => setEscalatedOnly(e.target.checked)}
        />
      </div>
      <DataTable
        caption={tr('Bookings')}
        rows={list.data?.items}
        loading={list.isPending}
        error={list.isError ? normalizeApiError(list.error) : null}
        getRowId={(b) => b.reference}
        empty={<EmptyState compact title={tr('No matching bookings')} />}
        columns={[
          {
            id: 'r',
            header: tr('Reference'),
            cell: (b) => <span className="font-mono text-xs">{b.reference}</span>,
          },
          { id: 'h', header: tr('Property'), cell: (b) => `${b.hotel.name}, ${b.hotel.city}` },
          { id: 'g', header: tr('Guest'), cell: (b) => b.guestName },
          { id: 'd', header: tr('Stay'), cell: (b) => `${b.checkIn} → ${b.checkOut}` },
          {
            id: 't',
            header: tr('Total'),
            cell: (b) => fmtMoney(b.totalMinor, b.currency),
            align: 'right',
          },
          { id: 's', header: tr('Status'), cell: (b) => <StatusBadge status={b.status} /> },
          {
            id: 'e',
            header: tr('Escalation'),
            cell: (b) =>
              b.escalation ? (
                <span className="flex flex-col gap-1">
                  <StatusBadge status={b.escalation.priority} />
                  <span className="text-xs">{b.escalation.reason}</span>
                  <span className="flex gap-1">
                    <Input
                      label={tr('Resolution')}
                      hideLabel
                      placeholder={tr('Resolution')}
                      value={reason[b.reference] ?? ''}
                      onChange={(e) => setReason({ ...reason, [b.reference]: e.target.value })}
                      containerClassName="w-40"
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={(reason[b.reference] ?? '').length < 3}
                      onClick={() =>
                        resolve.mutate(
                          { id: b.escalation!.id, resolution: reason[b.reference]! },
                          { onError: fail('Could not resolve') },
                        )
                      }
                    >
                      {tr('Resolve')}
                    </Button>
                  </span>
                </span>
              ) : (
                <span className="flex gap-1">
                  <Input
                    label={tr('Escalation reason')}
                    hideLabel
                    placeholder={tr('Reason')}
                    value={reason[b.reference] ?? ''}
                    onChange={(e) => setReason({ ...reason, [b.reference]: e.target.value })}
                    containerClassName="w-40"
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={(reason[b.reference] ?? '').length < 5}
                    onClick={() =>
                      escalate.mutate(
                        { ref: b.reference, reason: reason[b.reference]! },
                        { onError: fail('Could not escalate') },
                      )
                    }
                  >
                    {tr('Escalate')}
                  </Button>
                </span>
              ),
          },
        ]}
      />
      <Pager data={list.data} page={p.page} setPage={p.setPage} />
    </div>
  );
}

// ------------------------------------------------------------------ payments & refunds
export function AdminPaymentsPage() {
  const p = usePaged();
  const [exceptions, setExceptions] = useState(false);
  const list = useApiQuery<
    Page<{
      id: string;
      bookingReference: string | null;
      provider: string;
      providerOrderId: string;
      providerPaymentId: string | null;
      amountMinor: number;
      refundedMinor: number;
      currency: string;
      status: string;
      failureReason: string | null;
      createdAt: string;
    }>
  >(['admin', 'payments'], '/admin/payments', {
    page: p.page,
    q: p.q || undefined,
    exceptions: exceptions ? 'true' : undefined,
    sort: p.sort,
  });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={tr('Payments')}
        description={tr(
          'Every payment attempt. Exceptions are failed attempts, attempts stuck for over 30 minutes, and captured payments without a confirmed stay.',
        )}
      />
      <div className="flex flex-wrap items-end gap-3">
        <SearchInput
          label={tr('Booking reference or provider id')}
          value={p.q}
          onValueChange={p.setQ}
        />
        <SortSelect value={p.sort} onChange={p.setSort} />
        <Checkbox
          label={tr('Exceptions only')}
          checked={exceptions}
          onChange={(e) => setExceptions(e.target.checked)}
        />
      </div>
      <DataTable
        caption={tr('Payments')}
        rows={list.data?.items}
        loading={list.isPending}
        error={list.isError ? normalizeApiError(list.error) : null}
        getRowId={(x) => x.id}
        empty={<EmptyState compact title={tr('No payments found')} />}
        columns={[
          { id: 'd', header: tr('Created'), cell: (x) => fmtDateTime(x.createdAt) },
          { id: 'b', header: tr('Booking'), cell: (x) => x.bookingReference ?? '—' },
          {
            id: 'p',
            header: tr('Provider'),
            cell: (x) => (
              <span className="font-mono text-xs">
                {x.provider} · {x.providerPaymentId ?? x.providerOrderId}
              </span>
            ),
          },
          {
            id: 'a',
            header: tr('Amount'),
            cell: (x) =>
              `${fmtMoney(x.amountMinor, x.currency)}${x.refundedMinor ? ` (refunded ${fmtMoney(x.refundedMinor, x.currency)})` : ''}`,
            align: 'right',
          },
          {
            id: 's',
            header: tr('Status'),
            cell: (x) => (
              <span className="flex flex-col">
                <StatusBadge status={x.status} />
                {x.failureReason && (
                  <span className="text-xs text-fg-muted">{x.failureReason}</span>
                )}
              </span>
            ),
          },
        ]}
      />
      <Pager data={list.data} page={p.page} setPage={p.setPage} />
    </div>
  );
}

export function AdminRefundsPage() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('newest');
  const list = useApiQuery<
    Page<{
      id: string;
      bookingReference: string | null;
      hotelName: string | null;
      amountMinor: number;
      currency: string;
      reason: string;
      source: string;
      status: string;
      failureReason: string | null;
      requestedAt: string;
    }>
  >(['admin', 'refunds'], '/admin/refunds', { page, status: status || undefined, sort });
  const fail = useFail();
  const retry = useApiMutation(
    (id: string) => api.post(`/admin/refunds/${id}/retry`),
    [['admin', 'refunds']],
  );
  const decide = useApiMutation(
    (v: { id: string; body: object }) => api.post(`/admin/refunds/${v.id}/decision`, v.body),
    [['admin', 'refunds']],
  );
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={tr('Refunds')}
        description={tr(
          'Refund requests and their progress. A refund is shown as succeeded only when the payment provider confirms it.',
        )}
      />
      <Select
        label={tr('Status')}
        value={status}
        onChange={(e) => {
          setStatus(e.target.value);
          setPage(1);
        }}
        options={['', 'REQUESTED', 'APPROVED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'REJECTED'].map(
          (s) => ({ value: s, label: s ? s.toLowerCase() : 'Any status' }),
        )}
        containerClassName="w-56"
      />
      <SortSelect
        value={sort}
        onChange={(v) => {
          setSort(v);
          setPage(1);
        }}
      />
      <DataTable
        caption={tr('Refunds')}
        rows={list.data?.items}
        loading={list.isPending}
        error={list.isError ? normalizeApiError(list.error) : null}
        getRowId={(r) => r.id}
        empty={<EmptyState compact title={tr('No refunds')} />}
        columns={[
          { id: 'd', header: tr('Requested'), cell: (r) => fmtDateTime(r.requestedAt) },
          {
            id: 'b',
            header: tr('Booking'),
            cell: (r) => `${r.bookingReference ?? '—'}${r.hotelName ? ` · ${r.hotelName}` : ''}`,
          },
          { id: 'w', header: tr('Reason'), cell: (r) => r.reason },
          {
            id: 'a',
            header: tr('Amount'),
            cell: (r) => fmtMoney(r.amountMinor, r.currency),
            align: 'right',
          },
          { id: 's', header: tr('Status'), cell: (r) => <StatusBadge status={r.status} /> },
          {
            id: 'x',
            header: '',
            cell: (r) =>
              r.status === 'FAILED' ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => retry.mutate(r.id, { onError: fail('Retry failed') })}
                >
                  {tr('Retry')}
                </Button>
              ) : r.status === 'REQUESTED' ? (
                <span className="flex gap-1">
                  <Button
                    size="sm"
                    onClick={() =>
                      decide.mutate(
                        { id: r.id, body: { decision: 'APPROVE', amountMinor: r.amountMinor } },
                        { onError: fail('Could not approve') },
                      )
                    }
                  >
                    {tr('Approve')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      decide.mutate(
                        {
                          id: r.id,
                          body: {
                            decision: 'REJECT',
                            reason: 'Not eligible under the cancellation policy',
                          },
                        },
                        { onError: fail('Could not reject') },
                      )
                    }
                  >
                    {tr('Reject')}
                  </Button>
                </span>
              ) : null,
          },
        ]}
      />
      <Pager data={list.data} page={page} setPage={setPage} />
    </div>
  );
}

// ------------------------------------------------------------------ commissions
interface Rule {
  _id: string;
  name: string;
  scope: string;
  partnerId: string | null;
  hotelId: string | null;
  rateBasisPoints: number;
  fixedMinor: number;
  base: string;
  includeFees: boolean;
  promotional: boolean;
  exempt: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  active: boolean;
}
export function AdminCommissionsPage() {
  const rules = useApiQuery<Rule[]>(['admin', 'commissions'], '/admin/commissions');
  const [form, setForm] = useState({
    name: '',
    scope: 'GLOBAL',
    partnerId: '',
    hotelId: '',
    percent: '15',
    effectiveFrom: today(),
  });
  const fail = useFail();
  const save = useApiMutation(
    () =>
      api.post('/admin/commissions', {
        name: form.name,
        scope: form.scope,
        partnerId: form.scope === 'PARTNER' ? form.partnerId : null,
        hotelId: form.scope === 'HOTEL' ? form.hotelId : null,
        rateBasisPoints: Math.round(Number(form.percent) * 100),
        effectiveFrom: new Date(`${form.effectiveFrom}T00:00:00Z`).toISOString(),
      }),
    [['admin', 'commissions']],
  );
  const toggle = useApiMutation(
    (r: Rule) =>
      api.put(`/admin/commissions/${r._id}`, {
        name: r.name,
        scope: r.scope,
        partnerId: r.partnerId,
        hotelId: r.hotelId,
        rateBasisPoints: r.rateBasisPoints,
        fixedMinor: r.fixedMinor,
        base: r.base,
        includeFees: r.includeFees,
        promotional: r.promotional,
        exempt: r.exempt,
        effectiveFrom: r.effectiveFrom,
        effectiveTo: r.effectiveTo,
        active: !r.active,
      }),
    [['admin', 'commissions']],
  );
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={tr('Commissions')}
        description={tr(
          'Property rules beat partner rules, which beat the global rule. A booking’s commission is fixed when payment is confirmed and never changes afterwards.',
        )}
      />
      <SectionCard title={tr('New rule')}>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(undefined, { onError: fail('Could not save the rule') });
          }}
        >
          <Input
            label={tr('Name')}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            containerClassName="w-56"
          />
          <Select
            label={tr('Applies to')}
            value={form.scope}
            onChange={(e) => setForm({ ...form, scope: e.target.value })}
            options={[
              { value: 'GLOBAL', label: tr('All properties') },
              { value: 'PARTNER', label: tr('One partner') },
              { value: 'HOTEL', label: tr('One property') },
            ]}
            containerClassName="w-44"
          />
          {form.scope === 'PARTNER' && (
            <RecordPicker
              kind="partner"
              label={tr('Partner')}
              value={form.partnerId}
              onChange={(partnerId) => setForm({ ...form, partnerId })}
            />
          )}
          {form.scope === 'HOTEL' && (
            <RecordPicker
              kind="hotel"
              label={tr('Property')}
              value={form.hotelId}
              onChange={(hotelId) => setForm({ ...form, hotelId })}
            />
          )}
          <Input
            label={tr('Rate (%)')}
            inputMode="decimal"
            value={form.percent}
            onChange={(e) => setForm({ ...form, percent: e.target.value })}
            containerClassName="w-28"
          />
          <Input
            type="date"
            label={tr('Effective from')}
            value={form.effectiveFrom}
            onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
            containerClassName="w-44"
          />
          <Button type="submit" loading={save.isPending} disabled={form.name.length < 3}>
            {tr('Add rule')}
          </Button>
        </form>
      </SectionCard>
      <QueryState query={rules}>
        <DataTable
          caption={tr('Commission rules')}
          rows={rules.data}
          getRowId={(r) => r._id}
          empty={<EmptyState compact title={tr('No rules — the default rate applies')} />}
          columns={[
            { id: 'n', header: tr('Rule'), cell: (r) => r.name },
            { id: 's', header: tr('Scope'), cell: (r) => r.scope.toLowerCase() },
            {
              id: 'r',
              header: tr('Rate'),
              cell: (r) => (r.exempt ? 'Exempt' : fmtPct(r.rateBasisPoints)),
              align: 'right',
            },
            { id: 'f', header: tr('From'), cell: (r) => fmtDate(r.effectiveFrom) },
            {
              id: 'a',
              header: tr('Status'),
              cell: (r) => <StatusBadge status={r.active ? 'ACTIVE' : 'PAUSED'} />,
            },
            {
              id: 'x',
              header: '',
              cell: (r) => (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => toggle.mutate(r, { onError: fail('Could not update') })}
                >
                  {r.active ? tr('Deactivate') : tr('Activate')}
                </Button>
              ),
            },
          ]}
        />
      </QueryState>
    </div>
  );
}

// ------------------------------------------------------------------ settlements
interface SettlementRow {
  _id: string;
  reference: string;
  partnerId: string;
  status: string;
  netPayableMinor: number;
  currency: string;
  entryCount: number;
  createdAt: string;
  holdReason: string | null;
  evidence: { providerReference: string; paidAt: string } | null;
}
function RecordPayment({ s, onDone }: { s: SettlementRow; onDone: () => void }) {
  const [ref, setRef] = useState('');
  const [paidAt, setPaidAt] = useState(today());
  const [file, setFile] = useState<File | null>(null);
  const fail = useFail();
  const submit = useApiMutation(() => {
    const fd = new FormData();
    fd.set('method', 'BANK_TRANSFER');
    fd.set('providerReference', ref);
    fd.set('paidAt', new Date(`${paidAt}T00:00:00Z`).toISOString());
    if (file) fd.set('file', file);
    return unwrap(http.post(`/admin/settlements/${s._id}/record-payment`, fd));
  }, [['admin', 'settlements']]);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit.mutate(undefined, {
          onSuccess: onDone,
          onError: fail('Could not record the payment'),
        });
      }}
    >
      <Input
        label={tr('Transfer reference (UTR)')}
        value={ref}
        onChange={(e) => setRef(e.target.value)}
        containerClassName="w-48"
      />
      <Input
        type="date"
        label={tr('Paid on')}
        value={paidAt}
        onChange={(e) => setPaidAt(e.target.value)}
        containerClassName="w-40"
      />
      <label className="flex flex-col gap-1 text-sm">
        {tr('Transfer confirmation')}
        <input
          type="file"
          accept="application/pdf,image/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </label>
      <Button type="submit" size="sm" disabled={ref.length < 4 || !file} loading={submit.isPending}>
        {tr('Mark paid')}
      </Button>
    </form>
  );
}
export function AdminSettlementsPage() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [partnerId, setPartnerId] = useState('');
  const [paying, setPaying] = useState<string | null>(null);
  const list = useApiQuery<Page<SettlementRow>>(['admin', 'settlements'], '/admin/settlements', {
    page,
    status: status || undefined,
  });
  const fail = useFail();
  const key = [['admin', 'settlements']];
  const create = useApiMutation(() => api.post('/admin/settlements', { partnerId }), key);
  const act = useApiMutation(
    (v: { id: string; action: 'hold' | 'release' | 'fail' }) =>
      api.post(`/admin/settlements/${v.id}/${v.action}`, {
        reason:
          v.action === 'release'
            ? 'Released after review'
            : 'Held for review from the settlements console',
      }),
    key,
  );
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={tr('Settlements')}
        description={tr(
          'Batches of partner payables built from the ledger. Stays become eligible after check-out plus the hold period.',
        )}
      />
      <Alert tone="warning" title={tr('Automated payouts are disabled')}>
        {tr(
          'No payout provider is onboarded. Pay by bank transfer, then record the transfer reference and confirmation document here; a settlement is never marked paid without that evidence.',
        )}
      </Alert>
      <SectionCard title={tr('Create a settlement')}>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(undefined, { onError: fail('Could not create the settlement') });
          }}
        >
          <RecordPicker
            kind="partner"
            label={tr('Partner')}
            value={partnerId}
            onChange={setPartnerId}
          />
          <Button type="submit" loading={create.isPending} disabled={!partnerId}>
            {tr('Create from eligible entries')}
          </Button>
        </form>
      </SectionCard>
      <Select
        label={tr('Status')}
        value={status}
        onChange={(e) => {
          setStatus(e.target.value);
          setPage(1);
        }}
        options={['', 'ELIGIBLE', 'ON_HOLD', 'PROCESSING', 'PAID', 'FAILED'].map((s) => ({
          value: s,
          label: s ? s.replace('_', ' ').toLowerCase() : 'Any status',
        }))}
        containerClassName="w-56"
      />
      <DataTable
        caption={tr('Settlements')}
        rows={list.data?.items}
        loading={list.isPending}
        error={list.isError ? normalizeApiError(list.error) : null}
        getRowId={(s) => s._id}
        empty={<EmptyState compact title={tr('No settlements')} />}
        columns={[
          {
            id: 'r',
            header: tr('Reference'),
            cell: (s) => <span className="font-mono text-xs">{s.reference}</span>,
          },
          { id: 'c', header: tr('Created'), cell: (s) => fmtDate(s.createdAt) },
          { id: 'n', header: tr('Entries'), cell: (s) => s.entryCount, align: 'right' },
          {
            id: 'a',
            header: tr('Net payable'),
            cell: (s) => fmtMoney(s.netPayableMinor, s.currency),
            align: 'right',
          },
          {
            id: 's',
            header: tr('Status'),
            cell: (s) => (
              <span className="flex flex-col">
                <StatusBadge status={s.status} />
                {s.evidence && <span className="text-xs">{s.evidence.providerReference}</span>}
                {s.holdReason && <span className="text-xs text-fg-muted">{s.holdReason}</span>}
              </span>
            ),
          },
          {
            id: 'x',
            header: '',
            cell: (s) => (
              <span className="flex flex-col gap-1">
                <span className="flex gap-1">
                  {s.status === 'ELIGIBLE' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        act.mutate(
                          { id: s._id, action: 'hold' },
                          { onError: fail('Could not hold') },
                        )
                      }
                    >
                      {tr('Hold')}
                    </Button>
                  )}
                  {s.status === 'ON_HOLD' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        act.mutate(
                          { id: s._id, action: 'release' },
                          { onError: fail('Could not release') },
                        )
                      }
                    >
                      {tr('Release')}
                    </Button>
                  )}
                  {['ELIGIBLE', 'PROCESSING', 'ON_HOLD'].includes(s.status) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setPaying(paying === s._id ? null : s._id)}
                    >
                      {tr('Record payment')}
                    </Button>
                  )}
                  {['ELIGIBLE', 'PROCESSING', 'ON_HOLD'].includes(s.status) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        act.mutate(
                          { id: s._id, action: 'fail' },
                          { onError: fail('Could not mark failed') },
                        )
                      }
                    >
                      {tr('Mark failed')}
                    </Button>
                  )}
                </span>
                {paying === s._id && <RecordPayment s={s} onDone={() => setPaying(null)} />}
              </span>
            ),
          },
        ]}
      />
      <Pager data={list.data} page={page} setPage={setPage} />
    </div>
  );
}

// ------------------------------------------------------------------ coupons
interface Coupon {
  _id: string;
  code: string;
  name: string;
  kind: string;
  discountType: 'PERCENT' | 'FIXED';
  value: number;
  usedCount: number;
  reservedCount: number;
  totalLimit: number | null;
  active: boolean;
  startsAt: string;
  endsAt: string | null;
  redeemedDiscountMinor: number;
}
const PROMOTION_TYPES: Record<AdminPromotionDto['ruleType'], string> = {
  get PROMOTIONAL() {
    return tr('Promotional');
  },
  get EARLY_BIRD() {
    return tr('Early bird');
  },
  get LAST_MINUTE() {
    return tr('Last minute');
  },
  get LONG_STAY() {
    return tr('Long stay');
  },
};
const PROMOTION_STATE_LABELS: Record<PromotionState, string> = {
  get ACTIVE() {
    return tr('Running');
  },
  get UPCOMING() {
    return tr('Upcoming');
  },
  get ENDED() {
    return tr('Ended');
  },
  get PAUSED() {
    return tr('Paused');
  },
};
const PROMOTION_STATE_TONES: Record<PromotionState, 'success' | 'info' | 'neutral'> = {
  ACTIVE: 'success',
  UPCOMING: 'info',
  ENDED: 'neutral',
  PAUSED: 'neutral',
};
function promotionValue(p: AdminPromotionDto) {
  const v = p.adjustmentValue;
  if (p.adjustmentType === 'PERCENT')
    return v <= 0 ? trf('{0}% off', [Math.abs(v) / 100]) : trf('+{0}%', [v / 100]);
  if (p.adjustmentType === 'AMOUNT')
    return v <= 0
      ? trf('{0} off a night', [fmtMoney(Math.abs(v), p.currency)])
      : trf('+{0} a night', [fmtMoney(v, p.currency)]);
  return trf('Fixed {0} a night', [fmtMoney(v, p.currency)]);
}

/** Marketplace-wide view of partner discounts, next to the platform-funded coupons. */
export function AdminPromotionsPage() {
  const [page, setPage] = useState(1);
  const [state, setState] = useState<PromotionState | ''>('ACTIVE');
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const list = useApiQuery<
    Page<AdminPromotionDto> & { summary: AdminPromotionSummaryDto; truncated: boolean }
  >(['admin', 'promotions'], '/admin/promotions', {
    page,
    state: state || undefined,
    type: type || undefined,
    q: q || undefined,
  });
  const coupons = useApiQuery<Page<Coupon>>(['admin', 'coupons'], '/admin/coupons', { page: 1 });
  const liveCoupons = coupons.data?.items.filter((c) => c.active).length;
  const summary = list.data?.summary;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={tr('Promotions')}
        description={tr(
          'Discounts partners run on their own properties (funded by the partner), and the platform-funded coupons. Dates are each property’s local dates.',
        )}
        actions={
          <ButtonLink to="/admin/coupons" variant="secondary">
            {tr('Manage coupons')}
          </ButtonLink>
        }
      />
      <KpiGrid>
        <KpiTile
          label={tr('Running partner promotions')}
          value={summary ? String(summary.ACTIVE) : '—'}
        />
        <KpiTile label={tr('Upcoming')} value={summary ? String(summary.UPCOMING) : '—'} />
        <KpiTile label={tr('Paused by partners')} value={summary ? String(summary.PAUSED) : '—'} />
        <KpiTile
          label={tr('Active platform coupons')}
          value={liveCoupons === undefined ? '—' : String(liveCoupons)}
          hint={
            coupons.data && coupons.data.pagination.totalPages > 1
              ? tr('First page of coupons only')
              : undefined
          }
        />
      </KpiGrid>
      {list.data?.truncated && (
        <Alert tone="warning">
          {tr('Only the 2,000 most recently updated discounts were checked. Narrow the search.')}
        </Alert>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <SearchInput
          label={tr('Property')}
          placeholder={tr('Property name')}
          value={search}
          onValueChange={setSearch}
          onSearch={(value) => {
            setQ(value);
            setPage(1);
          }}
          containerClassName="w-64"
        />
        <Select
          label={tr('State')}
          value={state}
          onChange={(e) => {
            setState(e.target.value as PromotionState | '');
            setPage(1);
          }}
          options={[
            { value: '', label: tr('Any state') },
            ...PROMOTION_STATES.map((s) => ({ value: s, label: PROMOTION_STATE_LABELS[s] })),
          ]}
          containerClassName="w-44"
        />
        <Select
          label={tr('Type')}
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setPage(1);
          }}
          options={[
            { value: '', label: tr('All types') },
            ...DISCOUNT_RULE_TYPES.map((t) => ({ value: t, label: PROMOTION_TYPES[t] })),
          ]}
          containerClassName="w-44"
        />
      </div>
      <DataTable
        caption={tr('Partner promotions')}
        rows={list.data?.items}
        loading={list.isPending}
        getRowId={(p) => p.id}
        empty={
          <EmptyState
            compact
            title={tr('No promotions match')}
            description={tr('Partners create discounts under Rates & pricing on their properties.')}
          />
        }
        columns={[
          {
            id: 'n',
            header: tr('Promotion'),
            cell: (p) => (
              <span className="flex flex-col">
                <span className="font-medium">{p.name}</span>
                <span className="text-xs text-fg-muted">{PROMOTION_TYPES[p.ruleType]}</span>
              </span>
            ),
          },
          {
            id: 'h',
            header: tr('Property'),
            cell: (p) => (
              <span className="flex flex-col">
                <Link to={`/admin/properties/${p.hotelId}`} className="hover:underline">
                  {p.hotelName}
                </Link>
                <span className="text-xs text-fg-muted">
                  {[p.hotelCity, p.partnerName].filter(Boolean).join(' · ')}
                </span>
              </span>
            ),
          },
          { id: 'v', header: tr('Discount'), cell: promotionValue },
          {
            id: 'w',
            header: tr('Window'),
            cell: (p) => (
              <span className="flex flex-col">
                <span>
                  {p.windowFrom || p.windowTo
                    ? trf('{0} → {1}', [p.windowFrom ?? '…', p.windowTo ?? '…'])
                    : tr('Open-ended')}
                </span>
                <span className="text-xs text-fg-muted">
                  {p.windowKind === 'BOOKING' ? tr('Booking dates') : tr('Stay dates')}
                </span>
              </span>
            ),
          },
          {
            id: 's',
            header: tr('State'),
            cell: (p) => (
              <Badge tone={PROMOTION_STATE_TONES[p.state]}>{PROMOTION_STATE_LABELS[p.state]}</Badge>
            ),
          },
        ]}
      />
      <Pager data={list.data} page={page} setPage={setPage} />
    </div>
  );
}

export function AdminCouponsPage() {
  const [page, setPage] = useState(1);
  const list = useApiQuery<Page<Coupon>>(['admin', 'coupons'], '/admin/coupons', { page });
  const [form, setForm] = useState({
    code: '',
    name: '',
    discountType: 'PERCENT',
    value: '10',
    totalLimit: '',
    perUserLimit: '1',
    minBooking: '',
    endsAt: '',
    firstBookingOnly: false,
  });
  const fail = useFail();
  const save = useApiMutation(
    () =>
      api.post('/admin/coupons', {
        code: form.code,
        name: form.name,
        discountType: form.discountType,
        value:
          form.discountType === 'PERCENT'
            ? Math.round(Number(form.value) * 100)
            : Math.round(Number(form.value) * 100),
        totalLimit: form.totalLimit ? Number(form.totalLimit) : null,
        perUserLimit: Number(form.perUserLimit) || 1,
        minBookingMinor: form.minBooking ? Math.round(Number(form.minBooking) * 100) : 0,
        firstBookingOnly: form.firstBookingOnly,
        startsAt: new Date().toISOString(),
        endsAt: form.endsAt ? new Date(`${form.endsAt}T23:59:59+05:30`).toISOString() : null,
      }),
    [['admin', 'coupons']],
  );
  const toggle = useApiMutation(
    (c: Coupon) =>
      api.put(`/admin/coupons/${c._id}`, {
        code: c.code,
        name: c.name,
        discountType: c.discountType,
        value: c.value,
        startsAt: c.startsAt,
        endsAt: c.endsAt,
        totalLimit: c.totalLimit,
        active: !c.active,
      }),
    [['admin', 'coupons']],
  );
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={tr('Coupons')}
        description={tr(
          'Platform-funded discounts. Limits are enforced atomically at checkout and uses are released when a hold expires.',
        )}
      />
      <SectionCard title={tr('New coupon')}>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(undefined, { onError: fail('Could not create the coupon') });
          }}
        >
          <Input
            label={tr('Code')}
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
            containerClassName="w-40"
          />
          <Input
            label={tr('Name')}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            containerClassName="w-56"
          />
          <Select
            label={tr('Type')}
            value={form.discountType}
            onChange={(e) => setForm({ ...form, discountType: e.target.value })}
            options={[
              { value: 'PERCENT', label: tr('Percentage') },
              { value: 'FIXED', label: tr('Fixed amount (₹)') },
            ]}
            containerClassName="w-44"
          />
          <Input
            label={form.discountType === 'PERCENT' ? tr('Percent off') : tr('Amount off (₹)')}
            inputMode="decimal"
            value={form.value}
            onChange={(e) => setForm({ ...form, value: e.target.value })}
            containerClassName="w-32"
          />
          <Input
            label={tr('Total uses (blank = unlimited)')}
            inputMode="numeric"
            value={form.totalLimit}
            onChange={(e) => setForm({ ...form, totalLimit: e.target.value })}
            containerClassName="w-52"
          />
          <Input
            label={tr('Uses per customer')}
            inputMode="numeric"
            value={form.perUserLimit}
            onChange={(e) => setForm({ ...form, perUserLimit: e.target.value })}
            containerClassName="w-40"
          />
          <Input
            label={tr('Minimum booking (₹)')}
            inputMode="decimal"
            value={form.minBooking}
            onChange={(e) => setForm({ ...form, minBooking: e.target.value })}
            containerClassName="w-44"
          />
          <Input
            type="date"
            label={tr('Ends on')}
            value={form.endsAt}
            onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
            containerClassName="w-44"
          />
          <Checkbox
            label={tr('First booking only')}
            checked={form.firstBookingOnly}
            onChange={(e) => setForm({ ...form, firstBookingOnly: e.target.checked })}
          />
          <Button
            type="submit"
            loading={save.isPending}
            disabled={form.code.length < 3 || form.name.length < 2}
          >
            {tr('Create coupon')}
          </Button>
        </form>
      </SectionCard>
      <DataTable
        caption={tr('Coupons')}
        rows={list.data?.items}
        loading={list.isPending}
        getRowId={(c) => c._id}
        empty={<EmptyState compact title={tr('No coupons yet')} />}
        columns={[
          { id: 'c', header: tr('Code'), cell: (c) => <span className="font-mono">{c.code}</span> },
          { id: 'n', header: tr('Name'), cell: (c) => c.name },
          {
            id: 'v',
            header: tr('Discount'),
            cell: (c) => (c.discountType === 'PERCENT' ? fmtPct(c.value) : fmtMoney(c.value)),
          },
          {
            id: 'u',
            header: tr('Used / limit'),
            cell: (c) =>
              `${c.usedCount}${c.reservedCount ? ` (+${c.reservedCount} held)` : ''} / ${c.totalLimit ?? '∞'}`,
            align: 'right',
          },
          {
            id: 'd',
            header: tr('Discount given'),
            cell: (c) => fmtMoney(c.redeemedDiscountMinor),
            align: 'right',
          },
          {
            id: 's',
            header: tr('Status'),
            cell: (c) => <StatusBadge status={c.active ? 'ACTIVE' : 'PAUSED'} />,
          },
          {
            id: 'x',
            header: '',
            cell: (c) => (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => toggle.mutate(c, { onError: fail('Could not update') })}
              >
                {c.active ? tr('Pause') : tr('Activate')}
              </Button>
            ),
          },
        ]}
      />
      <Pager data={list.data} page={page} setPage={setPage} />
    </div>
  );
}

// ------------------------------------------------------------------ support queue
function TicketPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useApiQuery<AgentTicketDto>(
    ['admin', 'support', 'ticket'],
    `/admin/support/tickets/${id}`,
  );
  const [channel, setChannel] = useState<'CUSTOMER' | 'PARTNER' | 'INTERNAL'>('CUSTOMER');
  const [body, setBody] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const fail = useFail();
  const key = [['admin', 'support']];
  const send = useApiMutation(() => {
    const fd = new FormData();
    fd.set('channel', channel);
    fd.set('body', body);
    if (file) fd.set('file', file);
    return unwrap(http.post(`/admin/support/tickets/${id}/messages`, fd));
  }, key);
  const patch = useApiMutation((b: object) => api.patch(`/admin/support/tickets/${id}`, b), key);
  const action = useApiMutation(
    (v: { path: string; body: object }) =>
      api.post(`/admin/support/tickets/${id}/${v.path}`, v.body),
    key,
  );
  const d = t.data;
  return (
    <SectionCard
      title={d ? `${d.ticketNumber} · ${d.subject}` : tr('Ticket')}
      actions={
        <Button size="sm" variant="ghost" onClick={onClose}>
          {tr('Close')}
        </Button>
      }
    >
      <QueryState query={t}>
        {d && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <StatusBadge status={d.status} />
              <StatusBadge status={d.priority} />
              <span>
                {d.customer.name} · {d.customer.email}
              </span>
              {d.hotel && <span className="text-fg-subtle">· {d.hotel.name}</span>}
              {d.bookingReference && (
                <span className="font-mono text-xs">{d.bookingReference}</span>
              )}
              <span className="text-fg-subtle">
                {tr('· first response')}{' '}
                {d.firstResponseAt ? fmtDateTime(d.firstResponseAt) : 'pending'}
              </span>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <Select
                label={tr('Priority')}
                value={d.priority}
                onChange={(e) =>
                  patch.mutate({ priority: e.target.value }, { onError: fail('Could not update') })
                }
                options={['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((p) => ({
                  value: p,
                  label: p.toLowerCase(),
                }))}
                containerClassName="w-36"
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  action.mutate(
                    { path: 'assign', body: { assigneeId: null } },
                    { onError: fail('Could not unassign') },
                  )
                }
              >
                {tr('Unassign')}
              </Button>
              {d.hotel && (
                <Checkbox
                  label={tr('Share with property')}
                  checked={d.partnerVisible}
                  onChange={(e) =>
                    patch.mutate(
                      { partnerVisible: e.target.checked },
                      { onError: fail('Could not update sharing') },
                    )
                  }
                />
              )}
              <Input
                label={tr('Escalation / resolution note')}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                containerClassName="w-64"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={note.length < 3}
                onClick={() =>
                  action.mutate(
                    { path: 'escalate', body: { reason: note } },
                    { onSuccess: () => setNote(''), onError: fail('Could not escalate') },
                  )
                }
              >
                {tr('Escalate')}
              </Button>
              <Button
                size="sm"
                disabled={note.length < 3}
                onClick={() =>
                  action.mutate(
                    { path: 'resolve', body: { resolution: note } },
                    { onSuccess: () => setNote(''), onError: fail('Could not resolve') },
                  )
                }
              >
                {tr('Resolve')}
              </Button>
            </div>
            <ol className="flex flex-col gap-2" aria-label={tr('Conversation')}>
              {d.messages?.map((m) => (
                <li
                  key={m.id}
                  className={
                    m.channel === 'INTERNAL'
                      ? 'rounded-lg border border-dashed border-warning p-3 text-sm'
                      : m.channel === 'PARTNER'
                        ? 'rounded-lg bg-info-soft p-3 text-sm'
                        : 'rounded-lg bg-surface-muted p-3 text-sm'
                  }
                >
                  <p className="font-medium">
                    {m.authorName}{' '}
                    <span className="text-xs text-fg-subtle">
                      {m.channel === 'INTERNAL'
                        ? tr('internal note')
                        : m.channel === 'PARTNER'
                          ? tr('property thread')
                          : tr('customer thread')}{' '}
                      · {fmtDateTime(m.createdAt)}
                    </span>
                  </p>
                  <p className="whitespace-pre-wrap">{m.body}</p>
                  {m.attachments.map((a) => (
                    <Button
                      key={a.id}
                      size="sm"
                      variant="link"
                      onClick={() =>
                        void downloadFile(
                          `/admin/support/tickets/${id}/attachments/${a.id}`,
                          a.fileName,
                        )
                      }
                    >
                      {a.fileName}
                    </Button>
                  ))}
                </li>
              ))}
            </ol>
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                send.mutate(undefined, {
                  onSuccess: () => {
                    setBody('');
                    setFile(null);
                  },
                  onError: fail('Could not send'),
                });
              }}
            >
              <Select
                label={tr('Send to')}
                value={channel}
                onChange={(e) => setChannel(e.target.value as typeof channel)}
                options={[
                  { value: 'CUSTOMER', label: tr('Customer') },
                  ...(d.partnerVisible ? [{ value: 'PARTNER', label: tr('Property') }] : []),
                  { value: 'INTERNAL', label: tr('Internal note (agents only)') },
                ]}
                containerClassName="w-64"
              />
              <Textarea
                label={tr('Message')}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
              <label className="flex flex-col gap-1 text-sm">
                {tr('Attachment (optional, PDF or image, up to 5 MB)')}
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
              <Button
                type="submit"
                size="sm"
                className="self-start"
                disabled={!body.trim()}
                loading={send.isPending}
              >
                {tr('Send')}
              </Button>
            </form>
          </>
        )}
      </QueryState>
    </SectionCard>
  );
}
export function AdminSupportPage() {
  const p = usePaged();
  const [status, setStatus] = useState('ACTIVE');
  const [assignee, setAssignee] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const list = useApiQuery<Page<AgentTicketDto>>(['admin', 'support'], '/admin/support/tickets', {
    page: p.page,
    q: p.q || undefined,
    status,
    assignee: assignee || undefined,
  });
  const metrics = useApiQuery<{
    created: number;
    open: number;
    resolved: number;
    averageFirstResponseMinutes: number | null;
    averageResolutionHours: number | null;
  }>(['admin', 'support', 'metrics'], '/admin/support/metrics');
  const fail = useFail();
  const { user } = useAuth();
  const claim = useApiMutation(
    (id: string) =>
      api.post<AgentTicketDto>(`/admin/support/tickets/${id}/assign`, {
        assigneeId: user?.id ?? null,
      }),
    [['admin', 'support']],
  );
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={tr('Support queue')}
        description={tr(
          'Highest priority first. Internal notes are never visible to customers or properties.',
        )}
      />
      <QueryState query={metrics}>
        {metrics.data && (
          <KpiGrid>
            <KpiTile label={tr('Open')} value={metrics.data.open} />
            <KpiTile label={tr('Created (30 days)')} value={metrics.data.created} />
            <KpiTile
              label={tr('Avg first response')}
              value={
                metrics.data.averageFirstResponseMinutes === null
                  ? '—'
                  : `${metrics.data.averageFirstResponseMinutes} min`
              }
            />
            <KpiTile
              label={tr('Avg resolution')}
              value={
                metrics.data.averageResolutionHours === null
                  ? '—'
                  : `${metrics.data.averageResolutionHours} h`
              }
            />
          </KpiGrid>
        )}
      </QueryState>
      <div className="flex flex-wrap items-end gap-3">
        <SearchInput
          label={tr('Ticket number, subject or booking')}
          value={p.q}
          onValueChange={p.setQ}
        />
        <Select
          label={tr('Status')}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={[
            'ACTIVE',
            'OPEN',
            'IN_PROGRESS',
            'WAITING_FOR_CUSTOMER',
            'ESCALATED',
            'RESOLVED',
            'CLOSED',
          ].map((s) => ({
            value: s,
            label: s === 'ACTIVE' ? 'All active' : s.replace(/_/g, ' ').toLowerCase(),
          }))}
          containerClassName="w-52"
        />
        <Select
          label={tr('Assignee')}
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          options={[
            { value: '', label: tr('Anyone') },
            { value: 'me', label: tr('Assigned to me') },
            { value: 'unassigned', label: tr('Unassigned') },
          ]}
          containerClassName="w-44"
        />
      </div>
      <DataTable
        caption={tr('Support tickets')}
        rows={list.data?.items}
        loading={list.isPending}
        error={list.isError ? normalizeApiError(list.error) : null}
        getRowId={(t) => t.id}
        empty={<EmptyState compact title={tr('The queue is clear')} />}
        columns={[
          { id: 'p', header: tr('Priority'), cell: (t) => <StatusBadge status={t.priority} /> },
          {
            id: 's',
            header: tr('Subject'),
            cell: (t) => (
              <button
                type="button"
                className="text-left font-medium hover:underline"
                onClick={() => setOpen(t.id)}
              >
                {t.subject}
                <span className="block text-xs text-fg-subtle">
                  {t.ticketNumber} · {t.category.toLowerCase()}
                </span>
              </button>
            ),
          },
          { id: 'c', header: tr('Customer'), cell: (t) => t.customer.name },
          {
            id: 'a',
            header: tr('Assignee'),
            cell: (t) =>
              t.assignee?.name ?? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => claim.mutate(t.id, { onError: fail('Could not assign') })}
                >
                  {tr('Assign to me')}
                </Button>
              ),
          },
          { id: 't', header: tr('Status'), cell: (t) => <StatusBadge status={t.status} /> },
          { id: 'l', header: tr('Last message'), cell: (t) => fmtDateTime(t.lastMessageAt) },
        ]}
      />
      <Pager data={list.data} page={p.page} setPage={p.setPage} />
      {open && <TicketPanel id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

// ------------------------------------------------------------------ organisations
export function AdminOrganizationsPage() {
  const [status, setStatus] = useState('PENDING_VERIFICATION');
  const list = useApiQuery<
    Page<{
      id: string;
      name: string;
      billingEmail: string;
      gstin: string | null;
      status: string;
      createdAt: string;
    }>
  >(['admin', 'orgs'], '/admin/organizations', { status: status || undefined });
  const fail = useFail();
  const decide = useApiMutation(
    (v: { id: string; body: object }) => api.post(`/admin/organizations/${v.id}/decision`, v.body),
    [['admin', 'orgs']],
  );
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={tr('Corporate accounts')}
        description={tr('Verify businesses before their employees can request travel.')}
      />
      <Select
        label={tr('Status')}
        value={status}
        onChange={(e) => setStatus(e.target.value)}
        options={[
          { value: 'PENDING_VERIFICATION', label: tr('Awaiting verification') },
          { value: 'ACTIVE', label: tr('Active') },
          { value: 'SUSPENDED', label: tr('Suspended') },
          { value: '', label: tr('All') },
        ]}
        containerClassName="w-56"
      />
      <DataTable
        caption={tr('Organisations')}
        rows={list.data?.items}
        loading={list.isPending}
        getRowId={(o) => o.id}
        empty={<EmptyState compact title={tr('No organisations')} />}
        columns={[
          { id: 'n', header: tr('Name'), cell: (o) => o.name },
          { id: 'e', header: tr('Billing email'), cell: (o) => o.billingEmail },
          { id: 'g', header: 'GSTIN', cell: (o) => o.gstin ?? '—' },
          { id: 's', header: tr('Status'), cell: (o) => <StatusBadge status={o.status} /> },
          {
            id: 'x',
            header: '',
            cell: (o) => (
              <span className="flex gap-1">
                {o.status !== 'ACTIVE' && (
                  <Button
                    size="sm"
                    onClick={() =>
                      decide.mutate(
                        { id: o.id, body: { decision: 'APPROVE' } },
                        { onError: fail('Could not approve') },
                      )
                    }
                  >
                    {tr('Approve')}
                  </Button>
                )}
                {o.status === 'ACTIVE' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      decide.mutate(
                        {
                          id: o.id,
                          body: { decision: 'SUSPEND', reason: 'Suspended by an administrator' },
                        },
                        { onError: fail('Could not suspend') },
                      )
                    }
                  >
                    {tr('Suspend')}
                  </Button>
                )}
              </span>
            ),
          },
        ]}
      />
    </div>
  );
}

// ------------------------------------------------------------------ review moderation
export function AdminReviewsPage() {
  const [status, setStatus] = useState('FLAGGED');
  const list = useApiQuery<AdminReviewDto[]>(['admin', 'reviews'], '/admin/reviews', { status });
  const fail = useFail();
  const moderate = useApiMutation(
    (v: { id: string; decision: string }) =>
      api.post(`/admin/reviews/${v.id}/moderation`, {
        decision: v.decision,
        reason: 'Moderated from the review console',
      }),
    [['admin', 'reviews']],
  );
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={tr('Review moderation')}
        description={tr(
          'Reported reviews. Removal hides a review publicly; every decision is audited.',
        )}
      />
      <Select
        label={tr('Show')}
        value={status}
        onChange={(e) => setStatus(e.target.value)}
        options={[
          { value: 'FLAGGED', label: tr('Reported') },
          { value: 'REMOVED', label: tr('Removed') },
          { value: 'PUBLISHED', label: tr('Published') },
        ]}
        containerClassName="w-44"
      />
      <QueryState query={list}>
        {list.data?.length ? (
          <ul className="flex flex-col gap-3">
            {list.data.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 rounded-xl border border-border p-4">
                <p className="font-medium">
                  {r.title || tr('Review')}{' '}
                  <span className="text-sm text-fg-subtle">
                    {r.hotel.name} · {r.reportCount} {tr('report(s)')}
                  </span>
                </p>
                {r.body && <p className="text-sm whitespace-pre-wrap">{r.body}</p>}
                {r.reports.map((x, i) => (
                  <p key={i} className="text-xs text-fg-muted">
                    {tr('Reported:')} {x.reason.toLowerCase()}
                    {x.details && ` — ${x.details}`}
                  </p>
                ))}
                <div className="flex gap-2">
                  {r.status !== 'REMOVED' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        moderate.mutate(
                          { id: r.id, decision: 'REMOVE' },
                          { onError: fail('Could not remove') },
                        )
                      }
                    >
                      {tr('Remove')}
                    </Button>
                  )}
                  {r.status === 'REMOVED' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        moderate.mutate(
                          { id: r.id, decision: 'RESTORE' },
                          { onError: fail('Could not restore') },
                        )
                      }
                    >
                      {tr('Restore')}
                    </Button>
                  )}
                  {r.status === 'FLAGGED' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        moderate.mutate(
                          { id: r.id, decision: 'DISMISS_REPORTS' },
                          { onError: fail('Could not dismiss') },
                        )
                      }
                    >
                      {tr('Dismiss reports')}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title={tr('Nothing to review')} />
        )}
      </QueryState>
    </div>
  );
}

export { rid };
