import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Send } from 'lucide-react';
import { LOYALTY_RULES, REFERRAL_RULES, type AssistantReplyDto, type LoyaltySummaryDto, type PriceAlertDto, type RecommendationsDto, type ReferralSummaryDto, type SharedTripDto, type TripDto } from '@stayscape/shared';
import { Alert, Badge, Button, Checkbox, DataTable, EmptyState, Input, PageHeader, Select, Textarea, useToast } from '@/components/ui';
import { normalizeApiError } from '@/lib/api/errors';
import { useI18n } from '@/lib/i18n';
import { api, downloadFile, useApiMutation, useApiQuery, type Page } from './api';
import { KpiGrid, KpiTile, QueryState, SectionCard, StatusBadge, fmtDate, fmtMoney, fmtPct } from './components';

function useFail() {
  const { toast } = useToast();
  return (title: string) => (e: unknown) => toast({ title, description: normalizeApiError(e).message, variant: 'error' });
}

// ------------------------------------------------------------------ TripSpace
export function TripsPage() {
  const { t } = useI18n();
  const trips = useApiQuery<TripDto[]>(['trips'], '/trips');
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('trips.title')} description={t('trips.description')} actions={<Link to="/trips/new" className="rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-fg">{t('trips.new')}</Link>} />
      <QueryState query={trips}>
        {trips.data?.length ? (
          <ul className="grid gap-4 sm:grid-cols-2">
            {trips.data.map((trip) => (
              <li key={trip.id} className="flex flex-col gap-1 rounded-2xl border border-border p-5">
                <Link to={`/trips/${trip.id}`} className="font-display text-xl hover:underline">{trip.title}</Link>
                <p className="text-sm text-fg-muted">{trip.destination || 'Destination to decide'} · {trip.startDate ? `${fmtDate(trip.startDate)} – ${fmtDate(trip.endDate)}` : 'Dates to decide'}</p>
                <p className="text-xs text-fg-subtle">{trip.items.length} item(s) · {trip.members.length} {trip.members.length === 1 ? 'person' : 'people'} · you are {trip.myRole.toLowerCase()}</p>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No trips yet" description="Create a trip to collect stays, bookings and notes in one place." action={<Link to="/trips/new" className="text-primary underline">{t('trips.new')}</Link>} />
        )}
      </QueryState>
    </div>
  );
}

export function TripFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const existing = useApiQuery<TripDto>(['trips', id], id ? `/trips/${id}` : null);
  const [f, setF] = useState({ title: '', destination: '', description: '', startDate: '', endDate: '' });
  useEffect(() => {
    if (existing.data) setF({ title: existing.data.title, destination: existing.data.destination, description: existing.data.description, startDate: existing.data.startDate ?? '', endDate: existing.data.endDate ?? '' });
  }, [existing.data]);
  const fail = useFail();
  const save = useApiMutation(() => {
    const body = { ...f, startDate: f.startDate || null, endDate: f.endDate || null };
    return id ? api.put<TripDto>(`/trips/${id}`, body) : api.post<TripDto>('/trips', body);
  }, [['trips']]);
  const invalidDates = Boolean(f.startDate && f.endDate && f.endDate < f.startDate);
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <PageHeader title={id ? 'Edit trip' : 'New trip'} breadcrumb={[{ label: 'TripSpace', to: '/trips' }, { label: id ? 'Edit' : 'New' }]} />
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined, { onSuccess: (trip) => navigate(`/trips/${trip.id}`), onError: fail('Could not save the trip') }); }}>
        <Input label="Trip name" required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <Input label="Destination" value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })} />
        <div className="flex flex-wrap gap-3">
          <Input type="date" label="Start" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} containerClassName="w-48" />
          <Input type="date" label="End" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} containerClassName="w-48" error={invalidDates ? 'End must be on or after the start' : undefined} />
        </div>
        <Textarea label="Notes for everyone" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        <Button type="submit" className="self-start" loading={save.isPending} disabled={f.title.trim().length < 2 || invalidDates}>Save trip</Button>
      </form>
    </div>
  );
}

export function TripDetailPage() {
  const { id = '' } = useParams();
  const trip = useApiQuery<TripDto>(['trips', id], `/trips/${id}`);
  const fail = useFail();
  const { toast } = useToast();
  const navigate = useNavigate();
  const key = [['trips']];
  const [note, setNote] = useState({ title: '', note: '', date: '' });
  const [bookingRef, setBookingRef] = useState('');
  const [invite, setInvite] = useState({ email: '', role: 'VIEWER' });
  const [links, setLinks] = useState<{ invite?: string; share?: string }>({});
  const add = useApiMutation((body: object) => api.post(`/trips/${id}/items`, body), key);
  const remove = useApiMutation((itemId: string) => api.del(`/trips/${id}/items/${itemId}`), key);
  const sendInvite = useApiMutation(() => api.post<{ token: string }>(`/trips/${id}/invitations`, invite), key);
  const share = useApiMutation((enabled: boolean) => api.put<{ token: string | null }>(`/trips/${id}/sharing`, { enabled }), key);
  const leave = useApiMutation((memberId: string) => api.del(`/trips/${id}/members/${memberId}`), key);
  const del = useApiMutation(() => api.del(`/trips/${id}`), key);
  const d = trip.data;
  const canEdit = d?.myRole === 'OWNER' || d?.myRole === 'EDITOR';
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return (
    <QueryState query={trip}>
      {d && (
        <div className="flex flex-col gap-6">
          <PageHeader
            title={d.title}
            description={`${d.destination || 'Destination to decide'} · ${d.startDate ? `${fmtDate(d.startDate)} – ${fmtDate(d.endDate)}` : 'Dates to decide'}`}
            breadcrumb={[{ label: 'TripSpace', to: '/trips' }, { label: d.title }]}
            actions={canEdit && <Link to={`/trips/${id}/edit`} className="text-sm text-primary underline">Edit details</Link>}
          />
          {d.description && <p className="whitespace-pre-wrap text-fg-muted">{d.description}</p>}
          <SectionCard title="Plan">
            {d.items.length ? (
              <ol className="flex flex-col gap-2">
                {d.items.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-border p-3">
                    <div>
                      <p className="font-medium">{i.hotel ? <Link to={`/hotels/${i.hotel.slug}`} className="hover:underline">{i.title}</Link> : i.title} <Badge tone="outline">{i.kind.toLowerCase()}</Badge></p>
                      {i.booking && <p className="text-sm">{i.booking.reference} · {i.booking.checkIn} → {i.booking.checkOut} · <StatusBadge status={i.booking.status} /></p>}
                      {i.date && !i.booking && <p className="text-sm text-fg-muted">{fmtDate(i.date)}</p>}
                      {i.note && <p className="text-sm whitespace-pre-wrap text-fg-muted">{i.note}</p>}
                      <p className="text-xs text-fg-subtle">Added by {i.addedBy}</p>
                    </div>
                    {canEdit && <Button size="sm" variant="ghost" onClick={() => remove.mutate(i.id, { onError: fail('Could not remove') })}>Remove</Button>}
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState compact title="Nothing planned yet" description="Save stays from any property page, or add a booking or a note." />
            )}
            {canEdit && (
              <div className="grid gap-4 border-t border-border pt-4 md:grid-cols-2">
                <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); add.mutate({ kind: 'NOTE', title: note.title, note: note.note, date: note.date || null }, { onSuccess: () => setNote({ title: '', note: '', date: '' }), onError: fail('Could not add the note') }); }}>
                  <Input label="Note title" value={note.title} onChange={(e) => setNote({ ...note, title: e.target.value })} />
                  <Input type="date" label="Date (optional)" value={note.date} onChange={(e) => setNote({ ...note, date: e.target.value })} />
                  <Textarea label="Details" value={note.note} onChange={(e) => setNote({ ...note, note: e.target.value })} />
                  <Button type="submit" size="sm" className="self-start" disabled={!note.title.trim()}>Add note</Button>
                </form>
                <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); add.mutate({ kind: 'BOOKING', bookingReference: bookingRef.trim().toUpperCase() }, { onSuccess: () => setBookingRef(''), onError: fail('Could not add the booking') }); }}>
                  <Input label="Add one of your bookings (reference)" placeholder="SS-XXXXXXXX" value={bookingRef} onChange={(e) => setBookingRef(e.target.value)} hint="Companions see the property, dates and status — never prices or guest details." />
                  <Button type="submit" size="sm" className="self-start" disabled={!/^SS-[A-Z0-9]{8}$/i.test(bookingRef.trim())}>Add booking</Button>
                </form>
              </div>
            )}
          </SectionCard>
          <SectionCard title="People">
            <ul className="flex flex-col gap-1 text-sm">
              {d.members.map((m) => (
                <li key={m.userId} className="flex items-center justify-between gap-2">
                  <span>{m.name} <Badge tone="outline">{m.role.toLowerCase()}</Badge></span>
                  {d.myRole === 'OWNER' && m.role !== 'OWNER' && <Button size="sm" variant="ghost" onClick={() => leave.mutate(m.userId, { onError: fail('Could not remove') })}>Remove</Button>}
                </li>
              ))}
            </ul>
            {d.myRole === 'OWNER' ? (
              <>
                <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); sendInvite.mutate(undefined, { onSuccess: (r) => { setLinks({ ...links, invite: `${origin}/trips/join?token=${r.token}` }); setInvite({ email: '', role: 'VIEWER' }); }, onError: fail('Could not invite') }); }}>
                  <Input type="email" label="Invite by email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} containerClassName="w-72" />
                  <Select label="Can" value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })} options={[{ value: 'VIEWER', label: 'View' }, { value: 'EDITOR', label: 'Edit' }]} containerClassName="w-32" />
                  <Button type="submit" size="sm" disabled={!invite.email}>Create invitation</Button>
                </form>
                {links.invite && <Alert tone="info" title="Send this link to them">Only the invited email address can use it, once, within 14 days: <code className="break-all">{links.invite}</code></Alert>}
                <div className="flex flex-wrap items-center gap-2">
                  <Checkbox label="Read-only share link (hotels and dates only)" checked={d.shared} onChange={(e) => share.mutate(e.target.checked, { onSuccess: (r) => setLinks({ ...links, share: r.token ? `${origin}/trips/shared/${r.token}` : undefined }), onError: fail('Could not change sharing') })} />
                </div>
                {links.share && <Alert tone="info" title="Share link">{links.share}</Alert>}
                <Button size="sm" variant="ghost" className="self-start text-danger" onClick={() => del.mutate(undefined, { onSuccess: () => { toast({ title: 'Trip deleted' }); navigate('/trips'); }, onError: fail('Could not delete') })}>Delete trip</Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" className="self-start" onClick={() => { const me = d.members.find((m) => m.role === d.myRole); if (me) leave.mutate(me.userId, { onSuccess: () => navigate('/trips'), onError: fail('Could not leave') }); }}>Leave this trip</Button>
            )}
          </SectionCard>
        </div>
      )}
    </QueryState>
  );
}

export function TripJoinPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const fail = useFail();
  const accept = useApiMutation(() => api.post<TripDto>('/trips/invitations/accept', { token: params.get('token') }), [['trips']]);
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <PageHeader title="Join a trip" description="Accept the invitation to see and help plan this trip." />
      <Button className="self-start" loading={accept.isPending} disabled={!params.get('token')} onClick={() => accept.mutate(undefined, { onSuccess: (t) => navigate(`/trips/${t.id}`), onError: fail('Could not join the trip') })}>Accept invitation</Button>
    </div>
  );
}

export function SharedTripPage() {
  const { token = '' } = useParams();
  const q = useApiQuery<SharedTripDto>(['trips', 'shared', token], `/trips/shared/${token}`);
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
      <QueryState query={q}>
        {q.data && (
          <>
            <PageHeader title={q.data.title} description={`${q.data.destination} ${q.data.startDate ? `· ${fmtDate(q.data.startDate)} – ${fmtDate(q.data.endDate)}` : ''}`} />
            {q.data.description && <p className="whitespace-pre-wrap">{q.data.description}</p>}
            <ul className="flex flex-col gap-2">
              {q.data.items.map((i, n) => <li key={n} className="rounded-xl border border-border p-3">{i.hotel ? <Link to={`/hotels/${i.hotel.slug}`} className="font-medium hover:underline">{i.title}</Link> : i.title}{i.hotel && <span className="text-sm text-fg-muted"> · {i.hotel.city}</span>}</li>)}
            </ul>
          </>
        )}
      </QueryState>
    </div>
  );
}

// ------------------------------------------------------------------ rewards
export function RewardsPage() {
  const { t } = useI18n();
  const loyalty = useApiQuery<LoyaltySummaryDto>(['rewards', 'loyalty'], '/rewards/loyalty');
  const referrals = useApiQuery<ReferralSummaryDto>(['rewards', 'referrals'], '/rewards/referrals');
  const [points, setPoints] = useState(String(LOYALTY_RULES.minRedeemPoints));
  const [code, setCode] = useState('');
  const [issued, setIssued] = useState<{ code: string; valueMinor: number; expiresAt: string | null } | null>(null);
  const fail = useFail();
  const redeem = useApiMutation(() => api.post<{ code: string; valueMinor: number; expiresAt: string | null }>('/rewards/loyalty/redeem', { points: Number(points) }), [['rewards']]);
  const claim = useApiMutation(() => api.post('/rewards/referrals/claim', { code }), [['rewards']]);
  const l = loyalty.data;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('rewards.title')} description={`Earn 1 point for every ₹100 of room charges on completed stays. Each point is worth ₹${LOYALTY_RULES.redeemValueMinorPerPoint / 100} off a future booking.`} />
      <QueryState query={loyalty}>
        {l && (
          <>
            <KpiGrid>
              <KpiTile label={t('rewards.balance')} value={l.balance.toLocaleString('en-IN')} hint={`Worth ${fmtMoney(l.balance * l.pointValueMinor)}`} />
              <KpiTile label={t('rewards.tier')} value={l.tier.toLowerCase()} hint={l.nextTier ? `${l.nextTier.pointsNeeded.toLocaleString('en-IN')} points to ${l.nextTier.tier.toLowerCase()}` : 'Highest tier'} />
              <KpiTile label="Earned in 12 months" value={l.last12MonthsEarned.toLocaleString('en-IN')} />
              <KpiTile label="Lifetime earned" value={l.lifetimeEarned.toLocaleString('en-IN')} />
            </KpiGrid>
            <SectionCard title="Redeem points" description={`Turn at least ${LOYALTY_RULES.minRedeemPoints} points into a single-use coupon valid for ${LOYALTY_RULES.redeemCouponValidDays} days. Unused coupons return the points.`}>
              <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); redeem.mutate(undefined, { onSuccess: setIssued, onError: fail('Could not redeem') }); }}>
                <Input type="number" min={LOYALTY_RULES.minRedeemPoints} step={100} label="Points" value={points} onChange={(e) => setPoints(e.target.value)} containerClassName="w-40" />
                <Button type="submit" loading={redeem.isPending} disabled={Number(points) < LOYALTY_RULES.minRedeemPoints || Number(points) > l.balance}>Get coupon worth {fmtMoney(Number(points) * l.pointValueMinor || 0)}</Button>
              </form>
              {issued && <Alert tone="success" title="Your coupon">Use code <strong className="font-mono">{issued.code}</strong> at checkout for {fmtMoney(issued.valueMinor)} off{issued.expiresAt && ` before ${fmtDate(issued.expiresAt)}`}.</Alert>}
            </SectionCard>
            <SectionCard title="Points history">
              <DataTable caption="Points history" rows={l.entries} getRowId={(e) => e.id} empty={<EmptyState compact title="No points yet" description="Points arrive after your stay is completed." />}
                columns={[
                  { id: 'd', header: 'Date', cell: (e) => fmtDate(e.createdAt) },
                  { id: 'w', header: 'Activity', cell: (e) => e.description },
                  { id: 'p', header: 'Points', cell: (e) => (e.points > 0 ? `+${e.points}` : e.points), align: 'right' },
                ]}
              />
            </SectionCard>
          </>
        )}
      </QueryState>
      <QueryState query={referrals}>
        {referrals.data && (
          <SectionCard title="Refer a friend" description={`When a friend you refer completes their first stay of ₹${REFERRAL_RULES.minQualifyingSubtotalMinor / 100} or more, you get ${REFERRAL_RULES.referrerPoints} points and they get ${REFERRAL_RULES.refereePoints}.`}>
            <p>Your code: <strong className="font-mono text-lg">{referrals.data.code}</strong> <span className="text-sm text-fg-subtle">({referrals.data.rewardedThisYear} of {referrals.data.limitPerYear} rewards used this year)</span></p>
            {referrals.data.referrals.length > 0 && (
              <ul className="flex flex-col gap-1 text-sm">{referrals.data.referrals.map((r, i) => <li key={i}>{r.refereeInitials} · joined {fmtDate(r.joinedAt)} · <StatusBadge status={r.status} />{r.reason && <span className="text-fg-muted"> — {r.reason}</span>}</li>)}</ul>
            )}
            {!referrals.data.referredBy && (
              <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); claim.mutate(undefined, { onError: fail('Could not add the code') }); }}>
                <Input label="Were you referred? Enter their code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} containerClassName="w-64" hint={`New accounts only, within ${REFERRAL_RULES.claimWindowDays} days of joining and before a first booking.`} />
                <Button type="submit" size="sm" disabled={code.length < 6}>Add code</Button>
              </form>
            )}
            {referrals.data.referredBy && <p className="text-sm">Referral code added · <StatusBadge status={referrals.data.referredBy.status} /></p>}
          </SectionCard>
        )}
      </QueryState>
    </div>
  );
}

// ------------------------------------------------------------------ price alerts & recommendations
export function PriceAlertsPage() {
  const { t } = useI18n();
  const alerts = useApiQuery<PriceAlertDto[]>(['price-alerts'], '/price-alerts');
  const fail = useFail();
  const remove = useApiMutation((id: string) => api.del(`/price-alerts/${id}`), [['price-alerts']]);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('alerts.title')} description="We re-check live prices and notify you once for each new low (at most once a day). Add alerts from any property page." />
      <QueryState query={alerts}>
        <DataTable caption="Price alerts" rows={alerts.data} getRowId={(a) => a.id} empty={<EmptyState compact title="No alerts yet" />}
          columns={[
            { id: 'h', header: 'Property', cell: (a) => a.hotelName },
            { id: 'd', header: 'Stay', cell: (a) => `${a.checkIn} → ${a.checkOut} · ${a.adults} adult(s)` },
            { id: 'b', header: 'When added', cell: (a) => fmtMoney(a.baselineTotalMinor, a.currency ?? 'INR'), align: 'right' },
            { id: 'n', header: 'Latest', cell: (a) => fmtMoney(a.lastSeenTotalMinor, a.currency ?? 'INR'), align: 'right' },
            { id: 't', header: 'Target', cell: (a) => (a.targetTotalMinor ? fmtMoney(a.targetTotalMinor, a.currency ?? 'INR') : 'Any drop') },
            { id: 's', header: 'Status', cell: (a) => <StatusBadge status={a.active ? 'ACTIVE' : 'EXPIRED'} /> },
            { id: 'x', header: '', cell: (a) => <Button size="sm" variant="ghost" onClick={() => remove.mutate(a.id, { onError: fail('Could not remove') })}>Remove</Button> },
          ]}
        />
      </QueryState>
    </div>
  );
}

export function RecommendationsPanel() {
  const q = useApiQuery<RecommendationsDto>(['recommendations'], '/recommendations', { limit: 6 });
  if (!q.data?.items.length) return null;
  return (
    <SectionCard title={q.data.personalized ? 'Picked for you' : 'Popular stays'} description={q.data.personalized ? 'Based only on your own bookings and saved stays. You can turn this off in Settings.' : 'Turn on personalised recommendations in Settings to see picks based on your stays.'}>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {q.data.items.map(({ hotel, reasons }) => (
          <li key={hotel.id} className="flex flex-col gap-1 rounded-xl border border-border p-3">
            <Link to={`/hotels/${hotel.slug}`} className="font-medium hover:underline">{hotel.name}</Link>
            <span className="text-sm text-fg-muted">{hotel.city}</span>
            <ul className="text-xs text-fg-subtle">{reasons.map((r) => <li key={r}>• {r}</li>)}</ul>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

// ------------------------------------------------------------------ corporate
interface Org { id: string; name: string; status: string; statusReason: string | null; myRole: 'ORG_ADMIN' | 'APPROVER' | 'EMPLOYEE'; policy: { maxNightlyMinor: number | null; maxStarCategory: number | null; allowedCities: string[]; minAdvanceDays: number; approvalRequiredAboveMinor: number | null; monthlyBudgetMinor: number | null } }
interface TravelRequest { id: string; employee: { name: string | null }; hotel: { name: string; city: string }; checkIn: string; checkOut: string; purpose: string; quotedTotalMinor: number; nightlyMinor: number; currency: string; violations: string[]; status: string; decisionNote: string | null }
function RequestsTable({ scope, org }: { scope: 'mine' | 'org'; org: Org }) {
  const list = useApiQuery<Page<TravelRequest>>(['corporate', 'requests', scope], '/corporate/requests', { scope });
  const [ref, setRef] = useState<Record<string, string>>({});
  const fail = useFail();
  const key = [['corporate']];
  const decide = useApiMutation((v: { id: string; decision: string; note: string }) => api.post(`/corporate/requests/${v.id}/decision`, { decision: v.decision, note: v.note }), key);
  const link = useApiMutation((v: { id: string; ref: string }) => api.post(`/corporate/requests/${v.id}/booking`, { bookingReference: v.ref }), key);
  return (
    <DataTable caption={scope === 'mine' ? 'My travel requests' : 'Team travel requests'} rows={list.data?.items} loading={list.isPending} getRowId={(r) => r.id} empty={<EmptyState compact title="No requests" />}
      columns={[
        ...(scope === 'org' ? [{ id: 'e', header: 'Employee', cell: (r: TravelRequest) => r.employee.name ?? '—' }] : []),
        { id: 'h', header: 'Stay', cell: (r) => <span>{r.hotel.name}, {r.hotel.city}<span className="block text-xs text-fg-subtle">{r.checkIn} → {r.checkOut} · {r.purpose}</span></span> },
        { id: 'p', header: 'Quoted', cell: (r) => <span>{fmtMoney(r.quotedTotalMinor, r.currency)}<span className="block text-xs text-fg-subtle">{fmtMoney(r.nightlyMinor, r.currency)}/night</span></span>, align: 'right' },
        { id: 'v', header: 'Policy', cell: (r) => (r.violations.length ? r.violations.map((v) => <Badge key={v} tone="warning" className="mr-1">{v.replace(/_/g, ' ').toLowerCase()}</Badge>) : <Badge tone="success">within policy</Badge>) },
        { id: 's', header: 'Status', cell: (r) => <span className="flex flex-col"><StatusBadge status={r.status} />{r.decisionNote && <span className="text-xs text-fg-muted">{r.decisionNote}</span>}</span> },
        {
          id: 'x', header: '', cell: (r) => scope === 'org' && r.status === 'PENDING' && org.myRole !== 'EMPLOYEE' ? (
            <span className="flex gap-1"><Button size="sm" onClick={() => decide.mutate({ id: r.id, decision: 'APPROVE', note: '' }, { onError: fail('Could not approve') })}>Approve</Button><Button size="sm" variant="ghost" onClick={() => decide.mutate({ id: r.id, decision: 'REJECT', note: 'Outside travel policy' }, { onError: fail('Could not reject') })}>Reject</Button></span>
          ) : scope === 'mine' && ['APPROVED', 'AUTO_APPROVED'].includes(r.status) ? (
            <span className="flex gap-1"><Input label="Booking reference" hideLabel placeholder="SS-XXXXXXXX" value={ref[r.id] ?? ''} onChange={(e) => setRef({ ...ref, [r.id]: e.target.value.toUpperCase() })} containerClassName="w-36" /><Button size="sm" variant="ghost" onClick={() => link.mutate({ id: r.id, ref: ref[r.id] ?? '' }, { onError: fail('Could not link the booking') })}>Link booking</Button></span>
          ) : null,
        },
      ]}
    />
  );
}
export function CorporatePage() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const org = useApiQuery<Org>(['corporate', 'org'], '/corporate/organization');
  const fail = useFail();
  const { toast } = useToast();
  const key = [['corporate']];
  const [createForm, setCreateForm] = useState({ name: '', billingEmail: '', gstin: '' });
  const [req, setReq] = useState({ hotelId: '', roomTypeId: '', ratePlanId: '', checkIn: '', checkOut: '', adults: '1', purpose: '' });
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('EMPLOYEE');
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [policy, setPolicy] = useState({ maxNightly: '', approvalAbove: '', budget: '', minAdvanceDays: '0', cities: '' });
  const create = useApiMutation(() => api.post('/corporate/organizations', { ...createForm, gstin: createForm.gstin || null }), key);
  const accept = useApiMutation(() => api.post('/corporate/invitations/accept', { token: params.get('token') }), key);
  const request = useApiMutation(() => api.post('/corporate/requests', { ...req, adults: Number(req.adults) }), key);
  const invite = useApiMutation(() => api.post<{ token: string }>('/corporate/invitations', { email: inviteEmail, role: inviteRole }), key);
  const savePolicy = useApiMutation(() => api.put('/corporate/organization/policy', {
    maxNightlyMinor: policy.maxNightly ? Math.round(Number(policy.maxNightly) * 100) : null,
    approvalRequiredAboveMinor: policy.approvalAbove ? Math.round(Number(policy.approvalAbove) * 100) : null,
    monthlyBudgetMinor: policy.budget ? Math.round(Number(policy.budget) * 100) : null,
    minAdvanceDays: Number(policy.minAdvanceDays) || 0,
    allowedCities: policy.cities.split(',').map((c) => c.trim()).filter(Boolean),
    maxStarCategory: null,
  }), key);
  const notMember = org.isError && normalizeApiError(org.error).status === 404;
  const o = org.data;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('corporate.title')} description="Book work trips within your company’s policy, with approvals and invoices in one place." />
      {notMember ? (
        <>
          {params.get('token') && <SectionCard title="You have been invited"><Button className="self-start" loading={accept.isPending} onClick={() => accept.mutate(undefined, { onError: fail('Could not accept') })}>Join the organisation</Button></SectionCard>}
          <SectionCard title="Set up your company" description="Stayscape verifies the business before employees can request travel.">
            <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); create.mutate(undefined, { onError: fail('Could not create') }); }}>
              <Input label="Company name" value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} containerClassName="w-64" />
              <Input type="email" label="Billing email" value={createForm.billingEmail} onChange={(e) => setCreateForm({ ...createForm, billingEmail: e.target.value })} containerClassName="w-64" />
              <Input label="GSTIN (optional)" value={createForm.gstin} onChange={(e) => setCreateForm({ ...createForm, gstin: e.target.value.toUpperCase() })} containerClassName="w-56" />
              <Button type="submit" loading={create.isPending} disabled={createForm.name.length < 2 || !createForm.billingEmail}>Create</Button>
            </form>
          </SectionCard>
        </>
      ) : (
        <QueryState query={org}>
          {o && (
            <>
              <p className="flex items-center gap-2"><strong>{o.name}</strong> <StatusBadge status={o.status} /> <Badge tone="outline">{o.myRole.replace('_', ' ').toLowerCase()}</Badge></p>
              {o.status !== 'ACTIVE' && <Alert tone="warning" title={o.status === 'SUSPENDED' ? 'Suspended' : 'Awaiting verification'}>{o.statusReason ?? 'Stayscape is verifying this business. Travel requests open once it is approved.'}</Alert>}
              {o.status === 'ACTIVE' && (
                <SectionCard title="Request a trip" description="Copy the property, room and rate ids from the property page. The price is quoted live and checked against your policy.">
                  <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); request.mutate(undefined, { onSuccess: () => toast({ title: 'Request submitted', variant: 'success' }), onError: fail('Could not submit') }); }}>
                    <Input label="Property id" value={req.hotelId} onChange={(e) => setReq({ ...req, hotelId: e.target.value })} containerClassName="w-60" />
                    <Input label="Room id" value={req.roomTypeId} onChange={(e) => setReq({ ...req, roomTypeId: e.target.value })} containerClassName="w-60" />
                    <Input label="Rate id" value={req.ratePlanId} onChange={(e) => setReq({ ...req, ratePlanId: e.target.value })} containerClassName="w-60" />
                    <Input type="date" label="Check-in" value={req.checkIn} onChange={(e) => setReq({ ...req, checkIn: e.target.value })} containerClassName="w-44" />
                    <Input type="date" label="Check-out" value={req.checkOut} onChange={(e) => setReq({ ...req, checkOut: e.target.value })} containerClassName="w-44" />
                    <Input type="number" min={1} label="Adults" value={req.adults} onChange={(e) => setReq({ ...req, adults: e.target.value })} containerClassName="w-24" />
                    <Input label="Purpose" value={req.purpose} onChange={(e) => setReq({ ...req, purpose: e.target.value })} containerClassName="w-72" />
                    <Button type="submit" loading={request.isPending} disabled={req.purpose.length < 5}>Submit request</Button>
                  </form>
                </SectionCard>
              )}
              <SectionCard title="My requests"><RequestsTable scope="mine" org={o} /></SectionCard>
              {o.myRole !== 'EMPLOYEE' && <SectionCard title="Team requests"><RequestsTable scope="org" org={o} /></SectionCard>}
              {o.myRole === 'ORG_ADMIN' && (
                <>
                  <SectionCard title="Travel policy" description={`Current: ${o.policy.maxNightlyMinor ? `max ${fmtMoney(o.policy.maxNightlyMinor)}/night` : 'no nightly cap'} · ${o.policy.monthlyBudgetMinor ? `budget ${fmtMoney(o.policy.monthlyBudgetMinor)}/month` : 'no budget'} · approval above ${o.policy.approvalRequiredAboveMinor ? fmtMoney(o.policy.approvalRequiredAboveMinor) : 'never (within policy)'}`}>
                    <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); savePolicy.mutate(undefined, { onSuccess: () => toast({ title: 'Policy saved', variant: 'success' }), onError: fail('Could not save') }); }}>
                      <Input label="Max per night (₹)" inputMode="decimal" value={policy.maxNightly} onChange={(e) => setPolicy({ ...policy, maxNightly: e.target.value })} containerClassName="w-40" />
                      <Input label="Approval above (₹)" inputMode="decimal" value={policy.approvalAbove} onChange={(e) => setPolicy({ ...policy, approvalAbove: e.target.value })} containerClassName="w-40" />
                      <Input label="Monthly budget (₹)" inputMode="decimal" value={policy.budget} onChange={(e) => setPolicy({ ...policy, budget: e.target.value })} containerClassName="w-40" />
                      <Input label="Book at least (days ahead)" inputMode="numeric" value={policy.minAdvanceDays} onChange={(e) => setPolicy({ ...policy, minAdvanceDays: e.target.value })} containerClassName="w-48" />
                      <Input label="Allowed cities (comma separated)" value={policy.cities} onChange={(e) => setPolicy({ ...policy, cities: e.target.value })} containerClassName="w-72" />
                      <Button type="submit" loading={savePolicy.isPending}>Save policy</Button>
                    </form>
                  </SectionCard>
                  <SectionCard title="Invite people">
                    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); invite.mutate(undefined, { onSuccess: (r) => setInviteLink(`${window.location.origin}/account/corporate?token=${r.token}`), onError: fail('Could not invite') }); }}>
                      <Input type="email" label="Email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} containerClassName="w-72" />
                      <Select label="Role" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} options={[{ value: 'EMPLOYEE', label: 'Employee' }, { value: 'APPROVER', label: 'Approver' }, { value: 'ORG_ADMIN', label: 'Administrator' }]} containerClassName="w-44" />
                      <Button type="submit" size="sm" disabled={!inviteEmail}>Create invitation</Button>
                    </form>
                    {inviteLink && <Alert tone="info" title="Invitation link">Valid for 14 days for that email address only: <code className="break-all">{inviteLink}</code></Alert>}
                    <p className="text-sm"><Link to="/account/corporate/reports" className="text-primary underline">Spend report and invoices</Link></p>
                  </SectionCard>
                </>
              )}
            </>
          )}
        </QueryState>
      )}
    </div>
  );
}

export function CorporateReportsPage() {
  const now = new Date().toISOString().slice(0, 10);
  const [period, setPeriod] = useState({ from: `${now.slice(0, 7)}-01`, to: now });
  const report = useApiQuery<{ spendMinor: number; inPolicyRateBp: number | null; requests: Record<string, number>; byDepartment: Array<{ department: string; spendMinor: number; bookings: number }> }>(['corporate', 'report'], '/corporate/reports', period);
  const invoices = useApiQuery<Array<{ requestId: string; bookingReference: string | null; hotelName: string; checkIn: string; totalMinor: number | null; currency: string; status: string | null }>>(['corporate', 'invoices'], '/corporate/invoices');
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Spend & invoices" breadcrumb={[{ label: 'Corporate travel', to: '/account/corporate' }, { label: 'Reports' }]} />
      <div className="flex flex-wrap gap-3">
        <Input type="date" label="From" value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} containerClassName="w-44" />
        <Input type="date" label="To" value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} containerClassName="w-44" />
      </div>
      <QueryState query={report}>
        {report.data && (
          <>
            <KpiGrid>
              <KpiTile label="Spend" value={fmtMoney(report.data.spendMinor)} />
              <KpiTile label="Within policy" value={fmtPct(report.data.inPolicyRateBp)} />
              <KpiTile label="Requests" value={report.data.requests.total ?? 0} hint={`${report.data.requests.pending ?? 0} pending`} />
              <KpiTile label="Booked" value={report.data.requests.booked ?? 0} />
            </KpiGrid>
            <DataTable caption="Spend by department" rows={report.data.byDepartment} getRowId={(d) => d.department} empty={<EmptyState compact title="No booked travel in this period" />}
              columns={[{ id: 'd', header: 'Department', cell: (d) => d.department }, { id: 'b', header: 'Bookings', cell: (d) => d.bookings, align: 'right' }, { id: 's', header: 'Spend', cell: (d) => fmtMoney(d.spendMinor), align: 'right' }]} />
          </>
        )}
      </QueryState>
      <SectionCard title="Invoices">
        <DataTable caption="Invoices" rows={invoices.data} loading={invoices.isPending} getRowId={(i) => i.requestId} empty={<EmptyState compact title="No booked trips yet" />}
          columns={[
            { id: 'r', header: 'Booking', cell: (i) => i.bookingReference ?? '—' },
            { id: 'h', header: 'Property', cell: (i) => i.hotelName },
            { id: 'd', header: 'Check-in', cell: (i) => i.checkIn },
            { id: 't', header: 'Total', cell: (i) => fmtMoney(i.totalMinor, i.currency), align: 'right' },
            { id: 'x', header: '', cell: (i) => (i.bookingReference ? <Button size="sm" variant="link" onClick={() => void downloadFile(`/corporate/invoices/${i.bookingReference}`, `invoice-${i.bookingReference}.pdf`)}>Download</Button> : null) },
          ]}
        />
      </SectionCard>
    </div>
  );
}

// ------------------------------------------------------------------ AI assistant
interface Turn { role: 'user' | 'assistant'; content: string; reply?: AssistantReplyDto }
export function AssistantPage() {
  const { t } = useI18n();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [message, setMessage] = useState('');
  const fail = useFail();
  const endRef = useRef<HTMLDivElement>(null);
  // History is captured when the message is sent (not when the request runs), so the new message is never duplicated in it.
  const send = useApiMutation((v: { text: string; history: Turn[] }) => api.post<AssistantReplyDto>('/assistant/messages', { message: v.text, history: v.history.slice(-10).map(({ role, content }) => ({ role, content: content.slice(0, 2000) })) }));
  useEffect(() => endRef.current?.scrollIntoView?.({ block: 'end' }), [turns]);
  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const history = turns;
    setTurns((ts) => [...ts, { role: 'user', content: trimmed }]);
    setMessage('');
    send.mutate({ text: trimmed, history }, { onSuccess: (reply) => setTurns((ts) => [...ts, { role: 'assistant', content: reply.answer, reply }]), onError: fail('The assistant could not answer') });
  };
  const last = [...turns].reverse().find((x) => x.reply)?.reply;
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <PageHeader title={t('assistant.title')} description={t('assistant.disclaimer')} />
      <section aria-label="Conversation" aria-live="polite" className="flex min-h-64 flex-col gap-3 rounded-2xl border border-border p-4">
        {turns.length === 0 && <p className="text-sm text-fg-subtle">Try: “A quiet stay in Udaipur for 2 adults from the 12th to the 14th next month”.</p>}
        {turns.map((turn, i) => (
          <div key={i} className={turn.role === 'user' ? 'self-end rounded-2xl bg-primary px-4 py-2 text-primary-fg' : 'flex flex-col gap-2 self-start rounded-2xl bg-surface-muted px-4 py-3'}>
            <p className="whitespace-pre-wrap">{turn.content}</p>
            {turn.reply && (
              <>
                {turn.reply.degraded && <Badge tone="outline" className="self-start">Basic search mode</Badge>}
                {turn.reply.hotels.length > 0 && (
                  <ul className="flex flex-col gap-1 text-sm">
                    {turn.reply.hotels.map((h) => <li key={h.id}><Link to={`/hotels/${h.slug}`} className="font-medium text-primary underline">{h.name}</Link> · {h.city}{h.price && ` · ${fmtMoney(h.price.totalMinor, h.price.currency)} total`}</li>)}
                  </ul>
                )}
                {turn.reply.quotes.map((q, j) => <p key={j} className="text-sm">Quote: {q.hotelName}, {q.roomTypeName} ({q.ratePlanName}), {q.checkIn} → {q.checkOut}: <strong>{fmtMoney(q.totalMinor, q.currency)}</strong></p>)}
              </>
            )}
          </div>
        ))}
        {send.isPending && <p className="text-sm text-fg-subtle" role="status">Searching Stayscape…</p>}
        <div ref={endRef} />
      </section>
      {last?.followUpQuestions.length ? (
        <div className="flex flex-wrap gap-2">{last.followUpQuestions.map((q) => <Button key={q} size="sm" variant="outline" onClick={() => setMessage(q)}>{q}</Button>)}</div>
      ) : null}
      <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); submit(message); }}>
        <Textarea label={t('assistant.placeholder')} value={message} maxLength={1000} onChange={(e) => setMessage(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(message); } }} />
        <Button type="submit" loading={send.isPending} disabled={!message.trim()} aria-label={t('assistant.send')}><Send className="size-4" aria-hidden="true" /></Button>
      </form>
      {last && <p className="text-xs text-fg-subtle">{last.usage.remainingToday} messages left today.</p>}
    </div>
  );
}
