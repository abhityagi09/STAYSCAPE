import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import {
  CalendarCheck,
  CircleAlert,
  Clock,
  Download,
  Heart,
  LifeBuoy,
  ReceiptText,
  Star,
  Wallet,
} from 'lucide-react';
import {
  BOOKING_STATUSES,
  BOOKING_STATUS_LABELS,
  type BookingDetailDto,
  type BookingStatus,
  type BookingSummaryDto,
} from '@stayscape/shared';
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmationDialog,
  EmptyState,
  ErrorState,
  Modal,
  PageHeader,
  PageSpinner,
  Pagination,
  SearchInput,
  Select,
  Skeleton,
  Tabs,
  Textarea,
  useToast,
} from '@/components/ui';
import { PriceBreakdown } from '@/features/marketplace/components/PriceBreakdown';
import { ResponsiveImage } from '@/features/marketplace/components/HotelCard';
import { normalizeApiError } from '@/lib/api/errors';
import { useAuth } from '@/features/auth/use-auth';
import { AccountChecklist } from '@/features/account/pages/AccountPages';
import { EmailVerificationBanner } from '@/features/account/components/EmailVerificationBanner';
import {
  bookingsApi,
  downloadFile,
  stickyKey,
  useBookingDetail,
  useBookings,
  useInvalidateBooking,
  useOverview,
  usePayments,
  useRefunds,
} from '../api';
import {
  BookingStatusBadge,
  PaymentStatusBadge,
  RefundStatusBadge,
  StaySummary,
  breakdownSource,
  formatInstant,
  formatStayDate,
  money,
} from '../components';
import { ReviewEditor } from './AccountExtrasPages';

function StatTile({
  label,
  value,
  icon: Icon,
  to,
}: {
  label: string;
  value: number;
  icon: typeof Star;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span className="inline-flex size-10 items-center justify-center rounded-full bg-primary-soft text-primary">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <span>
        <span className="block text-2xl font-semibold tabular-nums">{value}</span>
        <span className="text-sm text-fg-muted">{label}</span>
      </span>
    </Link>
  );
}

export function BookingRow({ booking }: { booking: BookingSummaryDto }) {
  return (
    <li>
      <Link
        to={`/account/bookings/${booking.reference}`}
        className="flex gap-4 rounded-2xl border border-border bg-surface p-3 transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-ring"
      >
        <div className="hidden aspect-[4/3] w-28 shrink-0 overflow-hidden rounded-xl bg-surface-muted sm:block">
          <ResponsiveImage image={booking.hotel.coverImage} sizes="112px" className="size-full" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{booking.hotel.name}</span>
            <BookingStatusBadge status={booking.status} />
          </div>
          <span className="text-fg-muted">
            {formatStayDate(booking.checkIn)} → {formatStayDate(booking.checkOut)} ·{' '}
            {booking.nights} night{booking.nights === 1 ? '' : 's'} · {booking.guests} guest
            {booking.guests === 1 ? '' : 's'}
          </span>
          <span className="text-fg-subtle">
            {booking.reference} · {booking.roomSummary}
          </span>
        </div>
        <div className="flex flex-col items-end justify-between text-sm">
          <span className="font-semibold tabular-nums">
            {money(booking.totalMinor, booking.currency)}
          </span>
          {booking.actions.canPay && (
            <span className="text-xs font-semibold text-warning">Payment due</span>
          )}
          {booking.actions.canReview && (
            <span className="text-xs font-semibold text-primary">Write a review</span>
          )}
        </div>
      </Link>
    </li>
  );
}

/** /account — overview built only from the signed-in customer's records. */
export function AccountOverviewPage() {
  const { user } = useAuth();
  const query = useOverview();
  if (!user || query.isPending) return <PageSpinner label="Loading your account" />;
  if (query.error)
    return (
      <ErrorState
        description={normalizeApiError(query.error).message}
        onRetry={() => void query.refetch()}
      />
    );
  const o = query.data;
  const setupDone = user.emailVerified && Boolean(user.phone) && Boolean(user.avatarUrl);
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Your account"
        title={`Hello, ${user.firstName}`}
        description="Trips, payments and everything you have saved."
      />
      <EmailVerificationBanner user={user} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Upcoming stays"
          value={o.counts.upcoming}
          icon={CalendarCheck}
          to="/account/bookings?view=upcoming"
        />
        <StatTile
          label="Awaiting payment"
          value={o.counts.pending}
          icon={Clock}
          to="/account/bookings?view=pending"
        />
        <StatTile
          label="Completed stays"
          value={o.counts.completed}
          icon={ReceiptText}
          to="/account/bookings?view=past"
        />
        <StatTile
          label="Cancelled"
          value={o.counts.cancelled}
          icon={CircleAlert}
          to="/account/bookings?view=cancelled"
        />
        <StatTile
          label="Reviews to write"
          value={o.counts.pendingReviews}
          icon={Star}
          to="/account/reviews"
        />
        <StatTile
          label="Saved hotels"
          value={o.counts.savedHotels}
          icon={Heart}
          to="/account/wishlists"
        />
        <StatTile
          label="Open support requests"
          value={o.counts.openTickets}
          icon={LifeBuoy}
          to="/account/support"
        />
      </div>
      {o.pending.length > 0 && (
        <section aria-labelledby="pending-title" className="flex flex-col gap-3">
          <h2 id="pending-title" className="text-lg font-semibold">
            Needs your attention
          </h2>
          <ul className="flex flex-col gap-3">
            {o.pending.map((b) => (
              <BookingRow key={b.reference} booking={b} />
            ))}
          </ul>
        </section>
      )}
      <section aria-labelledby="upcoming-title" className="flex flex-col gap-3">
        <h2 id="upcoming-title" className="text-lg font-semibold">
          Upcoming stays
        </h2>
        {o.upcoming.length ? (
          <ul className="flex flex-col gap-3">
            {o.upcoming.map((b) => (
              <BookingRow key={b.reference} booking={b} />
            ))}
          </ul>
        ) : (
          <EmptyState
            compact
            icon={<CalendarCheck />}
            title="No upcoming stays"
            description="When you book, your trip will appear here."
            action={
              <ButtonLink size="sm" to="/hotels">
                Find a stay
              </ButtonLink>
            }
          />
        )}
      </section>
      {o.pendingReviews.length > 0 && (
        <section aria-labelledby="reviews-title" className="flex flex-col gap-3">
          <h2 id="reviews-title" className="text-lg font-semibold">
            Tell us about your stay
          </h2>
          <ul className="flex flex-col gap-3">
            {o.pendingReviews.map((b) => (
              <BookingRow key={b.reference} booking={b} />
            ))}
          </ul>
        </section>
      )}
      {!setupDone && <AccountChecklist user={user} />}
      <section aria-labelledby="activity-title" className="flex flex-col gap-3">
        <h2 id="activity-title" className="text-lg font-semibold">
          Recent activity
        </h2>
        {o.recentActivity.length ? (
          <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
            {o.recentActivity.map((a) => (
              <li key={a.id} className="flex flex-col gap-0.5 p-4 text-sm">
                <span className="font-medium">
                  {a.resource?.type === 'Booking' ? (
                    <Link className="hover:underline" to={`/account/bookings/${a.resource.id}`}>
                      {a.title}
                    </Link>
                  ) : (
                    a.title
                  )}
                </span>
                <span className="text-fg-muted">{a.body}</span>
                <span className="text-xs text-fg-subtle">{formatInstant(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-fg-muted">No activity yet.</p>
        )}
      </section>
    </div>
  );
}

const VIEWS = [
  { id: 'all', label: 'All' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'pending', label: 'Awaiting payment' },
  { id: 'past', label: 'Past' },
  { id: 'cancelled', label: 'Cancelled' },
];

/** /account/bookings — history with search, view tabs and status filter (all in the URL). */
export function BookingsListPage() {
  const [params, setParams] = useSearchParams();
  const view = VIEWS.some((v) => v.id === params.get('view')) ? params.get('view')! : 'all';
  const status = BOOKING_STATUSES.includes(params.get('status') as BookingStatus)
    ? (params.get('status') as BookingStatus)
    : undefined;
  const q = params.get('q') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const query = useBookings({ page, view, status, q: q || undefined });
  const [search, setSearch] = useState(q);
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next);
  };
  const list = (
    <div className="flex flex-col gap-4">
      {query.isPending ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      ) : query.error ? (
        <ErrorState
          description={normalizeApiError(query.error).message}
          onRetry={() => void query.refetch()}
        />
      ) : query.data.items.length === 0 ? (
        <EmptyState
          icon={<CalendarCheck />}
          title="No bookings here"
          description={
            q || status ? 'Try another search or filter.' : 'Bookings you make will appear here.'
          }
          action={
            <ButtonLink size="sm" to="/hotels">
              Find a stay
            </ButtonLink>
          }
        />
      ) : (
        <>
          <ul className="flex flex-col gap-3" aria-busy={query.isFetching}>
            {query.data.items.map((b) => (
              <BookingRow key={b.reference} booking={b} />
            ))}
          </ul>
          <Pagination
            page={page}
            totalPages={query.data.pagination.totalPages}
            onPageChange={(p) => set({ page: String(p) })}
          />
        </>
      )}
    </div>
  );
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Bookings" description="Every reservation on your account." />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <SearchInput
          label="Search bookings"
          placeholder="Reference, property or city"
          value={search}
          onValueChange={setSearch}
          onSearch={(value: string) => set({ q: value.trim() || null })}
          containerClassName="sm:max-w-sm"
        />
        <Select
          label="Status"
          value={status ?? ''}
          onChange={(e) => set({ status: e.target.value || null })}
          options={[
            { value: '', label: 'Any status' },
            ...BOOKING_STATUSES.map((s) => ({ value: s, label: BOOKING_STATUS_LABELS[s] })),
          ]}
          containerClassName="sm:w-56"
        />
      </div>
      <Tabs
        label="Booking views"
        value={view}
        onValueChange={(id) => set({ view: id === 'all' ? null : id })}
        items={VIEWS.map((v) => ({
          id: v.id,
          label: v.label,
          content: v.id === view ? list : null,
        }))}
      />
    </div>
  );
}

function CancelDialog({
  booking,
  open,
  onClose,
}: {
  booking: BookingDetailDto;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const invalidate = useInvalidateBooking();
  const [reason, setReason] = useState('');
  const quote = useMutation({ mutationFn: () => bookingsApi.cancellationQuote(booking.reference) });
  const cancel = useMutation({
    mutationFn: () =>
      bookingsApi.cancel(booking.reference, reason, stickyKey(`cancel.${booking.reference}`)),
    onSuccess: (result) => {
      invalidate(booking.reference);
      toast({
        title: 'Booking cancelled',
        description:
          result.refundableMinor > 0
            ? `${money(result.refundableMinor, booking.currency)} will be refunded.`
            : 'No refund is due under the policy.',
        variant: 'success',
      });
      onClose();
    },
    onError: (e) =>
      toast({
        title: 'Could not cancel',
        description: normalizeApiError(e).message,
        variant: 'error',
      }),
  });
  const { mutate: loadQuote, reset: resetQuote } = quote;
  useEffect(() => {
    if (open) loadQuote();
    else resetQuote();
  }, [open, loadQuote, resetQuote]);
  const q = quote.data;
  return (
    <ConfirmationDialog
      open={open}
      title="Cancel this booking?"
      tone="danger"
      confirmLabel="Cancel booking"
      cancelLabel="Keep booking"
      loading={cancel.isPending}
      onCancel={onClose}
      onConfirm={() => q?.eligible && cancel.mutate()}
    >
      {!q ? (
        quote.isError ? (
          <Alert tone="danger">{normalizeApiError(quote.error).message}</Alert>
        ) : (
          <p className="text-sm">Checking the cancellation policy…</p>
        )
      ) : !q.eligible ? (
        <Alert tone="warning">{q.reason}</Alert>
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          <p>{q.policySummary}</p>
          <dl className="grid grid-cols-2 gap-2 rounded-xl bg-surface-muted p-3">
            <dt>Paid</dt>
            <dd className="text-right tabular-nums">{money(q.paidMinor, q.currency)}</dd>
            <dt>Cancellation charge</dt>
            <dd className="text-right tabular-nums">{money(q.chargeMinor, q.currency)}</dd>
            <dt className="font-semibold">Refund</dt>
            <dd className="text-right font-semibold tabular-nums">
              {money(q.refundableMinor, q.currency)}
            </dd>
          </dl>
          <Textarea
            label="Reason (optional)"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      )}
    </ConfirmationDialog>
  );
}

function RefundRequestDialog({
  booking,
  open,
  onClose,
}: {
  booking: BookingDetailDto;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const invalidate = useInvalidateBooking();
  const [reason, setReason] = useState('');
  const request = useMutation({
    mutationFn: () => bookingsApi.requestRefund(booking.reference, reason),
    onSuccess: () => {
      invalidate(booking.reference);
      toast({
        title: 'Refund request sent',
        description: 'Our team will review it and email you.',
        variant: 'success',
      });
      onClose();
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Request a refund"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button
            loading={request.isPending}
            disabled={reason.trim().length < 10}
            onClick={() => request.mutate()}
          >
            Send request
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <p>
          Requests outside the cancellation policy are reviewed by our team. Explain what happened.
        </p>
        <Textarea
          label="Reason"
          rows={4}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          error={request.error ? normalizeApiError(request.error).message : undefined}
        />
      </div>
    </Modal>
  );
}

/** /account/bookings/:reference — full details with status-specific actions. */
export function BookingDetailPage() {
  const { reference = '' } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { toast } = useToast();
  const query = useBookingDetail(reference);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(params.get('review') === '1');
  if (query.isPending) return <PageSpinner label="Loading booking" />;
  if (query.error)
    return (
      <ErrorState title="Booking not found" description={normalizeApiError(query.error).message} />
    );
  const b = query.data;
  const download = (kind: 'confirmation' | 'invoice') =>
    downloadFile(`/bookings/${b.reference}/documents/${kind}`, `${b.reference}-${kind}.pdf`).catch(
      (e: unknown) =>
        toast({
          title: 'Download failed',
          description: normalizeApiError(e).message,
          variant: 'error',
        }),
    );
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={`Booking ${b.reference}`}
        title={b.hotel.name}
        description={`Booked ${formatInstant(b.createdAt)}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <BookingStatusBadge status={b.status} />
            <PaymentStatusBadge status={b.paymentStatus} />
          </div>
        }
      />
      {b.status === 'RECONCILIATION_REQUIRED' && (
        <Alert tone="warning" title="We are refunding this booking">
          Your payment arrived after the hold expired and the rooms had been taken. A full refund is
          in progress.
        </Alert>
      )}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Booking actions">
        {b.actions.canPay && (
          <ButtonLink to={`/checkout/payment?booking=${b.reference}`}>Complete payment</ButtonLink>
        )}
        {b.actions.canDownloadConfirmation && (
          <Button
            variant="outline"
            leftIcon={<Download className="size-4" aria-hidden="true" />}
            onClick={() => void download('confirmation')}
          >
            Confirmation
          </Button>
        )}
        {b.actions.canDownloadInvoice && (
          <Button
            variant="outline"
            leftIcon={<Download className="size-4" aria-hidden="true" />}
            onClick={() => void download('invoice')}
          >
            Invoice
          </Button>
        )}
        {b.actions.canReview && (
          <Button
            variant="outline"
            leftIcon={<Star className="size-4" aria-hidden="true" />}
            onClick={() => setReviewOpen(true)}
          >
            Write a review
          </Button>
        )}
        {b.actions.canRequestRefund && (
          <Button variant="outline" onClick={() => setRefundOpen(true)}>
            Request a refund
          </Button>
        )}
        <ButtonLink variant="ghost" to={`/account/support/new?booking=${b.reference}`}>
          Get help
        </ButtonLink>
        {b.actions.canCancel && (
          <Button variant="danger" onClick={() => setCancelOpen(true)}>
            Cancel booking
          </Button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle as="h2">Stay</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <StaySummary
                hotel={b.hotel}
                checkIn={b.checkIn}
                checkOut={b.checkOut}
                nights={b.nights}
                guests={b.guests}
                roomLine={b.roomSummary}
              />
              <p className="text-sm text-fg-muted">
                {b.hotel.addressLine}
                {b.hotel.phone ? ` · ${b.hotel.phone}` : ''}
              </p>
              <Link
                to={`/hotels/${b.hotel.slug}`}
                className="self-start text-sm font-semibold text-primary hover:underline"
              >
                View property
              </Link>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle as="h2">Rooms</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-2 text-sm">
                {b.items.map((i) => (
                  <li key={`${i.roomTypeId}-${i.ratePlanId}`}>
                    <p className="font-medium">
                      {i.rooms} × {i.roomTypeName}
                    </p>
                    <p className="text-fg-muted">
                      {i.ratePlanName} · {i.adults} adult{i.adults === 1 ? '' : 's'}
                      {i.children ? `, ${i.children} child${i.children === 1 ? '' : 'ren'}` : ''}
                      {i.extraBeds ? ` · ${i.extraBeds} extra bed(s)` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle as="h2">Guests</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              <p className="font-medium">
                {b.guestDetails.primaryGuest.firstName} {b.guestDetails.primaryGuest.lastName}
              </p>
              <p className="text-fg-muted">
                {b.guestDetails.primaryGuest.email} · {b.guestDetails.primaryGuest.phone}
              </p>
              {b.guestDetails.additionalGuests.length > 0 && (
                <p className="mt-2">
                  Also travelling:{' '}
                  {b.guestDetails.additionalGuests
                    .map((g) => `${g.firstName} ${g.lastName}`)
                    .join(', ')}
                </p>
              )}
              {b.guestDetails.specialRequests && (
                <p className="mt-2">Requests: {b.guestDetails.specialRequests}</p>
              )}
              {b.guestDetails.estimatedArrivalTime && (
                <p>Estimated arrival: {b.guestDetails.estimatedArrivalTime}</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle as="h2">Payments and refunds</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              {b.payments.length === 0 && <p className="text-fg-muted">No payment yet.</p>}
              {b.payments.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {formatInstant(p.createdAt)} ·{' '}
                    {p.provider === 'SANDBOX' ? 'Sandbox (test)' : 'Razorpay'}
                    {p.failureReason ? ` — ${p.failureReason}` : ''}
                  </span>
                  <span className="flex items-center gap-2 tabular-nums">
                    {money(p.amountMinor, p.currency)} <PaymentStatusBadge status={p.status} />
                  </span>
                </div>
              ))}
              {b.refunds.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    Refund · {r.reason}
                    {r.failureReason ? ` — ${r.failureReason}` : ''}
                  </span>
                  <span className="flex items-center gap-2 tabular-nums">
                    {money(r.amountMinor, r.currency)} <RefundStatusBadge status={r.status} />
                  </span>
                </div>
              ))}
              {b.cancellation && (
                <p className="rounded-xl bg-surface-muted p-3">
                  Cancelled {formatInstant(b.cancellation.createdAt)} · charge{' '}
                  {money(b.cancellation.cancellationChargeMinor, b.cancellation.currency)} ·
                  refundable {money(b.cancellation.refundableAmountMinor, b.cancellation.currency)}
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle as="h2">Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="flex flex-col gap-2 border-l border-border pl-4 text-sm">
                {b.timeline.map((e, i) => (
                  <li key={i}>
                    <span className="font-medium">{e.label}</span>{' '}
                    <span className="text-fg-subtle">· {formatInstant(e.at)}</span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
        <aside className="flex flex-col gap-6" aria-label="Price and policy">
          <Card>
            <CardHeader>
              <CardTitle as="h2">Price</CardTitle>
            </CardHeader>
            <CardContent>
              <PriceBreakdown
                quote={breakdownSource(b.price, b.items, b.nights)}
                note="Prices are fixed at booking."
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle as="h2">Cancellation policy</CardTitle>
              <CardDescription>Applied as it was when you booked.</CardDescription>
            </CardHeader>
            <CardContent className="text-sm">
              {b.items.map((i) => (
                <p key={i.ratePlanId}>{i.cancellationPolicy.summary}</p>
              ))}
            </CardContent>
          </Card>
        </aside>
      </div>
      <CancelDialog booking={b} open={cancelOpen} onClose={() => setCancelOpen(false)} />
      <RefundRequestDialog booking={b} open={refundOpen} onClose={() => setRefundOpen(false)} />
      {reviewOpen && b.actions.canReview && (
        <ReviewEditor
          bookingReference={b.reference}
          hotelName={b.hotel.name}
          onClose={() => setReviewOpen(false)}
          onSaved={() => navigate('/account/reviews')}
        />
      )}
    </div>
  );
}

/** /account/payments */
export function PaymentsPage() {
  const query = usePayments();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Payments" description="Every payment attempt on your bookings." />
      {query.isPending ? (
        <PageSpinner />
      ) : query.error ? (
        <ErrorState
          description={normalizeApiError(query.error).message}
          onRetry={() => void query.refetch()}
        />
      ) : query.data.length === 0 ? (
        <EmptyState icon={<Wallet />} title="No payments yet" />
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
          {query.data.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm"
            >
              <span className="flex flex-col">
                <Link
                  className="font-medium hover:underline"
                  to={`/account/bookings/${p.bookingReference}`}
                >
                  {p.hotelName} · {p.bookingReference}
                </Link>
                <span className="text-fg-subtle">
                  {formatInstant(p.createdAt)}
                  {p.provider === 'SANDBOX' ? ' · sandbox (test)' : ''}
                  {p.refundedMinor ? ` · ${money(p.refundedMinor, p.currency)} refunded` : ''}
                </span>
              </span>
              <span className="flex items-center gap-2 font-semibold tabular-nums">
                {money(p.amountMinor, p.currency)} <PaymentStatusBadge status={p.status} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** /account/refunds */
export function RefundsPage() {
  const query = useRefunds();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Refunds"
        description="Refunds are marked complete only when the payment provider confirms them."
      />
      {query.isPending ? (
        <PageSpinner />
      ) : query.error ? (
        <ErrorState
          description={normalizeApiError(query.error).message}
          onRetry={() => void query.refetch()}
        />
      ) : query.data.length === 0 ? (
        <EmptyState icon={<ReceiptText />} title="No refunds" />
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
          {query.data.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm"
            >
              <span className="flex flex-col">
                <Link
                  className="font-medium hover:underline"
                  to={`/account/bookings/${r.bookingReference}`}
                >
                  {r.hotelName} · {r.bookingReference}
                </Link>
                <span className="text-fg-subtle">
                  {r.reason} · requested {formatInstant(r.requestedAt)}
                  {r.completedAt ? ` · completed ${formatInstant(r.completedAt)}` : ''}
                </span>
                {r.failureReason && <span className="text-danger">{r.failureReason}</span>}
              </span>
              <span className="flex items-center gap-2 font-semibold tabular-nums">
                {money(r.amountMinor, r.currency)} <RefundStatusBadge status={r.status} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
