import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
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
  Input,
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
import { tr, trf } from '@/lib/tr';

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
      label={tr('Property')}
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
  hotelId,
  onAction,
}: {
  b: PartnerBookingDto;
  hotelId: string;
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
          {formatStayDate(b.checkIn)} → {formatStayDate(b.checkOut)} · {b.nights} {tr('night')}
          {b.nights === 1 ? '' : 's'} · {b.guests} {tr('guest')}
          {b.guests === 1 ? '' : 's'} · {b.roomSummary}
        </span>
        <span className="text-fg-subtle">
          <Link
            to={`/partner/bookings/${hotelId}/${b.reference}`}
            className="font-medium text-primary underline"
          >
            {b.reference}
          </Link>{' '}
          · {b.guestPhone} · {b.guestEmail}
          {b.estimatedArrivalTime ? trf(' · arriving ~{0}', [b.estimatedArrivalTime]) : ''}
        </span>
        {b.specialRequests && (
          <span className="text-fg-muted">
            {tr('Requests:')} {b.specialRequests}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-2 font-semibold tabular-nums">{money(b.totalMinor, b.currency)}</span>
        {b.actions.canCheckIn && (
          <Button size="sm" onClick={() => onAction(b, 'check-in')}>
            {tr('Check in')}
          </Button>
        )}
        {b.actions.canCheckOut && (
          <Button size="sm" onClick={() => onAction(b, 'check-out')}>
            {tr('Check out')}
          </Button>
        )}
        {b.actions.canMarkNoShow && (
          <Button size="sm" variant="outline" onClick={() => onAction(b, 'no-show')}>
            {tr('No-show')}
          </Button>
        )}
        {b.status === 'CONFIRMED' && !b.actions.canMarkNoShow && (
          <Button size="sm" variant="ghost" onClick={() => onAction(b, 'reject')}>
            {tr('Decline')}
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
  const [filters, setFilters] = useState({ q: '', status: '', from: '', to: '' });
  const setFilter = (k: keyof typeof filters, v: string) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(1);
  };
  const [pending, setPending] = useState<{ booking: PartnerBookingDto; action: Action } | null>(
    null,
  );
  const [reason, setReason] = useState('');
  const { toast } = useToast();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['partner-bookings', hotelId, view, page, filters],
    queryFn: ({ signal }) => partnerBookingsApi.list(hotelId, view, page, signal, filters),
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
      toast({ title: tr('Reservation updated'), variant: 'success' });
      setPending(null);
      setReason('');
    },
    onError: (e) =>
      toast({
        title: tr('Action failed'),
        description: normalizeApiError(e).message,
        variant: 'error',
      }),
  });
  const confirmCopy: Record<Action, { title: string; body: string; label: string }> = {
    'check-in': {
      title: tr('Check this guest in?'),
      body: tr('Record that the guest has arrived.'),
      label: tr('Check in'),
    },
    'check-out': {
      title: tr('Check this guest out?'),
      body: tr('Record that the guest has left.'),
      label: tr('Check out'),
    },
    'no-show': {
      title: tr('Record a no-show?'),
      body: tr(
        'The booking is cancelled under its no-show policy, any refund due is issued, and remaining nights are released.',
      ),
      label: tr('Record no-show'),
    },
    reject: {
      title: tr('Decline this booking?'),
      body: tr('Only if you cannot honour it. The guest is refunded in full and notified.'),
      label: tr('Decline booking'),
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
    <EmptyState icon={<CalendarCheck />} title={tr('No reservations here')} />
  ) : (
    <>
      <ul className="flex flex-col gap-3">
        {query.data.items.map((b) => (
          <ReservationRow
            key={b.reference}
            b={b}
            hotelId={hotelId}
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
        title={tr('Reservations')}
        description={tr('Confirmed stays for your properties. Unpaid holds are never shown.')}
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
      <div
        className="flex flex-wrap items-end gap-3"
        role="search"
        aria-label={tr('Filter reservations')}
      >
        <Input
          label={tr('Guest name or reference')}
          value={filters.q}
          onChange={(e) => setFilter('q', e.target.value)}
          containerClassName="w-64"
        />
        <Select
          label={tr('Status')}
          value={filters.status}
          onChange={(e) => setFilter('status', e.target.value)}
          options={[
            '',
            'CONFIRMED',
            'CHECKED_IN',
            'CHECKED_OUT',
            'COMPLETED',
            'CANCELLED',
            'NO_SHOW',
            'REJECTED',
          ].map((s) => ({ value: s, label: s ? s.replace('_', ' ').toLowerCase() : 'Any status' }))}
          containerClassName="w-48"
        />
        <Input
          type="date"
          label={tr('Check-in from')}
          value={filters.from}
          onChange={(e) => setFilter('from', e.target.value)}
          containerClassName="w-44"
        />
        <Input
          type="date"
          label={tr('Check-in to')}
          value={filters.to}
          onChange={(e) => setFilter('to', e.target.value)}
          containerClassName="w-44"
        />
      </div>
      <Tabs
        label={tr('Reservation views')}
        value={view}
        onValueChange={(v) => {
          setView(v);
          setPage(1);
        }}
        items={[
          {
            id: 'arrivals',
            label: tr('Arriving today'),
            content: view === 'arrivals' ? list : null,
          },
          { id: 'in-house', label: tr('In house'), content: view === 'in-house' ? list : null },
          {
            id: 'departures',
            label: tr('Departing today'),
            content: view === 'departures' ? list : null,
          },
          { id: 'upcoming', label: tr('Upcoming'), content: view === 'upcoming' ? list : null },
          { id: 'past', label: tr('Past'), content: view === 'past' ? list : null },
          { id: 'all', label: tr('All'), content: view === 'all' ? list : null },
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
              label={
                pending.action === 'reject' ? tr('Reason (shared with the guest)') : tr('Note')
              }
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
          {review.authorName} · {review.roomTypeName} {tr('· stayed')} {review.stayMonth}
        </span>
        <span className="flex items-center gap-2">
          {review.status === 'FLAGGED' && (
            <Badge tone="warning">{tr('Reported — under moderation')}</Badge>
          )}
          <span className="font-semibold">★ {review.overall.toFixed(1)}</span>
        </span>
      </div>
      <p className="mt-2 font-medium">{review.title}</p>
      <p className="text-fg-muted">{review.body}</p>
      <p className="mt-1 text-xs text-fg-subtle">
        {formatInstant(review.createdAt)} {tr('· booking')} {review.bookingReference}
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
            label={tr('Public response')}
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
            {tr('Publish response')}
          </Button>
        </form>
      ) : (
        <div className="mt-3 rounded-lg bg-surface-muted p-3">
          <span className="font-medium">{tr('Your response:')}</span> {review.response?.body}{' '}
          <Button size="sm" variant="link" onClick={() => setEditing(true)}>
            {tr('Edit')}
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
        title={tr('Guest reviews')}
        description={tr(
          'Reviews come only from verified, completed stays. You can respond publicly; reviews can only be removed by platform moderators for policy violations.',
        )}
        actions={<PropertyPicker value={hotelId} onChange={setHotelId} />}
      />
      <Alert tone="info">
        {tr('Report a review to moderators through support if it breaks the content policy.')}
      </Alert>
      {!hotelId ? null : query.isPending ? (
        <PageSpinner />
      ) : query.error ? (
        <ErrorState description={normalizeApiError(query.error).message} />
      ) : query.data.length === 0 ? (
        <EmptyState icon={<Star />} title={tr('No reviews yet')} />
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

/** /partner/bookings/:hotelId/:reference — reservation detail for front-desk operations. */
export function PartnerReservationDetailPage() {
  const { hotelId = '', reference = '' } = useParams();
  const qc = useQueryClient();
  const { toast } = useToast();
  const key = ['partner-booking', hotelId, reference];
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => partnerBookingsApi.detail(hotelId, reference, signal),
  });
  const [note, setNote] = useState('');
  const [rooms, setRooms] = useState<Record<string, string>>({});
  const fail = (title: string) => (e: unknown) =>
    toast({ title, description: normalizeApiError(e).message, variant: 'error' });
  const refresh = () => void qc.invalidateQueries({ queryKey: key });
  const addNote = useMutation({
    mutationFn: () => partnerBookingsApi.addNote(hotelId, reference, note),
    onSuccess: () => {
      setNote('');
      refresh();
    },
    onError: fail('Could not add the note'),
  });
  const assign = useMutation({
    mutationFn: () =>
      partnerBookingsApi.assignRooms(
        hotelId,
        reference,
        Object.entries(rooms)
          .map(([roomTypeId, v]) => ({
            roomTypeId,
            roomNumbers: v
              .split(',')
              .map((x) => x.trim())
              .filter(Boolean),
          }))
          .filter((a) => a.roomNumbers.length),
      ),
    onSuccess: () => {
      toast({ title: tr('Rooms assigned'), variant: 'success' });
      refresh();
    },
    onError: fail('Could not assign rooms'),
  });
  const act = useMutation({
    mutationFn: (a: Action) => partnerBookingsApi.act(hotelId, reference, a),
    onSuccess: refresh,
    onError: fail('Action failed'),
  });
  if (query.isPending) return <PageSpinner />;
  if (query.error)
    return (
      <ErrorState
        description={normalizeApiError(query.error).message}
        onRetry={() => void query.refetch()}
      />
    );
  const b = query.data;
  const g = b.guestDetails;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${b.guestName} · ${b.reference}`}
        description={trf('{0} → {1} · {2} night{3} · {4}', [
          formatStayDate(b.checkIn),
          formatStayDate(b.checkOut),
          b.nights,
          b.nights === 1 ? '' : 's',
          b.roomSummary,
        ])}
        breadcrumb={[
          { label: tr('Reservations'), to: '/partner/bookings' },
          { label: b.reference },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            <BookingStatusBadge status={b.status} />
            <PaymentStatusBadge status={b.paymentStatus} />
            {b.actions.canCheckIn && (
              <Button size="sm" loading={act.isPending} onClick={() => act.mutate('check-in')}>
                {tr('Check in')}
              </Button>
            )}
            {b.actions.canCheckOut && (
              <Button size="sm" loading={act.isPending} onClick={() => act.mutate('check-out')}>
                {tr('Check out')}
              </Button>
            )}
          </div>
        }
      />
      <section
        aria-labelledby="guest"
        className="grid gap-3 rounded-2xl border border-border p-4 text-sm sm:grid-cols-2"
      >
        <h2 id="guest" className="font-semibold sm:col-span-2">
          {tr('Guest')}
        </h2>
        <p>
          {g.primaryGuest.firstName} {g.primaryGuest.lastName} · {g.primaryGuest.phone} ·{' '}
          {g.primaryGuest.email}
        </p>
        {g.additionalGuests.length > 0 && (
          <p>
            {tr('Also staying:')}{' '}
            {g.additionalGuests.map((x) => `${x.firstName} ${x.lastName}`).join(', ')}
          </p>
        )}
        {g.estimatedArrivalTime && (
          <p>
            {tr('Arriving around')} {g.estimatedArrivalTime}
          </p>
        )}
        {g.specialRequests && (
          <p className="sm:col-span-2">
            {tr('Requests:')} {g.specialRequests}
          </p>
        )}
        <p>
          {tr('Checked in:')}{' '}
          {b.checkedInAt
            ? `${formatInstant(b.checkedInAt)}${b.checkedInBy ? ` by ${b.checkedInBy}` : ''}`
            : '—'}
        </p>
        <p>
          {tr('Checked out:')}{' '}
          {b.checkedOutAt
            ? `${formatInstant(b.checkedOutAt)}${b.checkedOutBy ? ` by ${b.checkedOutBy}` : ''}`
            : '—'}
        </p>
      </section>
      <section
        aria-labelledby="payment"
        className="flex flex-col gap-2 rounded-2xl border border-border p-4 text-sm"
      >
        <h2 id="payment" className="font-semibold">
          {tr('Payment')}
        </h2>
        <p>
          {tr('Total')} {money(b.price.totals.totalMinor, b.price.currency)}
          {b.price.coupon ? trf(' (coupon {0}, funded by Stayscape)', [b.price.coupon.code]) : ''}
        </p>
        {b.payments.map((p, i) => (
          <p key={i}>
            {formatInstant(p.createdAt)} · {money(p.amountMinor, p.currency)} ·{' '}
            {p.status.toLowerCase()}
            {p.refundedMinor ? trf(' · refunded {0}', [money(p.refundedMinor, p.currency)]) : ''}
          </p>
        ))}
        {b.refunds.map((r, i) => (
          <p key={i}>
            {tr('Refund')} {money(r.amountMinor, r.currency)} · {r.status.toLowerCase()} ·{' '}
            {r.reason}
          </p>
        ))}
        {b.cancellation && (
          <p>
            {tr('Cancelled: charge')}{' '}
            {money(b.cancellation.cancellationChargeMinor, b.cancellation.currency)}
            {tr(', refundable')}{' '}
            {money(b.cancellation.refundableAmountMinor, b.cancellation.currency)}
          </p>
        )}
      </section>
      <section
        aria-labelledby="rooms"
        className="flex flex-col gap-3 rounded-2xl border border-border p-4 text-sm"
      >
        <h2 id="rooms" className="font-semibold">
          {tr('Room assignment')}
        </h2>
        {b.items.map((item) => {
          const current =
            b.roomAssignments
              .find((a) => a.roomTypeId === item.roomTypeId)
              ?.roomNumbers.join(', ') ?? '';
          return (
            <Input
              key={item.roomTypeId}
              label={trf('{0}: {1} room number{2} (comma separated)', [
                item.roomTypeName,
                item.rooms,
                item.rooms === 1 ? '' : 's',
              ])}
              value={rooms[item.roomTypeId] ?? current}
              onChange={(e) => setRooms({ ...rooms, [item.roomTypeId]: e.target.value })}
            />
          );
        })}
        <Button
          size="sm"
          className="self-start"
          loading={assign.isPending}
          disabled={!Object.keys(rooms).length}
          onClick={() => assign.mutate()}
        >
          {tr('Save room assignment')}
        </Button>
      </section>
      <section
        aria-labelledby="notes"
        className="flex flex-col gap-3 rounded-2xl border border-border p-4 text-sm"
      >
        <h2 id="notes" className="font-semibold">
          {tr('Internal notes')}
        </h2>
        <ol className="flex flex-col gap-2">
          {b.notes.length ? (
            b.notes.map((n) => (
              <li key={n.id} className="rounded-lg bg-surface-muted p-2">
                <span className="font-medium">{n.authorName}</span>{' '}
                <span className="text-fg-subtle">{formatInstant(n.createdAt)}</span>
                <p className="whitespace-pre-wrap">{n.body}</p>
              </li>
            ))
          ) : (
            <li className="text-fg-subtle">
              {tr('No notes yet. Notes are visible to your team only.')}
            </li>
          )}
        </ol>
        <Textarea label={tr('Add a note')} value={note} onChange={(e) => setNote(e.target.value)} />
        <Button
          size="sm"
          className="self-start"
          loading={addNote.isPending}
          disabled={!note.trim()}
          onClick={() => addNote.mutate()}
        >
          {tr('Add note')}
        </Button>
      </section>
      <section
        aria-labelledby="timeline"
        className="flex flex-col gap-2 rounded-2xl border border-border p-4 text-sm"
      >
        <h2 id="timeline" className="font-semibold">
          {tr('Timeline')}
        </h2>
        <ol className="flex flex-col gap-1">
          {b.timeline.map((t, i) => (
            <li key={i}>
              {formatInstant(t.at)} · {t.label}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
