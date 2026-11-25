import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HotelDetailDto, QuoteDto } from '@stayscape/shared';
import { calls, hotelCard, image, on, paginated, resetApi } from '@/test/api-mock';
import { makeUser, renderWithProviders } from '@/test/render';
import { toggleCompare } from './compare-slice';
import { ComparePage } from './pages/MarketplacePages';
import HotelDetailPage from './pages/HotelDetailPage';
import SearchResultsPage from './pages/SearchResultsPage';
import HomePage from '@/features/home/HomePage';
import { DEFAULT_SEARCH, clearFilters, parseSearch, toSearchParams } from './search-state';
import { StaySearchBar } from './components/StaySearchBar';
import { useState } from 'react';

vi.mock('@/lib/api/client', async () => (await import('@/test/api-mock')).apiClientMock());
vi.mock('@/components/map/MapView', () => ({
  MapView: ({
    markers,
    label,
  }: {
    markers: Array<{ id: string; label: string }>;
    label: string;
  }) => (
    <div role="region" aria-label={label} data-testid="map">
      {markers.map((m) => m.label).join('|')}
    </div>
  ),
}));

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}
const withProbe = (element: React.ReactNode) => (
  <>
    {element}
    <LocationProbe />
  </>
);

beforeEach(() => {
  resetApi();
  localStorage.clear();
  sessionStorage.clear();
  on('get', /\/amenities/, () => [
    { code: 'spa', name: 'Spa', category: 'WELLNESS', icon: 'flower', description: null },
  ]);
});

describe('search state ⇄ URL', () => {
  it('round-trips criteria and drops invalid values', () => {
    const state = {
      ...DEFAULT_SEARCH,
      destination: 'Goa',
      checkIn: '2027-03-01',
      checkOut: '2027-03-04',
      children: 1,
      childrenAges: [7],
      pool: true,
      stars: [4, 5],
      sort: 'price_asc' as const,
    };
    expect(parseSearch(toSearchParams(state))).toEqual(state);
    const bad = parseSearch(
      new URLSearchParams(
        'checkIn=2027-03-05&checkOut=2027-03-01&sort=price_asc&adults=99&propertyTypes=CASTLE,VILLA',
      ),
    );
    expect(bad).toMatchObject({
      checkIn: '',
      checkOut: '',
      sort: 'recommended',
      adults: 2,
      propertyTypes: ['VILLA'],
    });
    expect(clearFilters(state)).toMatchObject({
      destination: 'Goa',
      pool: false,
      stars: [],
      sort: 'price_asc',
    });
  });
});

describe('search results page', () => {
  const priced = (id: string, name: string, total: number) =>
    hotelCard({
      id,
      name,
      slug: name.toLowerCase().replace(/ /g, '-'),
      price: {
        totalMinor: total,
        nightlyAverageMinor: total / 2,
        currency: 'INR',
        nights: 2,
        rooms: 1,
        roomTypeName: 'Deluxe',
        ratePlanName: 'Flexible',
        mealPlan: 'BREAKFAST',
        freeCancellation: true,
        roomsLeft: 2,
        taxesIncluded: true,
      },
    });

  it('renders real results, syncs filters and sorting to the URL and refetches', async () => {
    on('get', /\/hotels\?/, (url) =>
      paginated(
        url.includes('pool=true')
          ? [priced('64b0000000000000000000a2', 'Pool House', 900_000)]
          : [
              priced('64b0000000000000000000a1', 'Lake Inn', 500_000),
              priced('64b0000000000000000000a2', 'Pool House', 900_000),
            ],
        { availabilityChecked: true, nights: 2 },
      ),
    );
    const user = userEvent.setup();
    renderWithProviders([{ path: '/hotels', element: withProbe(<SearchResultsPage />) }], {
      route: '/hotels?destination=Udaipur&checkIn=2027-03-01&checkOut=2027-03-03',
      user: null,
    });

    expect(await screen.findByRole('heading', { name: 'Stays in Udaipur' })).toBeInTheDocument();
    expect(await screen.findByText(/2 properties available for 2 nights/)).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.getAllByText(/2 left/, { selector: 'span' })).toHaveLength(2);

    await user.click(
      within(screen.getByRole('complementary', { name: 'Filters' })).getByRole('checkbox', {
        name: 'Pool',
      }),
    );
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('pool=true'));
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(1));
    expect(
      calls.some((c) => c.url.includes('pool=true') && c.url.includes('checkIn=2027-03-01')),
    ).toBe(true);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'price_desc');
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('sort=price_desc'),
    );
  });

  it('only offers price sorting when dates are chosen', async () => {
    on('get', /\/hotels\?/, () => paginated([hotelCard()]));
    renderWithProviders([{ path: '/hotels', element: <SearchResultsPage /> }], {
      route: '/hotels',
      user: null,
    });
    const sort = await screen.findByRole('combobox', { name: 'Sort by' });
    expect(within(sort).queryByRole('option', { name: /Price/ })).not.toBeInTheDocument();
    expect(await screen.findByText('Add dates to see prices')).toBeInTheDocument();
  });

  it('shows an empty state with a working clear-filters action', async () => {
    on('get', /\/hotels\?/, (url) => paginated(url.includes('stars=5') ? [] : [hotelCard()]));
    const user = userEvent.setup();
    renderWithProviders([{ path: '/hotels', element: withProbe(<SearchResultsPage />) }], {
      route: '/hotels?stars=5',
      user: null,
    });
    expect(
      await screen.findByRole('heading', { name: 'No stays match your search' }),
    ).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]!);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/hotels$/));
    expect(await screen.findByRole('article')).toBeInTheDocument();
  });

  it('switches to the map view with price markers and keeps the accessible list', async () => {
    on('get', /\/hotels\?/, () =>
      paginated([priced('64b0000000000000000000a1', 'Lake Inn', 500_000)], {
        availabilityChecked: true,
        nights: 2,
      }),
    );
    const user = userEvent.setup();
    renderWithProviders([{ path: '/hotels', element: <SearchResultsPage /> }], {
      route: '/hotels?checkIn=2027-03-01&checkOut=2027-03-03',
      user: null,
    });
    await screen.findByRole('article');
    await user.click(screen.getByRole('button', { name: 'Map' }));
    expect(screen.getByTestId('map')).toHaveTextContent('₹2,500');
    expect(screen.getByRole('article')).toBeInTheDocument();
  });

  it('adds stays to the comparison tray (max four) and asks anonymous users to sign in to save', async () => {
    on('get', /\/hotels\?/, () => paginated([hotelCard()]));
    const user = userEvent.setup();
    const { store } = renderWithProviders(
      [
        { path: '/hotels', element: <SearchResultsPage /> },
        { path: '/login', element: <p>login page</p> },
      ],
      { route: '/hotels', user: null },
    );
    await user.click(await screen.findByRole('button', { name: 'Compare' }));
    expect(store.getState().compare.items).toEqual([
      { id: '64b0000000000000000000a1', name: 'Lakeview Haveli' },
    ]);
    expect(screen.getByRole('region', { name: 'Comparison tray' })).toHaveTextContent(
      'Lakeview Haveli',
    );
    expect(JSON.parse(localStorage.getItem('stayscape.compare') ?? '[]')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Save Lakeview Haveli' }));
    expect(await screen.findByText('login page')).toBeInTheDocument();
  });
});

describe('hotel detail page', () => {
  const detail: HotelDetailDto = {
    ...hotelCard(),
    description: 'A restored haveli on the lake.',
    address: { line1: '12 Lake Road' },
    postalCode: '313001',
    timeZone: 'Asia/Kolkata',
    currency: 'INR',
    amenityDetails: [
      {
        code: 'pool',
        name: 'Swimming pool',
        category: 'WELLNESS',
        icon: 'waves',
        description: null,
      },
    ],
    languagesSpoken: ['English'],
    images: [image('a'), image('b'), image('c')],
    videos: [],
    policies: {
      petsAllowed: false,
      smokingAllowed: false,
      coupleFriendly: true,
      minimumCheckInAge: 18,
      additionalRules: [],
    },
    checkInTime: '14:00',
    checkOutTime: '11:00',
    nearbyAttractions: [],
    contactDetails: { phone: '+919800000000', email: 'a@b.co' },
    roomTypes: [
      {
        id: 'r1',
        name: 'Deluxe Lake View',
        description: 'Big room',
        images: [],
        roomSize: 30,
        roomSizeUnit: 'SQM',
        bedConfiguration: [{ type: 'KING', count: 1 }],
        maximumAdults: 2,
        maximumChildren: 1,
        maximumOccupancy: 3,
        amenities: [],
        ratePlans: [],
      },
    ],
  };
  const quote: QuoteDto = {
    quoteToken: 'signed.token',
    expiresAt: new Date(Date.now() + 900_000).toISOString(),
    hotel: { id: detail.id, name: detail.name, slug: detail.slug },
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
    roomsLeft: 4,
  };

  beforeEach(() => {
    on('get', /\/hotels\/lakeview-haveli-udaipur$/, () => detail);
    on('get', /\/similar$/, () => []);
    on('get', /\/offers\?/, () => [
      { roomType: detail.roomTypes[0], available: 4, unavailableReason: null, offers: [quote] },
    ]);
  });

  it('opens a keyboard-navigable full-screen gallery', async () => {
    const user = userEvent.setup();
    renderWithProviders([{ path: '/hotels/:slug', element: <HotelDetailPage /> }], {
      route: '/hotels/lakeview-haveli-udaipur',
      user: null,
    });
    await user.click(await screen.findByRole('button', { name: /View all 3 photos/ }));
    const dialog = screen.getByRole('dialog', { name: 'Lakeview Haveli photos' });
    expect(dialog).toHaveTextContent('Photo 1 of 3');
    await user.keyboard('{ArrowRight}');
    expect(dialog).toHaveTextContent('Photo 2 of 3');
    await user.keyboard('{End}');
    expect(dialog).toHaveTextContent('Photo 3 of 3');
    await user.keyboard('{ArrowRight}');
    expect(dialog).toHaveTextContent('Photo 1 of 3');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows live offers for the dates, selects a rate and preserves the selection for booking', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      [
        { path: '/hotels/:slug', element: <HotelDetailPage /> },
        { path: '/checkout', element: withProbe(<p>checkout</p>) },
      ],
      {
        route: '/hotels/lakeview-haveli-udaipur?checkIn=2027-03-01&checkOut=2027-03-03',
        user: null,
      },
    );
    expect(
      await screen.findByText('Free cancellation until 48 h before check-in'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Select' }));
    const summary = screen.getByRole('complementary', { name: 'Booking summary' });
    expect(within(summary).getByText('₹10,500.00')).toBeInTheDocument();
    expect(within(summary).getByText('GST')).toBeInTheDocument();
    await user.click(within(summary).getByRole('button', { name: 'Continue to booking' }));
    expect(await screen.findByTestId('location')).toHaveTextContent('/checkout?quote=signed.token');
    expect(
      JSON.parse(sessionStorage.getItem('stayscape.selection') ?? '{}').quote.totals.totalMinor,
    ).toBe(1_050_000);
  });

  it('asks for dates before showing prices', async () => {
    renderWithProviders([{ path: '/hotels/:slug', element: <HotelDetailPage /> }], {
      route: '/hotels/lakeview-haveli-udaipur',
      user: null,
    });
    expect(
      await screen.findByText('Choose dates to see live availability and prices for each room.'),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.url.includes('/offers'))).toBe(false);
  });
});

describe('comparison page', () => {
  it('compares saved stays side by side using backend data', async () => {
    on('get', /\/hotels\/compare/, () => [
      {
        ...hotelCard({ name: 'Lake Inn' }),
        breakfastAvailable: true,
        parking: false,
        pool: true,
        freeCancellationAvailable: true,
        cancellationTypes: ['FREE_CANCELLATION'],
        roomCategories: 3,
        totalRooms: 20,
        checkInTime: '14:00',
        checkOutTime: '11:00',
        policies: { petsAllowed: true, smokingAllowed: false, minimumCheckInAge: 18 },
        availableForDates: null,
      },
      {
        ...hotelCard({
          id: '64b0000000000000000000b2',
          name: 'Hill Lodge',
          propertyType: 'GUESTHOUSE',
        }),
        breakfastAvailable: false,
        parking: true,
        pool: false,
        freeCancellationAvailable: false,
        cancellationTypes: [],
        roomCategories: 2,
        totalRooms: 6,
        checkInTime: '12:00',
        checkOutTime: '10:00',
        policies: { petsAllowed: false, smokingAllowed: false, minimumCheckInAge: 21 },
        availableForDates: null,
      },
    ]);
    const { store } = renderWithProviders([{ path: '/compare', element: <ComparePage /> }], {
      route: '/compare',
      user: null,
    });
    store.dispatch(toggleCompare({ id: '64b0000000000000000000a1', name: 'Lake Inn' }));
    store.dispatch(toggleCompare({ id: '64b0000000000000000000b2', name: 'Hill Lodge' }));
    const table = await screen.findByRole('table');
    expect(
      within(table).getByRole('rowheader', { name: 'Minimum check-in age' }).parentElement,
    ).toHaveTextContent('1821');
    expect(
      within(table).getByRole('rowheader', { name: 'Property type' }).parentElement,
    ).toHaveTextContent('BoutiqueGuesthouse');
    expect(calls.find((c) => c.url.startsWith('/hotels/compare'))?.url).toContain(
      'ids=64b0000000000000000000a1%2C64b0000000000000000000b2',
    );
  });
});

describe('stay search bar', () => {
  it('keeps what the user typed when the parent re-renders with equal criteria', async () => {
    const onSearch = vi.fn();
    function Parent() {
      const [, setTick] = useState(0);
      return (
        <>
          <button type="button" onClick={() => setTick((t) => t + 1)}>
            rerender
          </button>
          {/* A fresh object every render, as HomePage passes it. */}
          <StaySearchBar initial={{ ...DEFAULT_SEARCH }} onSearch={onSearch} />
        </>
      );
    }
    const user = userEvent.setup();
    renderWithProviders([{ path: '/', element: <Parent /> }], { route: '/', user: null });
    await user.type(screen.getByRole('combobox', { name: 'Destination' }), 'Goa');
    await user.click(screen.getByRole('button', { name: 'rerender' }));
    expect(screen.getByRole('combobox', { name: 'Destination' })).toHaveValue('Goa');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(onSearch).toHaveBeenCalledWith(expect.objectContaining({ destination: 'Goa' }));
  });
});

describe('homepage', () => {
  it('renders sections from real API data with loading and empty states', async () => {
    on('get', /\/destinations$/, () => [
      {
        id: 'd1',
        name: 'Goa',
        slug: 'goa',
        city: 'Goa',
        region: 'Goa',
        country: 'IN',
        coordinates: { lat: 15, lng: 74 },
        description: 'Beaches',
        imageUrl: null,
        popularityScore: 1,
        propertyCount: 7,
      },
    ]);
    on('get', /\/hotels\/featured/, () => [hotelCard({ name: 'Featured Stay', featured: true })]);
    on('get', /\/hotels\/trending/, () => []);
    on('get', /\/hotels\?/, () => paginated([hotelCard({ name: 'Searched Stay' })]));
    renderWithProviders([{ path: '/', element: <HomePage /> }], { route: '/', user: makeUser() });
    expect(await screen.findByRole('link', { name: /Goa.*7 stays/ })).toHaveAttribute(
      'href',
      '/hotels?destination=goa',
    );
    expect(await screen.findByText('Featured Stay')).toBeInTheDocument();
    const trending = screen.getByRole('region', { name: 'Popular right now' });
    expect(await within(trending).findByText('Nothing to show yet')).toBeInTheDocument();
    expect(calls.some((c) => c.url.includes('sort=price_asc') && c.url.includes('checkIn='))).toBe(
      true,
    );
  });
});
