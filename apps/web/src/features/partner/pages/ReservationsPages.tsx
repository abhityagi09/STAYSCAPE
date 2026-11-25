import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, Star } from 'lucide-react';
import type { PartnerBookingDto, PartnerReviewDto } from '@stayscape/shared';
import {
  Alert,
  Badge,
  Button,
  ConfirmationDialog,
  EmptyState,
  ErrorState,
  PageHeader,
  PageSpinner,
  Pagination,
  Select,
  Tabs,
  Textarea,
  useToast,
} from '@/components/ui';
import { partnerBookingsApi } from '@/features/bookings/api';
import {
  BookingStatusBadge,
  PaymentStatusBadge,
  formatInstant,
  formatStayDate,
  money,
} from '@/features/bookings/components';
import { normalizeApiError } from '@/lib/api/errors';
import { usePartnerHotels } from '../api';

function PropertyPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const hotels = usePartnerHotels();
  const options = (hotels.data ?? []).map((h) => ({ value: h.id, label: h.name }));
  const first = options[0]?.value;
  // Default to the first property once the list loads.
  useEffect(() => {
    if (!value && first) onChange(first);
  }, [value, first, onChange]);
  return (
    <Select
      label="Property"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      options={
        options.length
          ? options
          : [{ value: '', label: hotels.isPending ? 'Loading…' : 'No properties' }]
      }
      containerClassName="sm:w-72"
    />
  );
}

type Action = 'check-in' | 'check-out' | 'no-show' | 'reject';

function ReservationRow({
  b,
  onAction,
}: {
  b: PartnerBookingDto;
  onAction: (b: PartnerBookingDto, a: Action) => void;
}) {
  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4 text-sm lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{b.guestName}</span>
          <BookingStatusBadge status={b.status} />
          <PaymentStatusBadge status={b.paymentStatus} />
        </div>
        <span>
          {formatStayDate(b.checkIn)} → {formatStayDate(b.checkOut)} · {b.nights} night
          {b.nights === 1 ? '' : 's'} · {b.guests} guest{b.guests === 1 ? '' : 's'} ·{' '}
          {b.roomSummary}
        </span>
        <span className="text-fg-subtle">
          {b.reference} · {b.guestPhone} · {b.guestEmail}
          {b.estimatedArrivalTime ? ` · arriving ~${b.estimatedArrivalTime}` : ''}
        </span>
        {b.specialRequests && <span className="text-fg-muted">Requests: {b.specialRequests}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-2 font-semibold tabular-nums">{money(b.totalMinor, b.currency)}</span>
        {b.actions.canCheckIn && (
          <Button size="sm" onClick={() => onAction(b, 'check-in')}>
            Check in
          </Button>
        )}
        {b.actions.canCheckOut && (
          <Button size="sm" onClick={() => onAction(b, 'check-out')}>
            Check out
          </Button>
        )}
        {b.actions.canMarkNoShow && (
          <Button size="sm" variant="outline" onClick={() => onAction(b, 'no-show')}>
            No-show
          </Button>
        )}
        {b.status === 'CONFIRMED' && !b.actions.canMarkNoShow && (
          <Button size="sm" variant="ghost" onClick={() => onAction(b, 'reject')}>
            Decline
          </Button>
        )}
      </div>
    </li>
  );
}

/** /partner/reservations */
export function PartnerReservationsPage() {
  const [hotelId, setHotelId] = useState('');
  const [view, setView] = useState('upcoming');
  const [page, setPage] = useState(1);
  const [pending, setPending] = useState<{ booking: PartnerBookingDto; action: Action } | null>(
    null,
  );
  const [reason, setReason] = useState('');
  const { toast } = useToast();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['partner-bookings', hotelId, view, page],
    queryFn: ({ signal }) => partnerBookingsApi.list(hotelId, view, page, signal),
    enabled: Boolean(hotelId),
  });
  const act = useMutation({
    mutationFn: ({ booking, action }: { booking: PartnerBookingDto; action: Action }) =>
      partnerBookingsApi.act(
        hotelId,
        booking.reference,
        action,
        action === 'reject' ? { reason } : action === 'no-show' ? { note: reason } : {},
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['partner-bookings'] });
      toast({ title: 'Reservation updated', variant: 'success' });
      setPending(null);
      setReason('');
    },
    onError: (e) =>
      toast({
        title: 'Action failed',
        description: normalizeApiError(e).message,
        variant: 'error',
      }),
  });
  const confirmCopy: Record<Action, { title: string; body: string; label: string }> = {
    'check-in': {
      title: 'Check this guest in?',
      body: 'Record that the guest has arrived.',
      label: 'Check in',
    },
    'check-out': {
      title: 'Check this guest out?',
      body: 'Record that the guest has left.',
      label: 'Check out',
    },
    'no-show': {
      title: 'Record a no-show?',
      body: 'The booking is cancelled under its no-show policy, any refund due is issued, and remaining nights are released.',
      label: 'Record no-show',
    },
    reject: {
      title: 'Decline this booking?',
      body: 'Only if you cannot honour it. The guest is refunded in full and notified.',
      label: 'Decline booking',
    },
  };
  const list = query.isPending ? (
    hotelId ? (
      <PageSpinner />
    ) : null
  ) : query.error ? (
    <ErrorState
      description={normalizeApiError(query.error).message}
      onRetry={() => void query.refetch()}
    />
  ) : query.data.items.length === 0 ? (
    <EmptyState icon={<CalendarCheck />} title="No reservations here" />
  ) : (
    <>
      <ul className="flex flex-col gap-3">
        {query.data.items.map((b) => (
          <ReservationRow
            key={b.reference}
            b={b}
            onAction={(booking, action) => setPending({ booking, action })}
          />
        ))}
      </ul>
      <Pagination
        className="mt-4"
        page={page}
        totalPages={query.data.pagination.totalPages}
        onPageChange={setPage}
      />
    </>
  );
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reservations"
        description="Confirmed stays for your properties. Unpaid holds are never shown."
        actions={
          <PropertyPicker
            value={hotelId}
            onChange={(id) => {
              setHotelId(id);
              setPage(1);
            }}
          />
        }
      />
      <Tabs
        label="Reservation views"
        value={view}
        onValueChange={(v) => {
          setView(v);
          setPage(1);
        }}
        items={[
          { id: 'arrivals', label: 'Arriving today', content: view === 'arrivals' ? list : null },
          { id: 'upcoming', label: 'Upcoming', content: view === 'upcoming' ? list : null },
          { id: 'past', label: 'Past', content: view === 'past' ? list : null },
          { id: 'all', label: 'All', content: view === 'all' ? list : null },
        ]}
      />
      {pending && (
        <ConfirmationDialog
          open
          title={confirmCopy[pending.action].title}
          description={`${pending.booking.guestName} · ${pending.booking.reference}`}
          confirmLabel={confirmCopy[pending.action].label}
          tone={pending.action === 'reject' || pending.action === 'no-show' ? 'danger' : 'default'}
          loading={act.isPending}
          onCancel={() => setPending(null)}
          onConfirm={() =>
            (pending.action !== 'reject' || reason.trim().length >= 3) && act.mutate(pending)
          }
        >
          <p className="text-sm">{confirmCopy[pending.action].body}</p>
          {(pending.action === 'reject' || pending.action === 'no-show') && (
            <Textarea
              label={pending.action === 'reject' ? 'Reason (shared with the guest)' : 'Note'}
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </ConfirmationDialog>
      )}
    </div>
  );
}

function ReviewItem({ hotelId, review }: { hotelId: string; review: PartnerReviewDto }) {
  const qc = useQueryClient();
  const [body, setBody] = useState(review.response?.body ?? '');
  const [editing, setEditing] = useState(!review.response);
  const respond = useMutation({
    mutationFn: () => partnerBookingsApi.respond(hotelId, review.id, body),
    onSuccess: () => {
      setEditing(false);
      void qc.invalidateQueries({ queryKey: ['partner-reviews', hotelId] });
    },
  });
  return (
    <li className="rounded-2xl border border-border bg-surface p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">
          {review.authorName} · {review.roomTypeName} · stayed {review.stayMonth}
        </span>
        <span className="flex items-center gap-2">
          {review.status === 'FLAGGED' && <Badge tone="warning">Reported — under moderation</Badge>}
          <span className="font-semibold">★ {review.overall.toFixed(1)}</span>
        </span>
      </div>
      <p className="mt-2 font-medium">{review.title}</p>
      <p className="text-fg-muted">{review.body}</p>
      <p className="mt-1 text-xs text-fg-subtle">
        {formatInstant(review.createdAt)} · booking {review.bookingReference}
      </p>
      {editing ? (
        <form
          className="mt-3 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            respond.mutate();
          }}
        >
          <Textarea
            label="Public response"
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            error={respond.error ? normalizeApiError(respond.error).message : undefined}
          />
          <Button
            type="submit"
            size="sm"
            className="self-start"
            disabled={body.trim().length < 5}
            loading={respond.isPending}
          >
            Publish response
          </Button>
        </form>
      ) : (
        <div className="mt-3 rounded-lg bg-surface-muted p-3">
          <span className="font-medium">Your response:</span> {review.response?.body}{' '}
          <Button size="sm" variant="link" onClick={() => setEditing(true)}>
            Edit
          </Button>
        </div>
      )}
    </li>
  );
}

/** /partner/reviews — respond to verified guest reviews (reviews cannot be deleted by owners). */
export function PartnerReviewsPage() {
  const [hotelId, setHotelId] = useState('');
  const query = useQuery({
    queryKey: ['partner-reviews', hotelId],
    queryFn: ({ signal }) => partnerBookingsApi.reviews(hotelId, signal),
    enabled: Boolean(hotelId),
  });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Guest reviews"
        description="Reviews come only from verified, completed stays. You can respond publicly; reviews can only be removed by platform moderators for policy violations."
        actions={<PropertyPicker value={hotelId} onChange={setHotelId} />}
      />
      <Alert tone="info">
        Report a review to moderators through support if it breaks the content policy.
      </Alert>
      {!hotelId ? null : query.isPending ? (
        <PageSpinner />
      ) : query.error ? (
        <ErrorState description={normalizeApiError(query.error).message} />
      ) : query.data.length === 0 ? (
        <EmptyState icon={<Star />} title="No reviews yet" />
      ) : (
        <ul className="flex flex-col gap-3">
          {query.data.map((r) => (
            <ReviewItem key={r.id} hotelId={hotelId} review={r} />
          ))}
        </ul>
      )}
    </div>
  );
}
