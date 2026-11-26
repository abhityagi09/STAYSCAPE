import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AgentTicketDto,
  HotelDetailDto,
  LoyaltySummaryDto,
  StaffDto,
  TripDto,
} from '@stayscape/shared';
import { calls, hotelCard, on, resetApi } from '@/test/api-mock';
import { makeUser, renderWithProviders } from '@/test/render';
import { I18nProvider, LanguageSwitcher, useI18n } from '@/lib/i18n';
import { AdminContentPage, SafeMarkdown } from './ContentPages';
import {
  AdminPlatformDashboardPage,
  AdminSettlementsPage,
  AdminSupportPage,
} from './AdminOpsPages';
import { AssistantPage, RewardsPage, TripDetailPage, TripsPage } from './CustomerPages';
import { HotelInsights } from './HotelInsights';
import { PartnerAnalyticsPage, PartnerChannelsPage, PartnerStaffPage } from './PartnerOpsPages';

vi.mock('@/lib/api/client', async () => (await import('@/test/api-mock')).apiClientMock());

const owner = makeUser({
  roles: ['CUSTOMER', 'HOTEL_OWNER'],
  permissions: ['partner:access', 'staff:manage'],
});
const admin = makeUser({
  roles: ['ADMIN'],
  permissions: [
    'admin:access',
    'reports:view',
    'support:manage',
    'payments:read',
    'settlements:manage',
    'content:manage',
  ],
});
const hotels = [
  {
    id: '64b0000000000000000000a1',
    name: 'Lakeview Haveli',
    slug: 'lakeview-haveli',
    city: 'Udaipur',
    propertyType: 'HOTEL',
    publicationStatus: 'PUBLISHED',
    verificationStatus: 'VERIFIED',
  },
];
const page = <T,>(items: T[]) => ({
  items,
  pagination: { page: 1, limit: 25, total: items.length, totalPages: 1 },
});

beforeEach(() => {
  resetApi();
  on('get', /\/partner\/hotels$/, () => hotels);
});

describe('partner performance dashboard', () => {
  it('shows KPIs from the API with period comparison and documented definitions', async () => {
    on('get', /\/partner\/analytics/, () => ({
      period: { from: '2026-10-27', to: '2026-11-26', currency: 'INR' },
      hotelIds: [hotels[0]!.id],
      kpis: {
        totalReservations: 12,
        upcomingArrivals: 3,
        currentGuests: 4,
        inHouseBookings: 2,
        completedStays: 7,
        cancelledBookings: 1,
        grossBookingValueMinor: 6_300_000,
        recognisedRoomRevenueMinor: 4_000_000,
        roomNightsSold: 8,
        availableRoomNights: 148,
        occupancyBp: 541,
        adrMinor: 500_000,
        revparMinor: 27_027,
        averageBookingValueMinor: 525_000,
        cancellationRateBp: 833,
        guestReviewScore: 4.6,
        reviewCount: 5,
        detailViews: 400,
        bookingConversionBp: 300,
        previousPeriod: { totalReservations: 8, grossBookingValueMinor: 4_200_000 },
      },
      trend: [
        {
          date: '2026-11-01',
          revenueMinor: 500_000,
          roomNightsSold: 1,
          availableRoomNights: 5,
          occupancyBp: 2000,
        },
      ],
      bookingTrend: [{ date: '2026-11-01', bookings: 2, cancellations: 0 }],
      roomPerformance: [
        {
          roomType: 'Deluxe Lake View',
          roomNightsSold: 8,
          revenueMinor: 4_000_000,
          adrMinor: 500_000,
        },
      ],
      reviewTrend: [],
    }));
    renderWithProviders(<PartnerAnalyticsPage />, { user: owner });
    expect(await screen.findByText('12')).toBeInTheDocument();
    expect(screen.getAllByText('▲ 50.0% vs previous period')).toHaveLength(2); // 12 vs 8 reservations; GBV 63k vs 42k
    expect(screen.getByText('5.4%')).toBeInTheDocument();
    expect(screen.getAllByText('₹40,000.00').length).toBeGreaterThan(0);
    expect(screen.getByRole('cell', { name: 'Deluxe Lake View' })).toBeInTheDocument();
    // Charts expose their numbers as a table on request.
    await userEvent.click(screen.getAllByRole('button', { name: 'Show as table' })[0]!);
    expect(screen.getAllByRole('cell', { name: '₹5,000.00' }).length).toBeGreaterThan(0);
    expect(
      screen.getByText('Average daily rate: recognised room revenue ÷ room nights sold.'),
    ).toBeInTheDocument();
    // Filtering by property re-queries with that property only.
    await userEvent.selectOptions(screen.getByLabelText('Property'), hotels[0]!.id);
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes(`hotelIds=${hotels[0]!.id}`))).toBe(true),
    );
  });

  it('shows an error with retry when analytics fail', async () => {
    on('get', /\/partner\/analytics/, () =>
      Object.assign(new Error('x'), {
        response: {
          status: 403,
          data: {
            success: false,
            error: {
              code: 'FORBIDDEN',
              message: 'You do not have analytics access to any property.',
            },
          },
        },
      }),
    );
    renderWithProviders(<PartnerAnalyticsPage />, { user: owner });
    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText('Reservations')).toBeNull();
  });
});

describe('partner team management', () => {
  it('invites with chosen properties and fine-grained permissions', async () => {
    on('get', /\/partner\/staff$/, (): StaffDto[] => []);
    on('post', /\/partner\/staff$/, () => ({}));
    renderWithProviders(<PartnerStaffPage />, { user: owner });
    await screen.findByText('No team members yet');
    await userEvent.type(screen.getByLabelText(/Email address/), 'desk@example.com');
    await userEvent.click(screen.getByLabelText('Lakeview Haveli'));
    await userEvent.click(screen.getByLabelText('Record check-in'));
    await userEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'post')?.body).toEqual({
        email: 'desk@example.com',
        assignedProperties: [hotels[0]!.id],
        permissions: ['bookings:view', 'bookings:check-in'],
      }),
    );
  });
});

describe('channel manager page', () => {
  it('is explicit that only the local simulator exists', async () => {
    on('get', /\/channels$/, () => []);
    on('get', /\/room-types$/, () => []);
    renderWithProviders(<PartnerChannelsPage />, { user: owner });
    expect(
      await screen.findByText(
        /needs that provider’s API access and a dedicated adapter, which has not been built or verified yet/,
      ),
    ).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Connect' })).toBeDisabled();
  });
});

describe('admin platform dashboard', () => {
  it('renders metrics with change against the previous period', async () => {
    on('get', /\/admin\/dashboard/, () => ({
      period: { from: '2026-10-27', to: '2026-11-27' },
      metrics: {
        totalBookings: 30,
        grossBookingValueMinor: 15_750_000,
        commissionRevenueMinor: 2_250_000,
        averageReviewRating: 4.4,
      },
      comparison: {
        totalBookings: { previous: 20, changeBp: 5000 },
        grossBookingValueMinor: { previous: 0, changeBp: null },
      },
    }));
    renderWithProviders(<AdminPlatformDashboardPage />, { user: admin });
    expect(await screen.findByText('30')).toBeInTheDocument();
    expect(screen.getByText('₹22,500.00')).toBeInTheDocument();
    expect(screen.getAllByText(/vs previous period/)).toHaveLength(1);
  });
});

describe('admin support queue', () => {
  it('opens a ticket, distinguishes internal notes, and sends one', async () => {
    const ticket: AgentTicketDto = {
      id: 't1',
      ticketNumber: 'TKT-AB12CD34',
      subject: 'Early check-in',
      category: 'BOOKING',
      status: 'IN_PROGRESS',
      bookingReference: 'SS-AAAA1111',
      lastMessageAt: '2026-11-26T08:00:00Z',
      createdAt: '2026-11-26T07:00:00Z',
      priority: 'HIGH',
      assignee: null,
      customer: { id: 'c1', name: 'Meera Iyer', email: 'meera@example.com' },
      hotel: { id: 'h1', name: 'Lakeview Haveli' },
      partnerVisible: false,
      escalated: false,
      escalationReason: null,
      firstResponseAt: null,
      resolvedAt: null,
      resolution: null,
      statusHistory: [],
      messages: [
        {
          id: 'm1',
          channel: 'CUSTOMER',
          author: 'CUSTOMER',
          authorName: 'Meera Iyer',
          body: 'Can we arrive at 8am?',
          attachments: [],
          createdAt: '2026-11-26T07:00:00Z',
        },
        {
          id: 'm2',
          channel: 'INTERNAL',
          author: 'AGENT',
          authorName: 'Agent',
          body: 'Repeat guest',
          attachments: [],
          createdAt: '2026-11-26T07:05:00Z',
        },
      ],
    };
    on('get', /\/admin\/support\/metrics/, () => ({
      created: 1,
      open: 1,
      resolved: 0,
      averageFirstResponseMinutes: null,
      averageResolutionHours: null,
    }));
    on('get', /\/admin\/support\/tickets\?/, () => page([ticket]));
    on('get', /\/admin\/support\/tickets\/t1/, () => ticket);
    on('post', /\/admin\/support\/tickets\/t1\/messages/, () => ticket);
    renderWithProviders(<AdminSupportPage />, { user: admin });
    await userEvent.click(await screen.findByRole('button', { name: /Early check-in/ }));
    const convo = await screen.findByRole('list', { name: 'Conversation' });
    expect(within(convo).getByText(/internal note/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Send to'), 'INTERNAL');
    // The property thread is offered only once the ticket is shared with the property.
    expect(
      within(screen.getByLabelText('Send to')).queryByRole('option', { name: 'Property' }),
    ).toBeNull();
    await userEvent.type(screen.getByLabelText('Message'), 'Called the hotel');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      const sent = calls.find((c) => c.method === 'post' && c.url.endsWith('/messages'))
        ?.body as FormData;
      expect(sent.get('channel')).toBe('INTERNAL');
      expect(sent.get('body')).toBe('Called the hotel');
    });
  });
});

describe('admin settlements', () => {
  it('never allows marking paid without a reference and a confirmation document', async () => {
    on('get', /\/admin\/settlements/, () =>
      page([
        {
          _id: 's1',
          reference: 'STL-1',
          partnerId: 'p1',
          status: 'ELIGIBLE',
          netPayableMinor: 900_000,
          currency: 'INR',
          entryCount: 3,
          createdAt: '2026-11-20T00:00:00Z',
          holdReason: null,
          evidence: null,
        },
      ]),
    );
    renderWithProviders(<AdminSettlementsPage />, { user: admin });
    expect(await screen.findByText('Automated payouts are disabled')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Record payment' }));
    const markPaid = screen.getByRole('button', { name: 'Mark paid' });
    expect(markPaid).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Transfer reference (UTR)'), 'UTR12345678');
    expect(markPaid).toBeDisabled(); // still no evidence file
  });
});

describe('content management', () => {
  it('saves a new draft with SEO fields', async () => {
    on('get', /\/admin\/content/, () => page([]));
    on('post', /\/admin\/content$/, () => ({}));
    renderWithProviders(<AdminContentPage />, { user: admin });
    await userEvent.click(await screen.findByRole('button', { name: 'New content' }));
    await userEvent.type(screen.getByLabelText('Slug'), 'monsoon-goa');
    await userEvent.type(screen.getByLabelText('Title'), 'Monsoon in Goa');
    await userEvent.type(screen.getByLabelText('SEO title'), 'Goa in the rain');
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'post')?.body).toMatchObject({
        type: 'GUIDE',
        locale: 'en',
        slug: 'monsoon-goa',
        title: 'Monsoon in Goa',
        seo: { title: 'Goa in the rain', noindex: false },
      }),
    );
  });

  it('renders Markdown without HTML, scripts or unsafe links', async () => {
    const { container } = renderWithProviders(
      <SafeMarkdown
        source={
          '## Why go\n\n<img src=x onerror=alert(1)> **bold** [bad](javascript:alert(1)) [ok](/hotels)\n\n- one\n- two'
        }
      />,
    );
    await screen.findByRole('heading', { name: 'Why go' });
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('h2')?.textContent).toBe('Why go');
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    expect([...container.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
      '/hotels',
    ]);
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>'); // shown as text, inert
  });
});

describe('TripSpace', () => {
  const trip: TripDto = {
    id: 'trip1',
    title: 'Udaipur weekend',
    description: '',
    destination: 'Udaipur',
    startDate: '2026-12-12',
    endDate: '2026-12-14',
    myRole: 'OWNER',
    members: [{ userId: 'u1', name: 'Asha R.', role: 'OWNER' }],
    pendingInvitations: 0,
    shared: false,
    items: [
      {
        id: 'i1',
        kind: 'BOOKING',
        title: 'Lakeview Haveli',
        note: '',
        date: '2026-12-12',
        hotel: { id: 'h1', name: 'Lakeview Haveli', slug: 'lakeview-haveli', city: 'Udaipur' },
        booking: {
          reference: 'SS-AAAA1111',
          checkIn: '2026-12-12',
          checkOut: '2026-12-14',
          status: 'CONFIRMED',
        },
        addedBy: 'Asha',
        createdAt: '2026-11-26T00:00:00Z',
      },
    ],
    updatedAt: '2026-11-26T00:00:00Z',
  };
  it('lists trips and shows an empty state', async () => {
    on('get', /\/trips$/, () => []);
    renderWithProviders(<TripsPage />, { user: makeUser() });
    expect(await screen.findByText('No trips yet')).toBeInTheDocument();
  });
  it('invites by email and shows the single-use link', async () => {
    on('get', /\/trips\/trip1$/, () => trip);
    on('post', /\/trips\/trip1\/invitations/, () => ({
      token: 'tok_'.padEnd(43, 'x'),
      expiresAt: '2026-12-10T00:00:00Z',
    }));
    renderWithProviders([{ path: '/trips/:id', element: <TripDetailPage /> }], {
      route: '/trips/trip1',
      user: makeUser(),
    });
    expect(await screen.findByText(/SS-AAAA1111/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Invite by email'), 'kabir@example.com');
    await userEvent.selectOptions(screen.getByLabelText('Can'), 'EDITOR');
    await userEvent.click(screen.getByRole('button', { name: 'Create invitation' }));
    expect(await screen.findByText(/\/trips\/join\?token=tok_/)).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'post')?.body).toEqual({
      email: 'kabir@example.com',
      role: 'EDITOR',
    });
  });
});

describe('rewards', () => {
  it('blocks redemption beyond the balance and explains the rules', async () => {
    const loyalty: LoyaltySummaryDto = {
      balance: 350,
      lifetimeEarned: 350,
      last12MonthsEarned: 350,
      tier: 'MEMBER',
      nextTier: { tier: 'SILVER', pointsNeeded: 1650 },
      pointValueMinor: 10,
      entries: [
        {
          id: 'e1',
          type: 'EARN',
          points: 100,
          description: 'Stay SS-AAAA1111',
          bookingReference: 'SS-AAAA1111',
          createdAt: '2026-11-20T00:00:00Z',
        },
      ],
    };
    on('get', /\/rewards\/loyalty/, () => loyalty);
    on('get', /\/rewards\/referrals/, () => ({
      code: 'ABCD1234',
      rewardedThisYear: 0,
      limitPerYear: 10,
      referrals: [],
      referredBy: null,
    }));
    renderWithProviders(<RewardsPage />, { user: makeUser() });
    expect((await screen.findAllByText('350')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Get coupon worth/ })).toBeDisabled();
    expect(screen.getByText('ABCD1234')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '+100' })).toBeInTheDocument();
  });
});

describe('AI travel assistant', () => {
  it('sends the message with history and shows only properties returned by Stayscape', async () => {
    on('post', /\/assistant\/messages/, () => ({
      answer: 'Lakeview Haveli has rooms for your dates.',
      hotels: [hotelCard({ name: 'Lakeview Haveli' })],
      quotes: [],
      followUpQuestions: ['Do you need breakfast?'],
      provider: 'rules',
      degraded: false,
      usage: { remainingToday: 49 },
    }));
    renderWithProviders(<AssistantPage />, { user: makeUser() });
    await userEvent.type(screen.getByLabelText(/Ask about places to stay/), 'Udaipur this weekend');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(
      await screen.findByText('Lakeview Haveli has rooms for your dates.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Lakeview Haveli' })).toHaveAttribute(
      'href',
      `/hotels/${hotelCard().slug}`,
    );
    expect(screen.getByText('49 messages left today.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'post')?.body).toEqual({
      message: 'Udaipur this weekend',
      history: [],
    });
    await userEvent.click(screen.getByRole('button', { name: 'Do you need breakfast?' }));
    expect(screen.getByLabelText(/Ask about places to stay/)).toHaveValue('Do you need breakfast?');
  });
});

describe('hotel insights', () => {
  it('labels who stated and who verified each accessibility feature, and explains TrustScore', async () => {
    on('get', /\/price-intelligence\//, () => []);
    const hotel = {
      ...hotelCard(),
      timeZone: 'Asia/Kolkata',
      currency: 'INR',
      accessibility: [
        {
          code: 'STEP_FREE_ENTRANCE',
          label: 'Step-free entrance',
          note: '',
          source: 'ADMIN_VERIFIED',
          verifiedAt: '2026-11-20T00:00:00.000Z',
        },
        {
          code: 'ROLL_IN_SHOWER',
          label: 'Roll-in shower',
          note: 'Rooms 101–104',
          source: 'PARTNER_DECLARED',
          verifiedAt: null,
        },
      ],
      trustScore: {
        score: null,
        confidence: 'LOW',
        basis: { reviews: 0, completedStays: 1, months: 0 },
        components: [
          {
            key: 'guest_reviews',
            label: 'Guest reviews',
            score: 63,
            weight: 40,
            detail: 'No reviews yet',
          },
        ],
        computedAt: '2026-11-26T00:00:00Z',
      },
    } as unknown as HotelDetailDto;
    renderWithProviders(<HotelInsights hotel={hotel} />, { user: null });
    expect(screen.getByText(/Checked by Stayscape/)).toBeInTheDocument();
    expect(screen.getByText('Stated by the property')).toBeInTheDocument();
    expect(screen.getByText(/Not enough stays or reviews yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
  });
});

describe('language preference', () => {
  function Probe() {
    const { t } = useI18n();
    return <p>{t('nav.bookings')}</p>;
  }
  it('switches to Hindi, persists the choice and sets the document language', async () => {
    renderWithProviders(
      <I18nProvider>
        <LanguageSwitcher />
        <Probe />
      </I18nProvider>,
      { user: null },
    );
    expect(screen.getByText('Bookings')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Language'), 'hi');
    expect(await screen.findByText('बुकिंग')).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('hi');
    expect(localStorage.getItem('stayscape.language')).toBe('hi');
  });
});
