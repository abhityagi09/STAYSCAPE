import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  CircleCheck,
  CircleX,
  Download,
  FlaskConical,
  Lock,
  Plus,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import type { BookingDetailDto, CheckoutConfigDto, HoldDto, QuoteDto } from '@stayscape/shared';
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  EmptyState,
  Input,
  PageHeader,
  PageSpinner,
  Spinner,
  Textarea,
  useToast,
} from '@/components/ui';
import { useAuth } from '@/features/auth/use-auth';
import { PriceBreakdown } from '@/features/marketplace/components/PriceBreakdown';
import { SELECTION_STORAGE_KEY } from '@/features/marketplace/pages/HotelDetailPage';
import { normalizeApiError } from '@/lib/api/errors';
import { applyServerErrors } from '@/lib/forms';
import { openRazorpayCheckout } from '@/lib/payments/razorpay';
import {
  bookingsApi,
  downloadFile,
  newIdempotencyKey,
  stickyKey,
  useBookingDetail,
  useInvalidateBooking,
} from '../api';
import {
  BookingStatusBadge,
  HoldCountdown,
  StaySummary,
  breakdownSource,
  money,
} from '../components';
import { tr, trf } from '@/lib/tr';

const GUEST_DRAFT_KEY = 'stayscape.checkout.guest';

const guestFormSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(60),
  lastName: z.string().trim().min(1, 'Last name is required').max(60),
  email: z.email('Enter a valid email').trim().max(254),
  phone: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{6,14}$/, 'Use international format, e.g. +919812345678'),
  additionalGuests: z
    .array(
      z.object({
        firstName: z.string().trim().min(1, 'Required').max(60),
        lastName: z.string().trim().min(1, 'Required').max(60),
      }),
    )
    .max(40),
  specialRequests: z.string().trim().max(1000),
  estimatedArrivalTime: z.string().regex(/^$|^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm'),
  acceptTerms: z.boolean().refine((v) => v, 'Accept the booking terms to continue'),
});
type GuestForm = z.infer<typeof guestFormSchema>;

function readSelection(): { quote: QuoteDto; hotel: { slug: string; name: string } } | null {
  try {
    return JSON.parse(sessionStorage.getItem(SELECTION_STORAGE_KEY) ?? 'null') as {
      quote: QuoteDto;
      hotel: { slug: string; name: string };
    } | null;
  } catch {
    return null;
  }
}

function SignInPrompt() {
  const location = useLocation();
  return (
    <div className="container-page max-w-xl py-16">
      <EmptyState
        icon={<Lock />}
        title={tr('Sign in to book')}
        description={tr(
          'Your selection is saved. Sign in or create an account to hold the rooms and pay securely.',
        )}
        action={
          <ButtonLink
            to={`/login?redirect=${encodeURIComponent(location.pathname + location.search)}`}
          >
            {tr('Sign in to continue')}
          </ButtonLink>
        }
      />
    </div>
  );
}

function ExpiredHold({
  slug,
  stay,
}: {
  slug: string;
  stay: { checkIn: string; checkOut: string };
}) {
  return (
    <Alert tone="warning" title={tr('Your hold has expired')}>
      {tr('The rooms were released so other travellers can book them. Nothing was charged.')}{' '}
      <Link
        className="font-semibold underline"
        to={`/hotels/${slug}?checkIn=${stay.checkIn}&checkOut=${stay.checkOut}`}
      >
        {tr('Check availability again')}
      </Link>
    </Alert>
  );
}

/** Coupon code on the active hold: the server reprices the hold and reserves the coupon. */
export function CouponField({ hold, onChange }: { hold: HoldDto; onChange: (h: HoldDto) => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const applied = hold.price.coupon;
  const run = async (fn: () => Promise<HoldDto>) => {
    setBusy(true);
    setError(null);
    try {
      onChange(await fn());
      setCode('');
    } catch (e) {
      setError(normalizeApiError(e).message);
    } finally {
      setBusy(false);
    }
  };
  if (applied)
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-success-soft p-3 text-sm">
        <span>
          {tr('Coupon')} <strong className="font-mono">{applied.code}</strong> {tr('saves')}{' '}
          {money(applied.discountMinor, hold.price.currency)}
        </span>
        <Button
          size="sm"
          variant="ghost"
          loading={busy}
          onClick={() => void run(() => bookingsApi.removeHoldCoupon(hold.reference))}
        >
          {tr('Remove')}
        </Button>
      </div>
    );
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => bookingsApi.applyHoldCoupon(hold.reference, code.trim()));
      }}
    >
      <Input
        label={tr('Coupon code')}
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        error={error ?? undefined}
        containerClassName="flex-1"
      />
      <Button
        type="submit"
        size="sm"
        variant="outline"
        loading={busy}
        disabled={code.trim().length < 3}
      >
        {tr('Apply')}
      </Button>
    </form>
  );
}

/** /checkout — hold the rooms, collect guest details, accept terms. */
export function CheckoutPage() {
  const { isAuthenticated, user } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('quote');
  const selection = useMemo(readSelection, []);
  const quote = selection?.quote && selection.quote.quoteToken === token ? selection.quote : null;
  const [hold, setHold] = useState<HoldDto | null>(null);
  const [holdError, setHoldError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const requested = useRef(false);

  const draft = useMemo(() => {
    try {
      return JSON.parse(
        sessionStorage.getItem(GUEST_DRAFT_KEY) ?? 'null',
      ) as Partial<GuestForm> | null;
    } catch {
      return null;
    }
  }, []);
  const form = useForm<GuestForm>({
    resolver: zodResolver(guestFormSchema),
    defaultValues: {
      firstName: draft?.firstName ?? user?.firstName ?? '',
      lastName: draft?.lastName ?? user?.lastName ?? '',
      email: draft?.email ?? user?.email ?? '',
      phone: draft?.phone ?? user?.phone ?? '',
      additionalGuests: draft?.additionalGuests ?? [],
      specialRequests: draft?.specialRequests ?? '',
      estimatedArrivalTime: draft?.estimatedArrivalTime ?? '',
      acceptTerms: false,
    },
  });
  const { register, handleSubmit, control, watch, setError, formState } = form;
  const guests = useFieldArray({ control, name: 'additionalGuests' });

  // Preserve non-sensitive details across refreshes and recoverable failures (never payment data).
  useEffect(() => {
    const sub = watch((values) => {
      try {
        const { acceptTerms: _t, ...rest } = values;
        sessionStorage.setItem(GUEST_DRAFT_KEY, JSON.stringify(rest));
      } catch {
        /* storage unavailable */
      }
    });
    return () => sub.unsubscribe();
  }, [watch]);

  useEffect(() => {
    if (!isAuthenticated || !quote || requested.current) return;
    requested.current = true;
    bookingsApi
      .createHold(
        {
          hotelId: quote.hotel.id,
          checkIn: quote.checkIn,
          checkOut: quote.checkOut,
          items: [
            {
              roomTypeId: quote.roomType.id,
              ratePlanId: quote.ratePlan.id,
              rooms: quote.rooms,
              adults: quote.occupancy.adults,
              childrenAges: quote.occupancy.childrenAges,
              extraBeds: quote.occupancy.extraBeds,
            },
          ],
        },
        stickyKey(`hold.${quote.quoteToken.slice(-24)}`),
      )
      .then((h) => {
        if (h.bookingReference)
          return navigate(`/checkout/payment?booking=${h.bookingReference}`, { replace: true });
        setHold(h);
        setExpired(h.status !== 'ACTIVE' || new Date(h.expiresAt) <= new Date());
      })
      .catch((e: unknown) => setHoldError(normalizeApiError(e).message));
  }, [isAuthenticated, quote, navigate]);

  const onExpire = useCallback(() => setExpired(true), []);

  if (!isAuthenticated) return <SignInPrompt />;
  if (!quote || !selection) {
    return (
      <div className="container-page py-16">
        <EmptyState
          title={tr('No stay selected')}
          description={tr('Choose a room and rate on a property page first.')}
          action={<ButtonLink to="/hotels">{tr('Find a stay')}</ButtonLink>}
        />
      </div>
    );
  }

  const onSubmit = handleSubmit(async (values) => {
    if (!hold || expired) return;
    setFormError(null);
    try {
      const booking = await bookingsApi.createBooking(
        {
          holdReference: hold.reference,
          acceptTerms: true,
          guestDetails: {
            primaryGuest: {
              firstName: values.firstName,
              lastName: values.lastName,
              email: values.email,
              phone: values.phone,
            },
            additionalGuests: values.additionalGuests,
            specialRequests: values.specialRequests,
            estimatedArrivalTime: values.estimatedArrivalTime || null,
          },
        },
        stickyKey(`booking.${hold.reference}`),
      );
      navigate(`/checkout/payment?booking=${booking.reference}`);
    } catch (error) {
      const err = normalizeApiError(error);
      if (err.code === 'HOLD_EXPIRED') setExpired(true);
      setFormError(applyServerErrors(error, setError, []) ?? err.message);
    }
  });

  const stay = { checkIn: quote.checkIn, checkOut: quote.checkOut };
  return (
    <div className="container-page grid gap-8 py-10 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="flex flex-col gap-6">
        <PageHeader
          eyebrow={tr('Step 1 of 2')}
          title={tr('Your details')}
          description={tr('We hold your rooms while you complete the booking.')}
        />
        {holdError && (
          <Alert tone="danger" title={tr('We couldn’t hold these rooms')}>
            {holdError}{' '}
            <Link
              className="font-semibold underline"
              to={`/hotels/${selection.hotel.slug}?checkIn=${stay.checkIn}&checkOut=${stay.checkOut}`}
            >
              {tr('Choose another room')}
            </Link>
          </Alert>
        )}
        {expired && <ExpiredHold slug={selection.hotel.slug} stay={stay} />}
        <form
          onSubmit={onSubmit}
          noValidate
          className="flex flex-col gap-6"
          aria-label={tr('Guest details')}
        >
          <Card>
            <CardHeader>
              <CardTitle as="h2">{tr('Primary guest')}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Input
                label={tr('First name')}
                autoComplete="given-name"
                required
                {...register('firstName')}
                error={formState.errors.firstName?.message}
              />
              <Input
                label={tr('Last name')}
                autoComplete="family-name"
                required
                {...register('lastName')}
                error={formState.errors.lastName?.message}
              />
              <Input
                label={tr('Email')}
                type="email"
                autoComplete="email"
                required
                {...register('email')}
                error={formState.errors.email?.message}
              />
              <Input
                label={tr('Mobile number')}
                type="tel"
                autoComplete="tel"
                placeholder="+919812345678"
                required
                {...register('phone')}
                error={formState.errors.phone?.message}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle as="h2">{tr('Other travellers')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {guests.fields.map((field, i) => (
                <div key={field.id} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
                  <Input
                    label={trf('Traveller {0} first name', [i + 2])}
                    {...register(`additionalGuests.${i}.firstName`)}
                    error={formState.errors.additionalGuests?.[i]?.firstName?.message}
                  />
                  <Input
                    label={trf('Traveller {0} last name', [i + 2])}
                    {...register(`additionalGuests.${i}.lastName`)}
                    error={formState.errors.additionalGuests?.[i]?.lastName?.message}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={trf('Remove traveller {0}', [i + 2])}
                    onClick={() => guests.remove(i)}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                leftIcon={<Plus className="size-4" aria-hidden="true" />}
                onClick={() => guests.append({ firstName: '', lastName: '' })}
              >
                {tr('Add traveller')}
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle as="h2">{tr('Requests for the property')}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Textarea
                label={tr('Special requests')}
                hint={tr('Not guaranteed — the property will do its best.')}
                rows={3}
                {...register('specialRequests')}
                error={formState.errors.specialRequests?.message}
              />
              <Input
                label={tr('Estimated arrival time')}
                type="time"
                optionalLabel
                containerClassName="sm:max-w-48"
                {...register('estimatedArrivalTime')}
                error={formState.errors.estimatedArrivalTime?.message}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle as="h2">{tr('Cancellation policy')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <p>
                {hold?.items[0]?.cancellationPolicy.summary ??
                  tr('Loading the policy for this rate…')}
              </p>
              <Checkbox
                label={
                  <>
                    {tr('I accept the')}{' '}
                    <Link className="underline" to="/terms" target="_blank">
                      {tr('booking terms')}
                    </Link>{' '}
                    {tr('and this cancellation policy.')}
                  </>
                }
                {...register('acceptTerms')}
                error={formState.errors.acceptTerms?.message}
              />
            </CardContent>
          </Card>
          {formError && <Alert tone="danger">{formError}</Alert>}
          <Button
            type="submit"
            size="lg"
            loading={formState.isSubmitting}
            disabled={!hold || expired}
            className="self-start"
          >
            {tr('Continue to payment')}
          </Button>
        </form>
      </div>

      <aside aria-label={tr('Booking summary')} className="lg:sticky lg:top-24 lg:self-start">
        <Card>
          <CardHeader className="gap-3">
            <CardTitle as="h2">{tr('Your stay')}</CardTitle>
            {hold && !expired && <HoldCountdown expiresAt={hold.expiresAt} onExpire={onExpire} />}
            {!hold && !holdError && <Spinner label={tr('Holding your rooms')} />}
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <StaySummary
              hotel={
                hold
                  ? hold.hotel
                  : { name: selection.hotel.name, city: '', state: '', coverImage: null }
              }
              checkIn={quote.checkIn}
              checkOut={quote.checkOut}
              nights={quote.nights}
              guests={quote.occupancy.adults + quote.occupancy.children}
              roomLine={`${quote.rooms} × ${quote.roomType.name} · ${quote.ratePlan.name}`}
            />
            {hold ? (
              <>
                <PriceBreakdown
                  quote={breakdownSource(hold.price, hold.items, hold.nights)}
                  note={tr('Price confirmed by the server for this hold.')}
                />
                {!expired && <CouponField hold={hold} onChange={setHold} />}
              </>
            ) : (
              <PriceBreakdown quote={quote} />
            )}
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}

function SandboxCheckout({
  onPay,
  busy,
}: {
  onPay: (outcome: 'success' | 'failure') => void;
  busy: boolean;
}) {
  return (
    <div
      className="rounded-2xl border-2 border-dashed border-warning bg-warning-soft/40 p-5"
      role="group"
      aria-labelledby="sandbox-title"
    >
      <p id="sandbox-title" className="flex items-center gap-2 font-semibold text-warning">
        <FlaskConical className="size-5" aria-hidden="true" />{' '}
        {tr('Test payment sandbox — no real money moves')}
      </p>
      <p className="mt-1 text-sm text-fg-muted">
        {tr(
          'This development environment uses a simulated gateway with the same verification flow as Razorpay. Choose an outcome:',
        )}
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button
          onClick={() => onPay('success')}
          loading={busy}
          leftIcon={<CircleCheck className="size-4" aria-hidden="true" />}
        >
          {tr('Simulate successful payment')}
        </Button>
        <Button
          variant="outline"
          onClick={() => onPay('failure')}
          disabled={busy}
          leftIcon={<CircleX className="size-4" aria-hidden="true" />}
        >
          {tr('Simulate declined card')}
        </Button>
      </div>
    </div>
  );
}

/** /checkout/payment?booking= — pay for a booking awaiting payment. */
export function CheckoutPaymentPage() {
  const { isAuthenticated } = useAuth();
  const [params] = useSearchParams();
  const reference = params.get('booking');
  const navigate = useNavigate();
  const { toast } = useToast();
  const invalidate = useInvalidateBooking();
  const query = useBookingDetail(isAuthenticated ? reference : null);
  const [config, setConfig] = useState<CheckoutConfigDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const booking = query.data;

  useEffect(() => {
    if (booking && ['CONFIRMED', 'RECONCILIATION_REQUIRED'].includes(booking.status))
      navigate(`/checkout/confirmation?booking=${booking.reference}`, { replace: true });
  }, [booking, navigate]);

  const settle = useCallback(
    async (result: { providerOrderId: string; providerPaymentId: string; signature: string }) => {
      if (!reference) return;
      setBusy(true);
      try {
        const verification = await bookingsApi.verify(reference, result);
        invalidate(reference);
        if (verification.outcome === 'FAILED') navigate(`/checkout/failure?booking=${reference}`);
        else navigate(`/checkout/confirmation?booking=${reference}`);
      } catch (e) {
        // The webhook/reconciliation may still confirm a genuine payment: show the status page.
        toast({
          title: tr('We are confirming your payment'),
          description: normalizeApiError(e).message,
        });
        navigate(`/checkout/confirmation?booking=${reference}`);
      } finally {
        setBusy(false);
      }
    },
    [reference, invalidate, navigate, toast],
  );

  if (!isAuthenticated) return <SignInPrompt />;
  if (!reference)
    return (
      <div className="container-page py-16">
        <EmptyState
          title={tr('No booking selected')}
          action={<ButtonLink to="/account/bookings">{tr('Your bookings')}</ButtonLink>}
        />
      </div>
    );
  if (query.isPending) return <PageSpinner label={tr('Loading your booking')} />;
  if (query.error || !booking)
    return (
      <div className="container-page py-16">
        <EmptyState
          title={tr('Booking not found')}
          description={normalizeApiError(query.error).message}
          action={<ButtonLink to="/account/bookings">{tr('Your bookings')}</ButtonLink>}
        />
      </div>
    );

  const start = async () => {
    setError(null);
    setBusy(true);
    try {
      // A new key per attempt; the server reuses an open order rather than creating another.
      const cfg = await bookingsApi.createOrder(booking.reference, newIdempotencyKey());
      setConfig(cfg);
      if (!cfg.sandbox) {
        await openRazorpayCheckout(cfg, {
          onAuthorized: (r) => void settle(r),
          onFailed: (reason) => {
            setError(`Payment failed: ${reason} You can try again.`);
            invalidate(booking.reference);
          },
          onDismiss: () => setBusy(false),
        });
      }
    } catch (e) {
      const err = normalizeApiError(e);
      if (err.code === 'HOLD_EXPIRED') setExpired(true);
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const sandboxPay = async (outcome: 'success' | 'failure') => {
    setBusy(true);
    try {
      await settle(await bookingsApi.sandboxComplete(booking.reference, outcome));
    } catch (e) {
      setError(normalizeApiError(e).message);
      setBusy(false);
    }
  };

  const canPay = booking.actions.canPay && !expired;
  return (
    <div className="container-page grid gap-8 py-10 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="flex flex-col gap-6">
        <PageHeader
          eyebrow={tr('Step 2 of 2')}
          title={tr('Payment')}
          description={trf('Booking {0}', [booking.reference])}
        />
        {booking.paymentStatus === 'FAILED' && !error && (
          <Alert tone="warning" title={tr('Your last payment did not go through')}>
            {tr('No money was taken. You can try again while your rooms are held.')}
          </Alert>
        )}
        {(expired || booking.status === 'EXPIRED') && (
          <ExpiredHold slug={booking.hotel.slug} stay={booking} />
        )}
        {error && <Alert tone="danger">{error}</Alert>}
        <Card>
          <CardHeader>
            <CardTitle as="h2">{tr('Payment method')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            <p className="flex items-start gap-2 text-fg-muted">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
              {tr(
                'Cards, UPI, net banking and wallets are handled by our payment partner. STAYSCAPE never sees or stores your card details.',
              )}
            </p>
            {canPay ? (
              config?.sandbox ? (
                <SandboxCheckout onPay={(o) => void sandboxPay(o)} busy={busy} />
              ) : (
                <Button
                  size="lg"
                  className="self-start"
                  loading={busy}
                  onClick={() => void start()}
                >
                  {tr('Pay')} {money(booking.totalMinor, booking.currency)}
                </Button>
              )
            ) : booking.status === 'PAYMENT_PROCESSING' ? (
              <p className="flex items-center gap-2">
                <Spinner size="sm" label="" />{' '}
                {tr('We are waiting for confirmation from the payment provider.')}
              </p>
            ) : (
              <p>{tr('This booking cannot be paid for right now.')}</p>
            )}
          </CardContent>
        </Card>
      </div>
      <aside aria-label={tr('Booking summary')} className="lg:sticky lg:top-24 lg:self-start">
        <Card>
          <CardHeader className="gap-3">
            <CardTitle as="h2">{tr('Your stay')}</CardTitle>
            {booking.holdExpiresAt && !expired && (
              <HoldCountdown expiresAt={booking.holdExpiresAt} onExpire={() => setExpired(true)} />
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <StaySummary
              hotel={booking.hotel}
              checkIn={booking.checkIn}
              checkOut={booking.checkOut}
              nights={booking.nights}
              guests={booking.guests}
              roomLine={booking.roomSummary}
            />
            <PriceBreakdown
              quote={breakdownSource(booking.price, booking.items, booking.nights)}
              note={booking.items[0]?.cancellationPolicy.summary}
            />
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}

function Downloads({ booking }: { booking: BookingDetailDto }) {
  const { toast } = useToast();
  const get = (kind: 'confirmation' | 'invoice') =>
    downloadFile(
      `/bookings/${booking.reference}/documents/${kind}`,
      `${booking.reference}-${kind}.pdf`,
    ).catch((e: unknown) =>
      toast({
        title: tr('Download failed'),
        description: normalizeApiError(e).message,
        variant: 'error',
      }),
    );
  return (
    <div className="flex flex-wrap gap-3">
      {booking.actions.canDownloadConfirmation && (
        <Button
          variant="outline"
          leftIcon={<Download className="size-4" aria-hidden="true" />}
          onClick={() => void get('confirmation')}
        >
          {tr('Confirmation (PDF)')}
        </Button>
      )}
      {booking.actions.canDownloadInvoice && (
        <Button
          variant="outline"
          leftIcon={<Download className="size-4" aria-hidden="true" />}
          onClick={() => void get('invoice')}
        >
          {tr('Invoice (PDF)')}
        </Button>
      )}
    </div>
  );
}

/** /checkout/confirmation?booking= — the outcome, polled until the payment is settled. */
export function CheckoutConfirmationPage() {
  const { isAuthenticated } = useAuth();
  const [params] = useSearchParams();
  const reference = params.get('booking');
  const query = useBookingDetail(isAuthenticated ? reference : null, { poll: true });
  const booking = query.data;
  useEffect(() => {
    if (booking?.status === 'CONFIRMED') {
      try {
        sessionStorage.removeItem(GUEST_DRAFT_KEY);
        sessionStorage.removeItem(SELECTION_STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }
  }, [booking?.status]);
  if (!isAuthenticated) return <SignInPrompt />;
  if (!reference || query.error)
    return (
      <div className="container-page py-16">
        <EmptyState
          title={tr('Booking not found')}
          action={<ButtonLink to="/account/bookings">{tr('Your bookings')}</ButtonLink>}
        />
      </div>
    );
  if (!booking) return <PageSpinner label={tr('Loading your booking')} />;

  const reconciled =
    booking.status === 'RECONCILIATION_REQUIRED' ||
    booking.timeline.some((e) => e.type === 'RECONCILIATION_REQUIRED');
  return (
    <div className="container-page max-w-3xl py-12">
      <div className="flex flex-col gap-6">
        {booking.status === 'CONFIRMED' ? (
          <div className="rounded-2xl bg-success-soft p-6" role="status">
            <p className="flex items-center gap-2 font-display text-2xl font-semibold text-success">
              <CircleCheck className="size-7" aria-hidden="true" /> {tr('Your stay is confirmed')}
            </p>
            <p className="mt-2 text-sm">
              {tr('Booking reference')} <strong>{booking.reference}</strong>
              {tr('. A confirmation email is on its way.')}
            </p>
          </div>
        ) : reconciled ? (
          <Alert tone="warning" title={tr('We could not complete this booking')}>
            {tr(
              'Your payment arrived after the room hold expired and the rooms had been taken. A full refund has been started automatically — you can track it below.',
            )}
          </Alert>
        ) : booking.paymentStatus === 'FAILED' ? (
          <Alert tone="danger" title={tr('Payment failed')}>
            {tr('No money was taken.')}{' '}
            <Link className="underline" to={`/checkout/payment?booking=${booking.reference}`}>
              {tr('Try again')}
            </Link>
          </Alert>
        ) : (
          <div
            className="flex items-center gap-3 rounded-2xl bg-surface-muted p-6"
            role="status"
            aria-live="polite"
          >
            <Spinner label="" />{' '}
            <p>
              {tr(
                'Confirming your payment with the provider. This usually takes a few seconds — you can safely leave this page; we will email you.',
              )}
            </p>
          </div>
        )}
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle as="h2">
              {tr('Booking')} {booking.reference}
            </CardTitle>
            <BookingStatusBadge status={booking.status} />
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <StaySummary
              hotel={booking.hotel}
              checkIn={booking.checkIn}
              checkOut={booking.checkOut}
              nights={booking.nights}
              guests={booking.guests}
              roomLine={booking.roomSummary}
            />
            <PriceBreakdown
              quote={breakdownSource(booking.price, booking.items, booking.nights)}
              note={booking.items[0]?.cancellationPolicy.summary}
            />
            {booking.refunds.length > 0 && (
              <ul className="text-sm">
                {booking.refunds.map((r) => (
                  <li key={r.id}>
                    {tr('Refund')} {money(r.amountMinor, r.currency)} — {r.status.toLowerCase()}
                  </li>
                ))}
              </ul>
            )}
            <Downloads booking={booking} />
          </CardContent>
        </Card>
        <div className="flex flex-wrap gap-3">
          <ButtonLink to={`/account/bookings/${booking.reference}`}>
            {tr('View booking')}
          </ButtonLink>
          <ButtonLink variant="outline" to="/hotels">
            {tr('Keep exploring')}
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}

/** /checkout/failure?booking= — a failed or abandoned payment, with a safe retry. */
export function CheckoutFailurePage() {
  const { isAuthenticated } = useAuth();
  const [params] = useSearchParams();
  const reference = params.get('booking');
  const query = useBookingDetail(isAuthenticated ? reference : null);
  if (!isAuthenticated) return <SignInPrompt />;
  const booking = query.data;
  if (!booking)
    return query.isPending && reference ? (
      <PageSpinner />
    ) : (
      <div className="container-page py-16">
        <EmptyState
          title={tr('Booking not found')}
          action={<ButtonLink to="/hotels">{tr('Find a stay')}</ButtonLink>}
        />
      </div>
    );
  const failed = booking.payments.filter((p) => p.status === 'FAILED').at(-1);
  return (
    <div className="container-page max-w-2xl py-12">
      <PageHeader
        eyebrow={trf('Booking {0}', [booking.reference])}
        title={tr('Your payment didn’t go through')}
        description={tr('No money was taken from your account.')}
      />
      <div className="mt-6 flex flex-col gap-4">
        {failed?.failureReason && (
          <Alert tone="danger" title={tr('Reason from the payment provider')}>
            {failed.failureReason}
          </Alert>
        )}
        {booking.actions.canPay ? (
          <>
            {booking.holdExpiresAt && (
              <HoldCountdown expiresAt={booking.holdExpiresAt} className="self-start" />
            )}
            <div className="flex flex-wrap gap-3">
              <ButtonLink to={`/checkout/payment?booking=${booking.reference}`}>
                {tr('Try again')}
              </ButtonLink>
              <ButtonLink variant="outline" to={`/account/bookings/${booking.reference}`}>
                {tr('View booking')}
              </ButtonLink>
            </div>
          </>
        ) : (
          <ExpiredHold slug={booking.hotel.slug} stay={booking} />
        )}
      </div>
    </div>
  );
}
