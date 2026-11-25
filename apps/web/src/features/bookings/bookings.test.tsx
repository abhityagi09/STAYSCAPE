import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookingDetailDto, HoldDto, QuoteDto } from '@stayscape/shared';
import { calls, image, on, resetApi } from '@/test/api-mock';
import { makeUser, renderWithProviders } from '@/test/render';
import { SELECTION_STORAGE_KEY } from '@/features/marketplace/pages/HotelDetailPage';
import { CheckoutPage, CheckoutPaymentPage } from './pages/CheckoutPages';
import { BookingDetailPage, BookingsListPage } from './pages/AccountBookingPages';
import { ReviewsPage } from './pages/AccountExtrasPages';
import { PartnerReservationsPage } from '@/features/partner/pages/ReservationsPages';
import { OperationsPage } from '@/features/admin/pages/OperationsPage';

vi.mock('@/lib/api/client', async () => (await import('@/test/api-mock')).apiClientMock());

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

const policy = {
  type: 'FREE_CANCELLATION' as const,
  freeCancellationHours: 48,
  refundBasisPointsAfterDeadline: 0,
  fixedChargeMinor: null,
  noShowRefundBasisPoints: 0,
  description: null,
  freeCancellationDeadline: '2027-02-27T08:30:00.000Z',
  summary: 'Free cancellation until 27 Feb (property time).',
};
const price = {
  currency: 'INR' as const,
  taxes: [{ label: 'GST', amountMinor: 50_000 }],
  fees: [],
  totals: {
    roomChargesMinor: 1_000_000,
    discountsMinor: 0,
    subtotalMinor: 1_000_000,
    taxesMinor: 50_000,
    feesMinor: 0,
    totalMinor: 1_050_000,
  },
};
const item = {
  roomTypeId: 'r1',
  roomTypeName: 'Deluxe Lake View',
  ratePlanId: 'p1',
  ratePlanName: 'Flexible',
  mealPlan: 'BREAKFAST' as const,
  rooms: 1,
  adults: 2,
  children: 0,
  childrenAges: [],
  extraBeds: 0,
  nightly: [],
  price,
  cancellationPolicy: policy,
};
const hotel = {
  id: 'h1',
  name: 'Lakeview Haveli',
  slug: 'lakeview-haveli',
  city: 'Udaipur',
  state: 'Rajasthan',
  addressLine: '12 Lake Road, Udaipur',
  timeZone: 'Asia/Kolkata',
  checkInTime: '14:00',
  checkOutTime: '11:00',
  phone: '+919800000000',
  email: 'stay@example.com',
  coverImage: image('c'),
};

const quote: QuoteDto = {
  quoteToken: 'signed.quote.token.for.tests',
  expiresAt: new Date(Date.now() + 900_000).toISOString(),
  hotel: { id: 'h1', name: 'Lakeview Haveli', slug: 'lakeview-haveli' },
  roomType: { id: 'r1', name: 'Deluxe Lake View' },
  ratePlan: {
    id: 'p1',
    name: 'Flexible',
    mealPlan: 'BREAKFAST',
    cancellationPolicy: {
      type: 'FREE_CANCELLATION',
      freeCancellationHours: 48,
      refundBasisPointsAfterDeadline: 0,
    },
  },
  checkIn: '2027-03-01',
  checkOut: '2027-03-03',
  nights: 2,
  rooms: 1,
  occupancy: { adults: 2, children: 0, childrenAges: [], extraBeds: 0 },
  currency: 'INR',
  nightly: [],
  taxes: price.taxes,
  fees: [],
  totals: price.totals,
  roomsLeft: 3,
};

const hold = (overrides: Partial<HoldDto> = {}): HoldDto => ({
  reference: 'HLD-ABCDEFGHJK',
  status: 'ACTIVE',
  hotel,
  checkIn: '2027-03-01',
  checkOut: '2027-03-03',
  nights: 2,
  items: [item],
  price,
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
  bookingReference: null,
  ...overrides,
});

const actions = {
  canPay: false,
  canCancel: false,
  canReview: false,
  canRequestRefund: false,
  canDownloadConfirmation: false,
  canDownloadInvoice: false,
};
const booking = (overrides: Partial<BookingDetailDto> = {}): BookingDetailDto => ({
  reference: 'SS-7KQ2M9XA',
  status: 'PENDING_PAYMENT',
  paymentStatus: 'INITIATED',
  hotel,
  checkIn: '2027-03-01',
  checkOut: '2027-03-03',
  nights: 2,
  rooms: 1,
  guests: 2,
  roomSummary: '1 × Deluxe Lake View · Flexible',
  totalMinor: 1_050_000,
  currency: 'INR',
  holdExpiresAt: new Date(Date.now() + 600_000).toISOString(),
  createdAt: new Date().toISOString(),
  actions: { ...actions, canPay: true, canCancel: true },
  items: [item],
  guestDetails: {
    primaryGuest: {
      firstName: 'Meera',
      lastName: 'Iyer',
      email: 'meera@example.com',
      phone: '+919811111111',
    },
    additionalGuests: [],
    specialRequests: '',
    estimatedArrivalTime: null,
  },
  price,
  cancellation: null,
  payments: [],
  refunds: [],
  confirmedAt: null,
  cancelledAt: null,
  checkedInAt: null,
  checkedOutAt: null,
  reviewId: null,
  timeline: [
    {
      at: new Date().toISOString(),
      type: 'PENDING_PAYMENT',
      label: 'Booking created — awaiting payment',
    },
  ],
  ...overrides,
});

beforeEach(() => {
  resetApi();
  sessionStorage.clear();
  localStorage.clear();
});

describe('checkout', () => {
  beforeEach(() =>
    sessionStorage.setItem(
      SELECTION_STORAGE_KEY,
      JSON.stringify({ quote, hotel: { slug: 'lakeview-haveli', name: 'Lakeview Haveli' } }),
    ),
  );

  it('asks signed-out visitors to sign in and keeps the selection', async () => {
    renderWithProviders([{ path: '/checkout', element: <CheckoutPage /> }], {
      route: `/checkout?quote=${quote.quoteToken}`,
      user: null,
    });
    expect(await screen.findByRole('link', { name: 'Sign in to continue' })).toHaveAttribute(
      'href',
      expect.stringContaining('/login?redirect='),
    );
    expect(calls).toHaveLength(0);
  });

  it('holds the rooms with an idempotency key, validates guests and creates the booking', async () => {
    on('post', /\/bookings\/holds$/, () => hold());
    on('post', /\/bookings$/, () => booking());
    const user = userEvent.setup();
    renderWithProviders(
      [
        { path: '/checkout', element: <CheckoutPage /> },
        { path: '/checkout/payment', element: <LocationProbe /> },
      ],
      { route: `/checkout?quote=${quote.quoteToken}`, user: makeUser({ phone: null }) },
    );
    expect(await screen.findByText(/Rooms held for/)).toBeInTheDocument();
    const holdCall = calls.find((c) => c.url === '/bookings/holds')!;
    expect(holdCall.body).toEqual({
      hotelId: 'h1',
      checkIn: '2027-03-01',
      checkOut: '2027-03-03',
      items: [
        { roomTypeId: 'r1', ratePlanId: 'p1', rooms: 1, adults: 2, childrenAges: [], extraBeds: 0 },
      ],
    });
    expect(JSON.stringify(holdCall.body)).not.toMatch(/total|amount/i);
    expect(screen.getByText('Free cancellation until 27 Feb (property time).')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Continue to payment' }));
    expect(
      await screen.findByText('Use international format, e.g. +919812345678'),
    ).toBeInTheDocument();
    expect(screen.getByText('Accept the booking terms to continue')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Mobile number/), '+919811111111');
    await user.click(screen.getByRole('checkbox', { name: /booking terms/ }));
    await user.click(screen.getByRole('button', { name: 'Continue to payment' }));
    expect(await screen.findByTestId('location')).toHaveTextContent(
      '/checkout/payment?booking=SS-7KQ2M9XA',
    );
    const created = calls.find((c) => c.url === '/bookings')!;
    expect(created.body).toMatchObject({
      holdReference: 'HLD-ABCDEFGHJK',
      acceptTerms: true,
      guestDetails: { primaryGuest: { firstName: 'Asha', phone: '+919811111111' } },
    });
  });

  it('blocks submission when the hold has expired and offers a fresh availability check', async () => {
    on('post', /\/bookings\/holds$/, () =>
      hold({ expiresAt: new Date(Date.now() - 1000).toISOString(), status: 'EXPIRED' }),
    );
    renderWithProviders([{ path: '/checkout', element: <CheckoutPage /> }], {
      route: `/checkout?quote=${quote.quoteToken}`,
      user: makeUser(),
    });
    expect(await screen.findByText('Your hold has expired')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Check availability again' })).toHaveAttribute(
      'href',
      '/hotels/lakeview-haveli?checkIn=2027-03-01&checkOut=2027-03-03',
    );
    expect(screen.getByRole('button', { name: 'Continue to payment' })).toBeDisabled();
  });

  it('pays through the labelled sandbox and lets the server verify the result', async () => {
    on('get', /\/bookings\/SS-7KQ2M9XA$/, () => booking());
    on('post', /\/payments$/, () => ({
      provider: 'SANDBOX',
      keyId: 'sandbox_key',
      providerOrderId: 'order_1',
      amountMinor: 1_050_000,
      currency: 'INR',
      merchantName: 'STAYSCAPE',
      description: 'x',
      bookingReference: 'SS-7KQ2M9XA',
      prefill: { name: 'Meera Iyer', email: 'm@e.com', contact: '+91' },
      holdExpiresAt: null,
      sandbox: true,
    }));
    on('post', /\/sandbox-complete$/, () => ({
      providerOrderId: 'order_1',
      providerPaymentId: 'pay_1',
      signature: 'sig',
    }));
    on('post', /\/verify$/, () => ({
      outcome: 'CONFIRMED',
      booking: booking({ status: 'CONFIRMED' }),
    }));
    const user = userEvent.setup();
    renderWithProviders(
      [
        { path: '/checkout/payment', element: <CheckoutPaymentPage /> },
        { path: '/checkout/confirmation', element: <LocationProbe /> },
      ],
      { route: '/checkout/payment?booking=SS-7KQ2M9XA', user: makeUser() },
    );
    await user.click(await screen.findByRole('button', { name: /Pay ₹10,500/ }));
    expect(screen.getByText(/no real money moves/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Simulate successful payment' }));
    expect(await screen.findByTestId('location')).toHaveTextContent(
      '/checkout/confirmation?booking=SS-7KQ2M9XA',
    );
    expect(calls.find((c) => c.url.endsWith('/verify'))?.body).toEqual({
      providerOrderId: 'order_1',
      providerPaymentId: 'pay_1',
      signature: 'sig',
    });
  });
});

describe('booking management', () => {
  it('shows only actions valid for the status', async () => {
    on('get', /\/bookings\/SS-7KQ2M9XA$/, () =>
      booking({
        status: 'COMPLETED',
        paymentStatus: 'SUCCESS',
        holdExpiresAt: null,
        actions: {
          ...actions,
          canReview: true,
          canDownloadConfirmation: true,
          canDownloadInvoice: true,
        },
      }),
    );
    renderWithProviders(
      [{ path: '/account/bookings/:reference', element: <BookingDetailPage /> }],
      { route: '/account/bookings/SS-7KQ2M9XA', user: makeUser() },
    );
    const group = await screen.findByRole('group', { name: 'Booking actions' });
    expect(within(group).getByRole('button', { name: 'Write a review' })).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'Invoice' })).toBeInTheDocument();
    expect(within(group).queryByRole('button', { name: 'Cancel booking' })).not.toBeInTheDocument();
    expect(within(group).queryByRole('link', { name: 'Complete payment' })).not.toBeInTheDocument();
  });

  it('previews the policy outcome before cancelling', async () => {
    on('get', /\/bookings\/SS-7KQ2M9XA$/, () =>
      booking({
        status: 'CONFIRMED',
        paymentStatus: 'SUCCESS',
        actions: { ...actions, canCancel: true },
      }),
    );
    on('get', /\/cancellation$/, () => ({
      eligible: true,
      reason: null,
      beforeFreeCancellationDeadline: true,
      freeCancellationDeadline: null,
      paidMinor: 1_050_000,
      chargeMinor: 0,
      refundableMinor: 1_050_000,
      currency: 'INR',
      policySummary: 'Free cancellation.',
    }));
    on('post', /\/cancel$/, () => ({
      booking: booking({ status: 'CANCELLED' }),
      chargeMinor: 0,
      refundableMinor: 1_050_000,
      refund: null,
      alreadyCancelled: false,
    }));
    const user = userEvent.setup();
    renderWithProviders(
      [{ path: '/account/bookings/:reference', element: <BookingDetailPage /> }],
      { route: '/account/bookings/SS-7KQ2M9XA', user: makeUser() },
    );
    await user.click(await screen.findByRole('button', { name: 'Cancel booking' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      await within(dialog).findByText('₹10,500.00', { selector: 'dd.font-semibold' }),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel booking' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'post' && c.url.endsWith('/cancel'))).toBe(true),
    );
  });

  it('syncs list search and filters to the URL', async () => {
    on('get', /\/bookings\?/, () => ({
      items: [],
      pagination: { page: 1, limit: 10, total: 0, totalPages: 1 },
    }));
    const user = userEvent.setup();
    renderWithProviders(
      [
        {
          path: '/account/bookings',
          element: (
            <>
              <BookingsListPage />
              <LocationProbe />
            </>
          ),
        },
      ],
      { route: '/account/bookings', user: makeUser() },
    );
    await user.click(await screen.findByRole('tab', { name: 'Cancelled' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search bookings' }), 'Udaipur{Enter}');
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('view=cancelled&q=Udaipur'),
    );
    expect(await screen.findByText('No bookings here')).toBeInTheDocument();
  });
});

describe('reviews, partner and operations', () => {
  it('requires every category score before publishing a review', async () => {
    on('get', /\/account\/reviews\/eligible$/, () => [
      {
        bookingReference: 'SS-7KQ2M9XA',
        hotel: { id: 'h1', name: 'Lakeview Haveli', slug: 'lakeview-haveli' },
        checkOut: '2026-11-20',
        reviewableUntil: '2027-05-19',
      },
    ]);
    on('get', /\/account\/reviews$/, () => []);
    on('post', /\/review$/, () => ({}));
    const user = userEvent.setup();
    renderWithProviders([{ path: '/account/reviews', element: <ReviewsPage /> }], {
      route: '/account/reviews',
      user: makeUser(),
    });
    await user.click(await screen.findByRole('button', { name: 'Write review' }));
    const publish = screen.getByRole('button', { name: 'Publish review' });
    expect(publish).toBeDisabled();
    for (const label of [
      'Cleanliness',
      'Staff',
      'Location',
      'Comfort',
      'Facilities',
      'Value for money',
    ])
      await user.click(screen.getByRole('radio', { name: `${label}: 4 of 5` }));
    await user.type(screen.getByLabelText('Title'), 'Lovely stay');
    await user.type(screen.getByLabelText('Your review'), 'Quiet rooms and a wonderful breakfast.');
    expect(publish).toBeEnabled();
    await user.click(publish);
    await waitFor(() =>
      expect(calls.find((c) => c.url.endsWith('/review'))?.body).toMatchObject({
        ratings: { cleanliness: 4, value: 4 },
        title: 'Lovely stay',
        photoIds: [],
      }),
    );
  });

  it('lets a partner check a guest in after confirming', async () => {
    on('get', /\/partner\/hotels$/, () => [
      {
        id: 'h1',
        name: 'Lakeview Haveli',
        slug: 'x',
        city: 'Udaipur',
        propertyType: 'HOTEL',
        publicationStatus: 'PUBLISHED',
        verificationStatus: 'VERIFIED',
        revisionStatus: 'NONE',
        coverImage: null,
        roomTypeCount: 1,
        updatedAt: new Date().toISOString(),
      },
    ]);
    on('get', /\/partner\/hotels\/h1\/bookings/, () => ({
      items: [
        {
          reference: 'SS-7KQ2M9XA',
          status: 'CONFIRMED',
          paymentStatus: 'SUCCESS',
          guestName: 'Meera Iyer',
          guestEmail: 'm@e.com',
          guestPhone: '+91',
          checkIn: '2027-03-01',
          checkOut: '2027-03-03',
          nights: 2,
          rooms: 1,
          guests: 2,
          roomSummary: '1 × Deluxe',
          specialRequests: '',
          estimatedArrivalTime: null,
          totalMinor: 1_050_000,
          currency: 'INR',
          createdAt: new Date().toISOString(),
          actions: { canCheckIn: true, canCheckOut: false, canMarkNoShow: true },
        },
      ],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    }));
    on('post', /\/check-in$/, () => ({}));
    const user = userEvent.setup();
    renderWithProviders([{ path: '/partner/reservations', element: <PartnerReservationsPage /> }], {
      route: '/partner/reservations',
      user: makeUser({ roles: ['CUSTOMER', 'HOTEL_OWNER'] }),
    });
    await user.click(await screen.findByRole('button', { name: 'Check in' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Check in' }),
    );
    await waitFor(() =>
      expect(calls.some((c) => c.url === '/partner/hotels/h1/bookings/SS-7KQ2M9XA/check-in')).toBe(
        true,
      ),
    );
  });

  it('shows operations exceptions and retries a failed refund', async () => {
    on('get', /\/admin\/operations$/, () => ({
      reconciliation: [
        {
          reference: 'SS-AAAAAAAA',
          status: 'RECONCILIATION_REQUIRED',
          paymentStatus: 'REFUND_PENDING',
          hotelName: 'Lakeview',
          customerEmail: 'c@e.com',
          totalMinor: 500_000,
          currency: 'INR',
          note: 'Late payment',
          updatedAt: new Date().toISOString(),
        },
      ],
      refunds: [
        {
          id: 'rf1',
          bookingReference: 'SS-BBBBBBBB',
          hotelName: 'Lakeview',
          amountMinor: 100_000,
          currency: 'INR',
          reason: 'Cancellation',
          status: 'FAILED',
          providerRefundId: null,
          failureReason: 'x',
          requestedAt: new Date().toISOString(),
          completedAt: null,
        },
      ],
      pendingRefundRequests: [],
      failedDeliveries: [],
      flaggedReviews: [],
      outbox: { pending: 0, failed: 0 },
    }));
    on('post', /\/admin\/refunds\/rf1\/retry$/, () => ({}));
    const user = userEvent.setup();
    renderWithProviders([{ path: '/admin/operations', element: <OperationsPage /> }], {
      route: '/admin/operations',
      user: makeUser({ roles: ['ADMIN'] }),
    });
    expect(await screen.findByText(/Late payment/)).toBeInTheDocument();
    await act(async () => user.click(screen.getByRole('button', { name: 'Retry' })));
    await waitFor(() => expect(calls.some((c) => c.url === '/admin/refunds/rf1/retry')).toBe(true));
  });
});
