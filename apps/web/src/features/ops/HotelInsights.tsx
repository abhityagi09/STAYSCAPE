import { useState } from 'react';
import { Link } from 'react-router';
import { Accessibility, BadgeCheck, ShieldCheck } from 'lucide-react';
import { addDays, todayInTimeZone, type CurrencyCode, type HotelDetailDto, type PriceCalendarDayDto, type TripDto } from '@stayscape/shared';
import { Alert, Badge, Button, Input, Select, useToast } from '@/components/ui';
import { useAuth } from '@/features/auth/use-auth';
import { normalizeApiError } from '@/lib/api/errors';
import { api, useApiMutation, useApiQuery } from './api';
import { fmtDate, fmtMoney } from './components';

interface Rates { available: boolean; publishedOn?: string; rates?: Record<string, number>; disclaimer?: string; reason?: string }

/** Approximate conversion for display only, from ECB reference rates; never used for charging. */
export function ApproxPrice({ amountMinor, currency }: { amountMinor: number; currency: CurrencyCode }) {
  const { user } = useAuth();
  const target = user?.preferences.currency;
  const rates = useApiQuery<Rates>(['currency', 'rates'], target && target !== currency ? '/currency/rates' : null);
  const r = rates.data;
  if (!target || target === currency || !r?.available || !r.rates?.[currency] || !r.rates[target]) return null;
  const converted = Math.round((amountMinor / r.rates[currency]!) * r.rates[target]!);
  return (
    <span className="text-xs text-fg-subtle" title={r.disclaimer}>
      ≈ {fmtMoney(converted, target)} (ECB reference rate {r.publishedOn}; you pay in {currency})
    </span>
  );
}

function TrustScoreCard({ hotel }: { hotel: HotelDetailDto }) {
  const t = hotel.trustScore;
  if (!t) return null;
  return (
    <section aria-labelledby="trust" className="flex flex-col gap-3">
      <h2 id="trust" className="flex items-center gap-2 font-display text-2xl font-semibold"><ShieldCheck className="size-6" aria-hidden="true" /> TrustScore</h2>
      <p className="text-sm text-fg-muted">
        {t.score === null ? 'Not enough stays or reviews yet to give a score.' : <><strong className="text-2xl text-fg">{t.score}</strong>/100 · confidence {t.confidence.toLowerCase()}</>} · based on {t.basis.reviews} review(s) and {t.basis.completedStays} completed stay(s) on Stayscape.
      </p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {t.components.map((c) => (
          <li key={c.key} className="rounded-xl border border-border p-3 text-sm">
            <div className="flex items-center justify-between"><span className="font-medium">{c.label}</span><span className="tabular-nums">{c.score}<span className="text-fg-subtle">/100 · {c.weight}%</span></span></div>
            <div className="mt-1 h-1.5 rounded-full bg-surface-muted" aria-hidden="true"><div className="h-full rounded-full bg-primary" style={{ width: `${c.score}%` }} /></div>
            <p className="mt-1 text-xs text-fg-subtle">{c.detail}</p>
          </li>
        ))}
      </ul>
      <p className="text-xs text-fg-subtle">Calculated only from Stayscape’s own records; properties cannot pay to change it.</p>
    </section>
  );
}

function AccessibilitySection({ hotel }: { hotel: HotelDetailDto }) {
  return (
    <section aria-labelledby="accessibility" className="flex flex-col gap-3">
      <h2 id="accessibility" className="flex items-center gap-2 font-display text-2xl font-semibold"><Accessibility className="size-6" aria-hidden="true" /> Accessibility</h2>
      {hotel.accessibility.length ? (
        <ul className="flex flex-col gap-2">
          {hotel.accessibility.map((f) => (
            <li key={f.code} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{f.label}</span>
              {f.source === 'ADMIN_VERIFIED' ? (
                <Badge tone="success"><BadgeCheck className="size-3.5" aria-hidden="true" /> Checked by Stayscape {f.verifiedAt && `on ${fmtDate(f.verifiedAt)}`}</Badge>
              ) : (
                <Badge tone="outline">Stated by the property</Badge>
              )}
              {f.note && <span className="text-fg-muted">— {f.note}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-fg-muted">The property has not provided accessibility information. Contact it before booking if you have specific needs.</p>
      )}
    </section>
  );
}

function FlexibleDates({ hotel }: { hotel: HotelDetailDto }) {
  const start = addDays(todayInTimeZone(hotel.timeZone), 1);
  const [from, setFrom] = useState(start);
  const [nights, setNights] = useState('1');
  const days = useApiQuery<PriceCalendarDayDto[]>(['price-calendar', hotel.slug], `/price-intelligence/${hotel.slug}/calendar`, { from, to: addDays(from, 13), nights: Number(nights) });
  const min = Math.min(...(days.data ?? []).filter((d) => d.lowestTotalMinor !== null).map((d) => d.lowestTotalMinor!));
  return (
    <section aria-labelledby="flexible" className="flex flex-col gap-3">
      <h2 id="flexible" className="font-display text-2xl font-semibold">Flexible dates</h2>
      <div className="flex flex-wrap items-end gap-3">
        <Input type="date" label="Starting" value={from} min={start} onChange={(e) => setFrom(e.target.value)} containerClassName="w-44" />
        <Select label="Nights" value={nights} onChange={(e) => setNights(e.target.value)} options={['1', '2', '3', '4', '5', '7'].map((n) => ({ value: n, label: `${n} night${n === '1' ? '' : 's'}` }))} containerClassName="w-32" />
      </div>
      {days.isPending ? <p className="text-sm text-fg-subtle" role="status">Checking prices…</p> : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7" aria-label="Lowest total price by check-in date">
          {days.data?.map((d) => (
            <li key={d.checkIn} className={d.lowestTotalMinor === min ? 'rounded-lg border-2 border-primary p-2 text-sm' : 'rounded-lg border border-border p-2 text-sm'}>
              <span className="block text-xs text-fg-subtle">{fmtDate(d.checkIn)}</span>
              {d.available ? <span className="font-medium tabular-nums">{fmtMoney(d.lowestTotalMinor, d.currency ?? hotel.currency)}</span> : <span className="text-fg-subtle">Unavailable</span>}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-fg-subtle">Totals for 2 adults including taxes, from live rates. The lowest is outlined.</p>
    </section>
  );
}

function WatchAndSave({ hotel }: { hotel: HotelDetailDto }) {
  const { isAuthenticated } = useAuth();
  const { toast } = useToast();
  const start = addDays(todayInTimeZone(hotel.timeZone), 7);
  const [checkIn, setCheckIn] = useState(start);
  const [checkOut, setCheckOut] = useState(addDays(start, 2));
  const [tripId, setTripId] = useState('');
  const trips = useApiQuery<TripDto[]>(['trips'], isAuthenticated ? '/trips' : null);
  const fail = (title: string) => (e: unknown) => toast({ title, description: normalizeApiError(e).message, variant: 'error' });
  const watch = useApiMutation(() => api.post('/price-alerts', { hotelId: hotel.id, checkIn, checkOut }), [['price-alerts']]);
  const save = useApiMutation(() => api.post(`/trips/${tripId || trips.data?.[0]?.id}/items`, { kind: 'HOTEL', hotelId: hotel.id, date: null }), [['trips']]);
  if (!isAuthenticated) return <Alert tone="info" title="Watch this stay"><Link to="/login" className="underline">Sign in</Link> to get price-drop alerts or add it to a trip.</Alert>;
  const editable = (trips.data ?? []).filter((t) => t.myRole !== 'VIEWER');
  return (
    <section aria-labelledby="watch" className="flex flex-col gap-3 rounded-2xl border border-border p-4">
      <h2 id="watch" className="text-lg font-semibold">Watch the price or plan a trip</h2>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); watch.mutate(undefined, { onSuccess: () => toast({ title: 'Price alert added', description: 'We will notify you when the total drops.', variant: 'success' }), onError: fail('Could not add the alert') }); }}>
        <Input type="date" label="Check-in" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} containerClassName="w-44" />
        <Input type="date" label="Check-out" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} containerClassName="w-44" />
        <Button type="submit" size="sm" variant="outline" loading={watch.isPending} disabled={checkOut <= checkIn}>Alert me if it drops</Button>
      </form>
      {editable.length > 0 ? (
        <div className="flex flex-wrap items-end gap-2">
          <Select label="Trip" value={tripId || editable[0]!.id} onChange={(e) => setTripId(e.target.value)} options={editable.map((t) => ({ value: t.id, label: t.title }))} containerClassName="w-56" />
          <Button size="sm" variant="ghost" loading={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: () => toast({ title: 'Added to your trip', variant: 'success' }), onError: fail('Could not add to the trip') })}>Add to trip</Button>
        </div>
      ) : (
        <p className="text-sm"><Link to="/trips/new" className="text-primary underline">Create a trip</Link> to save this stay with others.</p>
      )}
    </section>
  );
}

export function HotelInsights({ hotel }: { hotel: HotelDetailDto }) {
  return (
    <>
      <AccessibilitySection hotel={hotel} />
      <TrustScoreCard hotel={hotel} />
      <FlexibleDates hotel={hotel} />
      <WatchAndSave hotel={hotel} />
    </>
  );
}
