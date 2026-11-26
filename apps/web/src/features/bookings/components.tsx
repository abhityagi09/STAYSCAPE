import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CalendarDays, Clock, MapPin, UsersRound } from 'lucide-react';
import {
  BOOKING_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  REFUND_STATUS_LABELS,
  formatMinorUnits,
  type BookingItemDto,
  type BookingStatus,
  type CurrencyCode,
  type ImageDto,
  type PaymentStatus,
  type PriceSnapshotDto,
  type RefundStatus,
} from '@stayscape/shared';
import { Badge } from '@/components/ui';
import { ResponsiveImage } from '@/features/marketplace/components/HotelCard';
import type { PriceBreakdownSource } from '@/features/marketplace/components/PriceBreakdown';
import { cn } from '@/lib/cn';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

const bookingTone: Record<BookingStatus, Tone> = {
  PENDING_PAYMENT: 'warning',
  PAYMENT_PROCESSING: 'info',
  CONFIRMED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
  CHECKED_IN: 'success',
  CHECKED_OUT: 'neutral',
  COMPLETED: 'neutral',
  EXPIRED: 'neutral',
  RECONCILIATION_REQUIRED: 'warning',
};
const paymentTone: Record<PaymentStatus, Tone> = {
  INITIATED: 'neutral',
  PENDING: 'info',
  SUCCESS: 'success',
  FAILED: 'danger',
  REFUND_PENDING: 'info',
  PARTIALLY_REFUNDED: 'info',
  REFUNDED: 'neutral',
};
const refundTone: Record<RefundStatus, Tone> = {
  REQUESTED: 'info',
  APPROVED: 'info',
  PROCESSING: 'info',
  SUCCEEDED: 'success',
  FAILED: 'danger',
  REJECTED: 'neutral',
};

export const BookingStatusBadge = ({ status }: { status: BookingStatus }) => (
  <Badge tone={bookingTone[status]}>{BOOKING_STATUS_LABELS[status]}</Badge>
);
export const PaymentStatusBadge = ({ status }: { status: PaymentStatus }) => (
  <Badge tone={paymentTone[status]}>{PAYMENT_STATUS_LABELS[status]}</Badge>
);
export const RefundStatusBadge = ({ status }: { status: RefundStatus }) => (
  <Badge tone={refundTone[status]}>{REFUND_STATUS_LABELS[status]}</Badge>
);

export const money = (minor: number, currency: CurrencyCode) => formatMinorUnits(minor, currency);

const dayFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
/** Property-local calendar dates are formatted as UTC so the viewer's zone never shifts the day. */
export const formatStayDate = (iso: string) => dayFmt.format(new Date(`${iso}T00:00:00Z`));
export const formatInstant = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function breakdownSource(
  price: PriceSnapshotDto,
  items: BookingItemDto[],
  nights: number,
): PriceBreakdownSource {
  return {
    ...price,
    rooms: items.reduce((s, i) => s + i.rooms, 0),
    nights,
    nightly: items[0]?.nightly ?? [],
  };
}

/**
 * Live countdown to a hold's expiry. Announces only at meaningful thresholds (not every second)
 * so screen readers are not flooded.
 */
export function HoldCountdown({
  expiresAt,
  onExpire,
  className,
}: {
  expiresAt: string;
  onExpire?: () => void;
  className?: string;
}) {
  const target = new Date(expiresAt).getTime();
  const [now, setNow] = useState(() => Date.now());
  const fired = useRef(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const remaining = Math.max(0, target - now);
  useEffect(() => {
    if (remaining === 0 && !fired.current) {
      fired.current = true;
      onExpire?.();
    }
  }, [remaining, onExpire]);
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);
  const label =
    remaining === 0
      ? 'Your hold has expired'
      : `Rooms held for ${minutes}:${String(seconds).padStart(2, '0')}`;
  const announce =
    remaining === 0
      ? 'Your hold has expired'
      : minutes >= 1 && seconds === 0 && [5, 2, 1].includes(minutes)
        ? `${minutes} minute${minutes === 1 ? '' : 's'} left on your hold`
        : null;
  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold',
        remaining === 0
          ? 'bg-danger/10 text-danger'
          : remaining < 120_000
            ? 'bg-warning/15 text-warning'
            : 'bg-primary-soft text-primary',
        className,
      )}
    >
      <Clock className="size-4" aria-hidden="true" />
      <span className="tabular-nums" aria-hidden="true">
        {label}
      </span>
      <span className="sr-only" aria-live="polite">
        {announce ?? ''}
      </span>
      <span className="sr-only">
        {remaining === 0
          ? 'Hold expired'
          : `Hold expires at ${new Date(target).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
      </span>
    </div>
  );
}

export function StaySummary({
  hotel,
  checkIn,
  checkOut,
  nights,
  guests,
  roomLine,
  children,
}: {
  hotel: {
    name: string;
    city: string;
    state: string;
    coverImage: ImageDto | null;
    checkInTime?: string;
    checkOutTime?: string;
  };
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  roomLine: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row">
      <div className="aspect-[4/3] w-full shrink-0 overflow-hidden rounded-xl bg-surface-muted sm:w-40">
        <ResponsiveImage image={hotel.coverImage} sizes="160px" className="size-full" />
      </div>
      <div className="flex min-w-0 flex-col gap-1.5 text-sm">
        <p className="font-display text-lg font-semibold leading-snug">{hotel.name}</p>
        <p className="flex items-center gap-1.5 text-fg-muted">
          <MapPin className="size-4 shrink-0" aria-hidden="true" />
          {hotel.city}, {hotel.state}
        </p>
        <p className="flex items-center gap-1.5">
          <CalendarDays className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
          {formatStayDate(checkIn)} → {formatStayDate(checkOut)} · {nights} night
          {nights === 1 ? '' : 's'}
        </p>
        {hotel.checkInTime && (
          <p className="text-xs text-fg-subtle">
            Check-in from {hotel.checkInTime} · check-out by {hotel.checkOutTime}
          </p>
        )}
        <p className="flex items-center gap-1.5">
          <UsersRound className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
          {guests} guest{guests === 1 ? '' : 's'} · {roomLine}
        </p>
        {children}
      </div>
    </div>
  );
}
