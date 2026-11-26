import { useState } from 'react';
import { Link } from 'react-router';
import { Download, Info } from 'lucide-react';
import { STAFF_PERMISSIONS, STAFF_PERMISSION_LABELS, addDays, todayInTimeZone, type StaffDto, type StaffPermission } from '@stayscape/shared';
import { Alert, Badge, Button, Checkbox, DataTable, EmptyState, Input, PageHeader, Select, Textarea, useToast } from '@/components/ui';
import { usePartnerHotels, useRoomTypes } from '@/features/partner/api';
import { normalizeApiError } from '@/lib/api/errors';
import { api, downloadCsv, useApiMutation, useApiQuery, type Page } from './api';
import { BarChart, KpiGrid, KpiTile, PeriodFilter, QueryState, SectionCard, StatusBadge, fmtDate, fmtDateTime, fmtMoney, fmtPct } from './components';

const today = () => todayInTimeZone('Asia/Kolkata');
function useErrorToast() {
  const { toast } = useToast();
  return (title: string) => (e: unknown) => toast({ title, description: normalizeApiError(e).message, variant: 'error' });
}

/** Lets the user pick one of their properties (owners see all; the list is hidden when unavailable). */
function PropertyPicker({ value, onChange, allowAll = false }: { value: string; onChange: (id: string) => void; allowAll?: boolean }) {
  const hotels = usePartnerHotels();
  if (!hotels.data?.length) return null;
  return (
    <Select
      label="Property"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      options={[...(allowAll ? [{ value: '', label: 'All properties' }] : []), ...hotels.data.map((h) => ({ value: h.id, label: h.name }))]}
      containerClassName="w-64"
    />
  );
}
function useDefaultHotel() {
  const hotels = usePartnerHotels();
  const [picked, setPicked] = useState('');
  return [picked || hotels.data?.[0]?.id || '', setPicked] as const;
}

// ------------------------------------------------------------------ analytics
interface PartnerAnalytics {
  period: { from: string; to: string; currency: string };
  kpis: Record<string, number | null> & { previousPeriod: { totalReservations: number; grossBookingValueMinor: number } };
  trend: Array<{ date: string; revenueMinor: number; roomNightsSold: number; availableRoomNights: number; occupancyBp: number }>;
  bookingTrend: Array<{ date: string; bookings: number; cancellations: number }>;
  roomPerformance: Array<{ roomType: string; roomNightsSold: number; revenueMinor: number; adrMinor: number }>;
  reviewTrend: Array<{ month: string; score: number; count: number }>;
}

const DEFINITIONS: Array<[string, string]> = [
  ['Total reservations', 'Bookings confirmed (payment captured) in the period, including any cancelled later.'],
  ['Gross booking value', 'What guests owed for those bookings, including taxes and fees, before platform-funded coupons. Not your payout.'],
  ['Recognised room revenue', 'Room charges (after rate discounts, excluding taxes and fees) for nights inside the period of stays that were not cancelled.'],
  ['Occupancy', 'Room nights sold ÷ room nights available (rooms minus blocked and maintenance rooms).'],
  ['ADR', 'Average daily rate: recognised room revenue ÷ room nights sold.'],
  ['RevPAR', 'Revenue per available room: recognised room revenue ÷ available room nights.'],
  ['Cancellation rate', 'Share of reservations confirmed in the period that were later cancelled or rejected.'],
  ['Booking conversion', 'Reservations ÷ property page views in the period.'],
];

export function PartnerAnalyticsPage() {
  const [period, setPeriod] = useState({ from: addDays(today(), -30), to: today() });
  const [hotelId, setHotelId] = useState('');
  const params = { from: period.from, to: period.to, hotelIds: hotelId || undefined };
  const q = useApiQuery<PartnerAnalytics>(['partner', 'analytics'], '/partner/analytics', params);
  const k = q.data?.kpis;
  const cur = q.data?.period.currency ?? 'INR';
  const change = (now: number | null | undefined, before: number | undefined) => (now !== null && now !== undefined && before ? Math.round(((now - before) * 10_000) / before) : null);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Performance"
        description="Reservations, revenue and occupancy for the properties you can access."
        actions={
          <Button variant="outline" size="sm" onClick={() => void downloadCsv('/partner/analytics', params, `stayscape-analytics-${period.from}-${period.to}.csv`)}>
            <Download className="size-4" aria-hidden="true" /> Export CSV
          </Button>
        }
      />
      <PeriodFilter value={period} onChange={setPeriod}>
        <PropertyPicker value={hotelId} onChange={setHotelId} allowAll />
      </PeriodFilter>
      <QueryState query={q} skeleton={4}>
        {k && q.data && (
          <>
            <KpiGrid>
              <KpiTile label="Reservations" value={k.totalReservations} changeBp={change(k.totalReservations, k.previousPeriod.totalReservations)} />
              <KpiTile label="Upcoming arrivals (7 days)" value={k.upcomingArrivals} />
              <KpiTile label="Guests in house" value={k.currentGuests} />
              <KpiTile label="Completed stays" value={k.completedStays} />
              <KpiTile label="Cancelled" value={k.cancelledBookings} hint={`Cancellation rate ${fmtPct(k.cancellationRateBp)}`} />
              <KpiTile label="Gross booking value" value={fmtMoney(k.grossBookingValueMinor, cur)} changeBp={change(k.grossBookingValueMinor, k.previousPeriod.grossBookingValueMinor)} />
              <KpiTile label="Room revenue" value={fmtMoney(k.recognisedRoomRevenueMinor, cur)} />
              <KpiTile label="Occupancy" value={fmtPct(k.occupancyBp)} hint={`${k.roomNightsSold} of ${k.availableRoomNights} room nights`} />
              <KpiTile label="ADR" value={fmtMoney(k.adrMinor, cur)} />
              <KpiTile label="RevPAR" value={fmtMoney(k.revparMinor, cur)} />
              <KpiTile label="Average booking value" value={fmtMoney(k.averageBookingValueMinor, cur)} />
              <KpiTile label="Guest review score" value={k.guestReviewScore ?? '—'} hint={`${k.reviewCount} review(s) · conversion ${fmtPct(k.bookingConversionBp)}`} />
            </KpiGrid>
            <div className="grid gap-4 lg:grid-cols-2">
              <SectionCard title="Room revenue by night">
                <BarChart title="Recognised room revenue per night" data={q.data.trend.map((t) => ({ label: t.date, value: t.revenueMinor }))} format={(v) => fmtMoney(v, cur)} />
              </SectionCard>
              <SectionCard title="Occupancy by night">
                <BarChart title="Occupancy per night" data={q.data.trend.map((t) => ({ label: t.date, value: t.occupancyBp }))} format={fmtPct} />
              </SectionCard>
              <SectionCard title="Bookings by confirmation date">
                <BarChart title="Bookings per day" data={q.data.bookingTrend.map((b) => ({ label: b.date, value: b.bookings }))} />
              </SectionCard>
              <SectionCard title="Room category performance">
                {q.data.roomPerformance.length ? (
                  <DataTable
                    caption="Room category performance"
                    rows={q.data.roomPerformance}
                    getRowId={(r) => r.roomType}
                    columns={[
                      { id: 'r', header: 'Room category', cell: (r) => r.roomType },
                      { id: 'n', header: 'Nights sold', cell: (r) => r.roomNightsSold, align: 'right' },
                      { id: 'v', header: 'Revenue', cell: (r) => fmtMoney(r.revenueMinor, cur), align: 'right' },
                      { id: 'a', header: 'ADR', cell: (r) => fmtMoney(r.adrMinor, cur), align: 'right' },
                    ]}
                  />
                ) : (
                  <EmptyState compact title="No stays in this period" />
                )}
              </SectionCard>
            </div>
          </>
        )}
      </QueryState>
      <details className="rounded-xl border border-border p-4 text-sm">
        <summary className="flex cursor-pointer items-center gap-2 font-medium">
          <Info className="size-4" aria-hidden="true" /> How these metrics are calculated
        </summary>
        <dl className="mt-3 grid gap-2 sm:grid-cols-2">
          {DEFINITIONS.map(([term, def]) => (
            <div key={term}>
              <dt className="font-medium text-fg">{term}</dt>
              <dd className="text-fg-muted">{def}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}

// ------------------------------------------------------------------ staff
function PermissionChecklist({ value, onChange }: { value: StaffPermission[]; onChange: (v: StaffPermission[]) => void }) {
  return (
    <fieldset className="grid gap-2 sm:grid-cols-2">
      <legend className="mb-2 text-sm font-medium">Permissions</legend>
      {STAFF_PERMISSIONS.map((p) => (
        <Checkbox key={p} label={STAFF_PERMISSION_LABELS[p]} checked={value.includes(p)} onChange={(e) => onChange(e.target.checked ? [...value, p] : value.filter((x) => x !== p))} />
      ))}
    </fieldset>
  );
}

function StaffRow({ member, hotels }: { member: StaffDto; hotels: Array<{ id: string; name: string }> }) {
  const [editing, setEditing] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [perms, setPerms] = useState<StaffPermission[]>(member.permissions);
  const [props, setProps] = useState<string[]>(member.assignedProperties);
  const fail = useErrorToast();
  const key = [['partner', 'staff']];
  const save = useApiMutation(() => api.patch(`/partner/staff/${member.id}`, { assignedProperties: props, permissions: perms }), key);
  const suspend = useApiMutation((s: boolean) => api.post(`/partner/staff/${member.id}/${s ? 'suspend' : 'reactivate'}`), key);
  const remove = useApiMutation(() => api.del(`/partner/staff/${member.id}`), key);
  const log = useApiQuery<Page<{ id: string; action: string; createdAt: string; entityType: string }>>(['partner', 'staff-activity'], showLog ? `/partner/staff/${member.id}/activity` : null);
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">{member.name || member.email}</p>
          <p className="text-sm text-fg-muted">{member.email}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={member.invitationStatus} />
          <Button size="sm" variant="ghost" onClick={() => setEditing((e) => !e)} aria-expanded={editing}>Edit access</Button>
          {member.invitationStatus === 'ACCEPTED' && <Button size="sm" variant="ghost" onClick={() => suspend.mutate(true, { onError: fail('Could not suspend') })}>Suspend</Button>}
          {member.invitationStatus === 'SUSPENDED' && <Button size="sm" variant="ghost" onClick={() => suspend.mutate(false, { onError: fail('Could not reactivate') })}>Reactivate</Button>}
          <Button size="sm" variant="ghost" onClick={() => setShowLog((s) => !s)} aria-expanded={showLog}>Activity</Button>
          <Button size="sm" variant="ghost" onClick={() => remove.mutate(undefined, { onError: fail('Could not remove') })}>Remove</Button>
        </div>
      </div>
      <p className="text-xs text-fg-subtle">{member.permissions.length} permission(s) · {member.assignedProperties.length} propert{member.assignedProperties.length === 1 ? 'y' : 'ies'}</p>
      {editing && (
        <div className="flex flex-col gap-3 border-t border-border pt-3">
          <fieldset className="flex flex-wrap gap-3">
            <legend className="mb-2 text-sm font-medium">Properties</legend>
            {hotels.map((h) => (
              <Checkbox key={h.id} label={h.name} checked={props.includes(h.id)} onChange={(e) => setProps(e.target.checked ? [...props, h.id] : props.filter((x) => x !== h.id))} />
            ))}
          </fieldset>
          <PermissionChecklist value={perms} onChange={setPerms} />
          <Button size="sm" className="self-start" loading={save.isPending} disabled={!props.length} onClick={() => save.mutate(undefined, { onSuccess: () => setEditing(false), onError: fail('Could not save access') })}>Save access</Button>
        </div>
      )}
      {showLog && (
        <QueryState query={log}>
          <ul className="flex flex-col gap-1 border-t border-border pt-3 text-sm">
            {log.data?.items.length ? log.data.items.map((a) => (
              <li key={a.id} className="flex justify-between gap-2"><span>{a.action.replace(/[._]/g, ' ')}</span><span className="text-fg-subtle">{fmtDateTime(a.createdAt)}</span></li>
            )) : <li className="text-fg-subtle">No activity yet.</li>}
          </ul>
        </QueryState>
      )}
    </li>
  );
}

export function PartnerStaffPage() {
  const staff = useApiQuery<StaffDto[]>(['partner', 'staff'], '/partner/staff');
  const hotels = usePartnerHotels();
  const [email, setEmail] = useState('');
  const [perms, setPerms] = useState<StaffPermission[]>(['bookings:view']);
  const [props, setProps] = useState<string[]>([]);
  const fail = useErrorToast();
  const { toast } = useToast();
  const invite = useApiMutation(() => api.post('/partner/staff', { email, assignedProperties: props, permissions: perms }), [['partner', 'staff']]);
  const list = (hotels.data ?? []).map((h) => ({ id: h.id, name: h.name }));
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Team" description="Invite staff, choose which properties they work on and exactly what they may do. Every action they take is logged." />
      <SectionCard title="Invite a team member">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            invite.mutate(undefined, { onSuccess: () => { setEmail(''); toast({ title: 'Invitation sent', variant: 'success' }); }, onError: fail('Invitation failed') });
          }}
        >
          <Input label="Email address" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} containerClassName="max-w-sm" />
          <fieldset className="flex flex-wrap gap-3">
            <legend className="mb-2 text-sm font-medium">Properties</legend>
            {list.map((h) => <Checkbox key={h.id} label={h.name} checked={props.includes(h.id)} onChange={(e) => setProps(e.target.checked ? [...props, h.id] : props.filter((x) => x !== h.id))} />)}
          </fieldset>
          <PermissionChecklist value={perms} onChange={setPerms} />
          <Button type="submit" className="self-start" loading={invite.isPending} disabled={!email || !props.length || !perms.length}>Send invitation</Button>
        </form>
      </SectionCard>
      <QueryState query={staff}>
        {staff.data?.length ? <ul className="flex flex-col gap-3">{staff.data.map((m) => <StaffRow key={m.id} member={m} hotels={list} />)}</ul> : <EmptyState title="No team members yet" description="Invited people appear here once you send an invitation." />}
      </QueryState>
    </div>
  );
}

// ------------------------------------------------------------------ settlements
interface Settlement { _id: string; reference: string; status: string; netPayableMinor: number; currency: string; periodEnd: string; createdAt: string; evidence: { paidAt: string; providerReference: string } | null }
export function PartnerSettlementsPage() {
  const summary = useApiQuery<Record<string, number | string>>(['partner', 'finance'], '/partner/finance/summary');
  const settlements = useApiQuery<Page<Settlement>>(['partner', 'settlements'], '/partner/finance/settlements');
  const ledger = useApiQuery<Page<{ _id: string; account: string; event: string; amountMinor: number; currency: string; occurredAt: string; description?: string }>>(['partner', 'ledger'], '/partner/finance/ledger');
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Settlements" description="What Stayscape owes you, from an append-only ledger. Payouts are recorded only with transfer evidence." />
      <Alert tone="info" title="Automated payouts are not enabled">Settlements are paid by bank transfer and marked paid only after the transfer reference and evidence are recorded.</Alert>
      <QueryState query={summary}>
        {summary.data && (
          <KpiGrid>
            {Object.entries(summary.data).filter(([, v]) => typeof v === 'number').map(([k, v]) => (
              <KpiTile key={k} label={k.replace(/Minor$/, '').replace(/([A-Z])/g, ' $1').toLowerCase()} value={k.endsWith('Minor') ? fmtMoney(v as number) : v} />
            ))}
          </KpiGrid>
        )}
      </QueryState>
      <SectionCard title="Settlement batches">
        <DataTable caption="Settlement batches" rows={settlements.data?.items} loading={settlements.isPending} error={settlements.isError ? normalizeApiError(settlements.error) : null} getRowId={(s) => s._id} empty={<EmptyState compact title="No settlements yet" />}
          columns={[
            { id: 'r', header: 'Reference', cell: (s) => s.reference },
            { id: 'c', header: 'Created', cell: (s) => fmtDate(s.createdAt) },
            { id: 's', header: 'Status', cell: (s) => <StatusBadge status={s.status} /> },
            { id: 'a', header: 'Net payable', cell: (s) => fmtMoney(s.netPayableMinor, s.currency), align: 'right' },
            { id: 'p', header: 'Paid', cell: (s) => (s.evidence ? `${fmtDate(s.evidence.paidAt)} · ${s.evidence.providerReference}` : '—') },
          ]}
        />
      </SectionCard>
      <SectionCard title="Ledger">
        <DataTable caption="Ledger entries" rows={ledger.data?.items} loading={ledger.isPending} getRowId={(e) => e._id} empty={<EmptyState compact title="No ledger entries yet" />}
          columns={[
            { id: 'd', header: 'Date', cell: (e) => fmtDate(e.occurredAt) },
            { id: 'e', header: 'Event', cell: (e) => e.event.replace(/_/g, ' ').toLowerCase() },
            { id: 'r', header: 'Details', cell: (e) => e.description ?? '—' },
            { id: 'x', header: 'Account', cell: (e) => e.account.replace(/_/g, ' ').toLowerCase() },
            { id: 'a', header: 'Amount', cell: (e) => fmtMoney(e.amountMinor, e.currency), align: 'right' },
          ]}
        />
      </SectionCard>
    </div>
  );
}

// ------------------------------------------------------------------ channels
interface Connection { id: string; provider: string; verifiedIntegration: boolean; name: string; status: 'ACTIVE' | 'PAUSED'; mappings: Array<{ roomTypeId: string; externalRoomCode: string }>; syncStatus: string; lastSyncAt: string | null; lastError: string | null; webhookPath: string; webhookSecret?: string }
interface ChannelEvent { id: string; externalEventId: string; type: string; externalRef: string; roomCode: string; checkIn: string; checkOut: string; rooms: number; status: string; attempts: number; error: string | null; conflictDates: string[]; createdAt: string }

function ConnectionCard({ hotelId, c }: { hotelId: string; c: Connection }) {
  const rooms = useRoomTypes(hotelId);
  const base = `/partner/hotels/${hotelId}/channels/${c.id}`;
  const key = [['partner', 'channels']];
  const fail = useErrorToast();
  const [codes, setCodes] = useState<Record<string, string>>(Object.fromEntries(c.mappings.map((m) => [m.roomTypeId, m.externalRoomCode])));
  const [secret, setSecret] = useState<string | null>(null);
  const update = useApiMutation((body: object) => api.patch(base, body), key);
  const sync = useApiMutation(() => api.post(`${base}/sync`), key);
  const rotate = useApiMutation(() => api.post<{ webhookSecret: string }>(`${base}/rotate-secret`), key);
  const events = useApiQuery<Page<ChannelEvent>>(['partner', 'channels', 'events'], `${base}/events`);
  const retry = useApiMutation((id: string) => api.post(`${base}/events/${id}/retry`), [['partner', 'channels', 'events']]);
  return (
    <SectionCard
      title={c.name}
      description={<>Provider: {c.provider === 'LOCAL_SIMULATOR' ? 'Local simulator (development and testing only)' : c.provider}{!c.verifiedIntegration && ' · not a verified third-party integration'}</>}
      actions={<div className="flex gap-2"><StatusBadge status={c.status} /><StatusBadge status={c.syncStatus} /></div>}
    >
      <dl className="grid gap-1 text-sm sm:grid-cols-2">
        <div><dt className="text-fg-subtle">Webhook URL</dt><dd className="font-mono text-xs break-all">{c.webhookPath}</dd></div>
        <div><dt className="text-fg-subtle">Last sync</dt><dd>{fmtDateTime(c.lastSyncAt)}{c.lastError && <span className="text-danger"> — {c.lastError}</span>}</dd></div>
      </dl>
      {secret && <Alert tone="warning" title="Copy this webhook secret now">It will not be shown again: <code className="font-mono break-all">{secret}</code></Alert>}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Room mapping</legend>
        {rooms.data?.map((r) => (
          <Input key={r.id} label={`External room code for ${r.name}`} value={codes[r.id] ?? ''} onChange={(e) => setCodes({ ...codes, [r.id]: e.target.value })} containerClassName="max-w-sm" />
        ))}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" loading={update.isPending} onClick={() => update.mutate({ mappings: Object.entries(codes).filter(([, v]) => v.trim()).map(([roomTypeId, externalRoomCode]) => ({ roomTypeId, externalRoomCode: externalRoomCode.trim() })) }, { onError: fail('Could not save mapping') })}>Save mapping</Button>
        <Button size="sm" variant="outline" loading={sync.isPending} onClick={() => sync.mutate(undefined, { onError: fail('Sync failed') })}>Sync availability now</Button>
        <Button size="sm" variant="ghost" onClick={() => update.mutate({ status: c.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' }, { onError: fail('Could not change status') })}>{c.status === 'ACTIVE' ? 'Pause' : 'Resume'}</Button>
        <Button size="sm" variant="ghost" onClick={() => rotate.mutate(undefined, { onSuccess: (r) => setSecret(r.webhookSecret), onError: fail('Could not rotate the secret') })}>Rotate secret</Button>
      </div>
      <QueryState query={events}>
        <DataTable caption="Channel event log" rows={events.data?.items} getRowId={(e) => e.id} empty={<EmptyState compact title="No events received yet" />}
          columns={[
            { id: 't', header: 'Received', cell: (e) => fmtDateTime(e.createdAt) },
            { id: 'y', header: 'Event', cell: (e) => `${e.type === 'RESERVATION_CREATED' ? 'New' : 'Cancelled'} ${e.externalRef}` },
            { id: 'd', header: 'Stay', cell: (e) => `${e.checkIn} → ${e.checkOut} · ${e.rooms} × ${e.roomCode}` },
            { id: 's', header: 'Status', cell: (e) => <span className="flex flex-col gap-1"><StatusBadge status={e.status} />{e.error && <span className="text-xs text-fg-muted">{e.error}</span>}</span> },
            { id: 'a', header: '', cell: (e) => (['FAILED', 'CONFLICT'].includes(e.status) ? <Button size="sm" variant="ghost" onClick={() => retry.mutate(e.id, { onError: fail('Retry failed') })}>Retry</Button> : null) },
          ]}
        />
      </QueryState>
    </SectionCard>
  );
}

export function PartnerChannelsPage() {
  const [hotelId, setHotelId] = useDefaultHotel();
  const list = useApiQuery<Connection[]>(['partner', 'channels'], hotelId ? `/partner/hotels/${hotelId}/channels` : null);
  const [name, setName] = useState('');
  const [created, setCreated] = useState<Connection | null>(null);
  const fail = useErrorToast();
  const create = useApiMutation(() => api.post<Connection>(`/partner/hotels/${hotelId}/channels`, { provider: 'LOCAL_SIMULATOR', name }), [['partner', 'channels']]);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Channel manager" description="Connect a channel manager so reservations made elsewhere hold rooms here, and your availability is pushed out automatically." />
      <Alert tone="info" title="Integration status">Only the built-in local simulator is available. Connecting a real channel manager (for example SiteMinder or STAAH) needs that provider’s API access and a dedicated adapter, which has not been built or verified yet.</Alert>
      <PropertyPicker value={hotelId} onChange={setHotelId} />
      {created?.webhookSecret && <Alert tone="warning" title="Copy this webhook secret now">It will not be shown again: <code className="font-mono break-all">{created.webhookSecret}</code></Alert>}
      <QueryState query={list}>
        {list.data?.map((c) => <ConnectionCard key={c.id} hotelId={hotelId} c={c} />)}
        {list.data && !list.data.some((c) => c.provider === 'LOCAL_SIMULATOR') && (
          <SectionCard title="Connect the local simulator">
            <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); create.mutate(undefined, { onSuccess: (c) => setCreated(c), onError: fail('Could not connect') }); }}>
              <Input label="Connection name" required value={name} onChange={(e) => setName(e.target.value)} containerClassName="w-64" />
              <Button type="submit" loading={create.isPending} disabled={name.trim().length < 2}>Connect</Button>
            </form>
          </SectionCard>
        )}
      </QueryState>
    </div>
  );
}

// ------------------------------------------------------------------ blocks & closures
interface Block { id: string; roomTypeId: string; from: string; to: string; rooms: number; reason: string; note: string; status: string }
export function PartnerBlocksPage() {
  const [hotelId, setHotelId] = useDefaultHotel();
  const rooms = useRoomTypes(hotelId);
  const blocks = useApiQuery<Block[]>(['partner', 'blocks'], hotelId ? `/partner/hotels/${hotelId}/inventory/blocks` : null);
  const [form, setForm] = useState({ roomTypeId: '', from: today(), to: addDays(today(), 2), rooms: '1', reason: 'MAINTENANCE', note: '' });
  const [closure, setClosure] = useState({ roomTypeId: '', from: today(), to: today(), stopSell: true });
  const fail = useErrorToast();
  const { toast } = useToast();
  const key = [['partner', 'blocks']];
  const create = useApiMutation(() => api.post(`/partner/hotels/${hotelId}/inventory/blocks`, { ...form, roomTypeId: form.roomTypeId || rooms.data?.[0]?.id, rooms: Number(form.rooms) }), key);
  const release = useApiMutation((id: string) => api.post(`/partner/hotels/${hotelId}/inventory/blocks/${id}/release`), key);
  const stopSell = useApiMutation(() => api.patch(`/partner/hotels/${hotelId}/inventory`, { roomTypeId: closure.roomTypeId || rooms.data?.[0]?.id, from: closure.from, to: closure.to, set: { stopSell: closure.stopSell } }));
  const roomOptions = (rooms.data ?? []).map((r) => ({ value: r.id, label: r.name }));
  const roomName = (id: string) => rooms.data?.find((r) => r.id === id)?.name ?? 'Room';
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Blocks & closures" description="Take rooms out of sale for maintenance, or close dates to new bookings. Existing reservations are never affected." />
      <PropertyPicker value={hotelId} onChange={setHotelId} />
      <SectionCard title="Close dates (stop-sell)">
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); stopSell.mutate(undefined, { onSuccess: () => toast({ title: closure.stopSell ? 'Dates closed to new bookings' : 'Dates reopened', variant: 'success' }), onError: fail('Could not update dates') }); }}>
          <Select label="Room category" options={roomOptions} value={closure.roomTypeId || roomOptions[0]?.value || ''} onChange={(e) => setClosure({ ...closure, roomTypeId: e.target.value })} containerClassName="w-56" />
          <Input type="date" label="From" value={closure.from} onChange={(e) => setClosure({ ...closure, from: e.target.value })} containerClassName="w-44" />
          <Input type="date" label="To" value={closure.to} onChange={(e) => setClosure({ ...closure, to: e.target.value })} containerClassName="w-44" />
          <Select label="Action" options={[{ value: 'close', label: 'Close to new bookings' }, { value: 'open', label: 'Reopen' }]} value={closure.stopSell ? 'close' : 'open'} onChange={(e) => setClosure({ ...closure, stopSell: e.target.value === 'close' })} containerClassName="w-52" />
          <Button type="submit" loading={stopSell.isPending} disabled={!roomOptions.length}>Apply</Button>
        </form>
      </SectionCard>
      <SectionCard title="New maintenance block">
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); create.mutate(undefined, { onSuccess: () => toast({ title: 'Rooms blocked', variant: 'success' }), onError: fail('Could not block rooms') }); }}>
          <Select label="Room category" options={roomOptions} value={form.roomTypeId || roomOptions[0]?.value || ''} onChange={(e) => setForm({ ...form, roomTypeId: e.target.value })} containerClassName="w-56" />
          <Input type="date" label="From" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} containerClassName="w-44" />
          <Input type="date" label="To (inclusive)" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} containerClassName="w-44" />
          <Input type="number" min={1} label="Rooms" value={form.rooms} onChange={(e) => setForm({ ...form, rooms: e.target.value })} containerClassName="w-28" />
          <Select label="Reason" options={[{ value: 'MAINTENANCE', label: 'Maintenance' }, { value: 'RENOVATION', label: 'Renovation' }, { value: 'OWNER_USE', label: 'Owner use' }, { value: 'OTHER', label: 'Other' }]} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} containerClassName="w-44" />
          <Input label="Note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} containerClassName="w-64" />
          <Button type="submit" loading={create.isPending} disabled={!roomOptions.length}>Block rooms</Button>
        </form>
      </SectionCard>
      <SectionCard title="Active blocks">
        <QueryState query={blocks}>
          <DataTable caption="Active blocks" rows={blocks.data} getRowId={(b) => b.id} empty={<EmptyState compact title="No active blocks" />}
            columns={[
              { id: 'r', header: 'Room category', cell: (b) => roomName(b.roomTypeId) },
              { id: 'd', header: 'Dates', cell: (b) => `${b.from} → ${b.to}` },
              { id: 'n', header: 'Rooms', cell: (b) => b.rooms, align: 'right' },
              { id: 'w', header: 'Reason', cell: (b) => <span>{b.reason.replace('_', ' ').toLowerCase()}{b.note && <span className="text-fg-subtle"> — {b.note}</span>}</span> },
              { id: 'a', header: '', cell: (b) => <Button size="sm" variant="ghost" onClick={() => release.mutate(b.id, { onError: fail('Could not release') })}>Release</Button> },
            ]}
          />
        </QueryState>
      </SectionCard>
    </div>
  );
}

// ------------------------------------------------------------------ guest support (shared tickets)
interface PartnerTicket { id: string; ticketNumber: string; subject: string; status: string; bookingReference: string | null; hotel: { name: string }; lastMessageAt: string; messages?: Array<{ id: string; author: string; authorName: string; body: string; createdAt: string }> }
export function PartnerSupportPage() {
  const list = useApiQuery<PartnerTicket[]>(['partner', 'support'], '/partner/support/tickets');
  const [open, setOpen] = useState<string | null>(null);
  const detail = useApiQuery<PartnerTicket>(['partner', 'support', 'detail'], open ? `/partner/support/tickets/${open}` : null);
  const [body, setBody] = useState('');
  const fail = useErrorToast();
  const reply = useApiMutation(() => api.post(`/partner/support/tickets/${open}/messages`, { body }), [['partner', 'support']]);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Guest support" description="Requests the Stayscape support team has shared with your property. Guest contact details stay with Stayscape." />
      <QueryState query={list}>
        {list.data?.length ? (
          <ul className="flex flex-col gap-2">
            {list.data.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => setOpen(open === t.id ? null : t.id)} aria-expanded={open === t.id} className="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-4 text-left hover:bg-surface-muted">
                  <span><span className="font-medium">{t.subject}</span> <span className="text-sm text-fg-subtle">{t.ticketNumber} · {t.hotel.name}{t.bookingReference && ` · ${t.bookingReference}`}</span></span>
                  <StatusBadge status={t.status} />
                </button>
                {open === t.id && (
                  <div className="mt-2 flex flex-col gap-3 rounded-xl border border-border p-4">
                    <QueryState query={detail}>
                      <ol className="flex flex-col gap-2">
                        {detail.data?.messages?.map((m) => (
                          <li key={m.id} className="rounded-lg bg-surface-muted p-3 text-sm"><p className="font-medium">{m.authorName} <span className="text-xs text-fg-subtle">{fmtDateTime(m.createdAt)}</span></p><p className="whitespace-pre-wrap">{m.body}</p></li>
                        ))}
                        {!detail.data?.messages?.length && <li className="text-sm text-fg-subtle">No messages yet.</li>}
                      </ol>
                    </QueryState>
                    <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); reply.mutate(undefined, { onSuccess: () => setBody(''), onError: fail('Could not send') }); }}>
                      <Textarea label="Reply to the support team" value={body} onChange={(e) => setBody(e.target.value)} />
                      <Button type="submit" size="sm" className="self-start" disabled={!body.trim()} loading={reply.isPending}>Send</Button>
                    </form>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No shared requests" description={<>When the support team needs your help with a guest request it appears here. <Link to="/partner/bookings" className="underline">View reservations</Link>.</>} />
        )}
      </QueryState>
      <Badge tone="outline" className="self-start">Internal support notes are never shown here</Badge>
    </div>
  );
}
