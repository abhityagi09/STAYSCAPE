import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, type InventoryDayDto, type PartnerApplicationDto } from '@stayscape/shared';
import { todayIsoDate } from '@/components/ui';
import { calls, on, resetApi } from '@/test/api-mock';
import { makeUser, renderWithProviders } from '@/test/render';
import { InventoryPage } from './pages/InventoryPage';
import { PartnerOnboardingPage } from './pages/OnboardingPage';
import { PropertyFormPage } from './pages/PropertyPages';

vi.mock('@/lib/api/client', async () => (await import('@/test/api-mock')).apiClientMock());
vi.mock('@/components/map/MapView', () => ({
  MapView: ({
    onMapClick,
    label,
  }: {
    onMapClick?: (p: { lat: number; lng: number }) => void;
    label: string;
  }) => (
    <button type="button" aria-label={label} onClick={() => onMapClick?.({ lat: 15.5, lng: 73.8 })}>
      map
    </button>
  ),
}));

const owner = makeUser({
  roles: ['CUSTOMER', 'HOTEL_OWNER'],
  permissions: ['partner:access', 'hotels:create', 'hotels:update', 'rooms:manage'],
});

beforeEach(() => {
  resetApi();
  on('get', /\/amenities/, () => [
    { code: 'wifi', name: 'Free Wi-Fi', category: 'GENERAL', icon: 'wifi', description: null },
    { code: 'pool', name: 'Swimming pool', category: 'WELLNESS', icon: 'waves', description: null },
  ]);
});

describe('partner property form', () => {
  it('validates required fields before creating a listing', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      [{ path: '/partner/properties/new', element: <PropertyFormPage mode="create" /> }],
      { route: '/partner/properties/new', user: owner },
    );
    await user.click(await screen.findByRole('button', { name: 'Create property' }));
    expect(await screen.findByText('Property name is required')).toBeInTheDocument();
    expect(screen.getByText('Description is required')).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'post')).toHaveLength(0);
  });

  it('creates a listing with map-picked coordinates and selected amenities', async () => {
    on('post', /^\/partner\/hotels$/, () => ({ id: 'h1' }));
    const user = userEvent.setup();
    renderWithProviders(
      [
        { path: '/partner/properties/new', element: <PropertyFormPage mode="create" /> },
        { path: '/partner/properties/:id/media', element: <p>media step</p> },
      ],
      { route: '/partner/properties/new', user: owner },
    );
    await user.type(await screen.findByLabelText(/^Property name/), 'Palm Cove Resort');
    await user.type(screen.getByLabelText(/^Short description/), 'Beachfront resort');
    await user.type(
      screen.getByLabelText(/^Full description/),
      'A beachfront resort with palm gardens, a lagoon pool and quiet sea-view rooms.',
    );
    await user.type(screen.getByLabelText(/^Address line 1/), '1 Beach Road');
    await user.type(screen.getByLabelText(/^City/), 'Goa');
    await user.type(screen.getByLabelText(/^State/), 'Goa');
    await user.type(screen.getByLabelText(/^Postal code/), '403001');
    await user.type(screen.getByLabelText(/^Reservations phone/), '+919812345678');
    await user.type(screen.getByLabelText(/^Reservations email/), 'stay@palmcove.example');
    await user.click(screen.getByRole('button', { name: 'Choose the property location' }));
    await user.click(screen.getByRole('checkbox', { name: 'Swimming pool' }));
    await user.click(screen.getByRole('button', { name: 'Create property' }));
    expect(await screen.findByText('media step')).toBeInTheDocument();
    const body = calls.find((c) => c.method === 'post')?.body as Record<string, unknown>;
    expect(body).toMatchObject({
      name: 'Palm Cove Resort',
      city: 'Goa',
      location: { lat: 15.5, lng: 73.8 },
      amenities: ['pool'],
      languagesSpoken: ['English'],
    });
  });
});

describe('inventory calendar', () => {
  const days = (from: string, count: number): InventoryDayDto[] =>
    Array.from({ length: count }, (_, i) => ({
      date: addDays(from, i),
      totalRooms: 5,
      blockedRooms: i === 3 ? 2 : 0,
      maintenanceRooms: 0,
      stopSell: false,
      heldRooms: 0,
      bookedRooms: i === 4 ? 5 : 0,
      available: i === 3 ? 3 : i === 4 ? 0 : 5,
      closedToArrival: false,
      closedToDeparture: false,
      minimumStay: null,
      maximumStay: null,
    }));

  beforeEach(() => {
    on('get', /^\/partner\/hotels$/, () => [
      {
        id: 'h1',
        name: 'Lake Inn',
        slug: 'lake-inn',
        city: 'Udaipur',
        propertyType: 'HOTEL',
        publicationStatus: 'PUBLISHED',
        verificationStatus: 'VERIFIED',
        revisionStatus: 'NONE',
        coverImage: null,
        roomTypeCount: 1,
        updatedAt: '',
      },
    ]);
    on('get', /\/room-types$/, () => [
      { id: 'r1', name: 'Deluxe', status: 'ACTIVE', totalInventory: 5 },
    ]);
    on('get', /\/inventory\?/, (url) => {
      const from = new URLSearchParams(url.split('?')[1]).get('from')!;
      return days(from, 7);
    });
  });

  it('shows availability per day and applies a range update', async () => {
    on('patch', /\/inventory$/, () => []);
    const user = userEvent.setup();
    renderWithProviders([{ path: '/partner/inventory', element: <InventoryPage /> }], {
      route: '/partner/inventory',
      user: owner,
    });
    await user.click(await screen.findByRole('button', { name: 'Week' }));
    const today = todayIsoDate();
    const grid = await screen.findByRole('group', { name: 'Inventory by date' });
    expect(
      within(grid).getByRole('button', {
        name: new RegExp(`^${addDays(today, 4)} 0 avail.*5 booked`),
      }),
    ).toBeInTheDocument();

    await user.click(
      within(grid).getByRole('button', { name: new RegExp(`^${addDays(today, 1)} `) }),
    );
    await user.click(
      within(grid).getByRole('button', { name: new RegExp(`^${addDays(today, 2)} `) }),
    );
    await user.type(screen.getByLabelText(/^Blocked rooms/), '1');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Closed to arrival' }), 'on');
    await user.click(screen.getByRole('button', { name: 'Apply to range' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'patch')?.body).toEqual({
        roomTypeId: 'r1',
        from: addDays(today, 1),
        to: addDays(today, 2),
        daysOfWeek: [],
        set: { blockedRooms: 1, closedToArrival: true },
      }),
    );
  });

  it('reports conflicting dates when rooms are already committed', async () => {
    on('patch', /\/inventory$/, () =>
      Object.assign(new Error('conflict'), {
        isAxiosError: true,
        response: {
          status: 409,
          data: {
            success: false,
            error: {
              code: 'CONFLICT',
              message: 'Cannot block 5 rooms: reservations already use those rooms.',
              details: { dates: ['2030-01-05'] },
            },
          },
        },
      }),
    );
    const user = userEvent.setup();
    renderWithProviders([{ path: '/partner/inventory', element: <InventoryPage /> }], {
      route: '/partner/inventory',
      user: owner,
    });
    await user.click(await screen.findByRole('button', { name: 'Week' }));
    const grid = await screen.findByRole('group', { name: 'Inventory by date' });
    await user.click(
      within(grid).getByRole('button', { name: new RegExp(`^${addDays(todayIsoDate(), 1)} `) }),
    );
    await user.click(
      within(grid).getByRole('button', { name: new RegExp(`^${addDays(todayIsoDate(), 1)} `) }),
    );
    await user.type(screen.getByLabelText(/^Blocked rooms/), '5');
    await user.click(screen.getByRole('button', { name: 'Apply to range' }));
    expect(await screen.findByText(/Conflicting dates: 2030-01-05/)).toBeInTheDocument();
  });
});

describe('partner onboarding wizard', () => {
  const app = (overrides: Partial<PartnerApplicationDto> = {}): PartnerApplicationDto => ({
    id: 'p1',
    ownerId: 'u1',
    verificationStatus: 'REGISTERED',
    business: {},
    contact: {},
    tax: {},
    settlementAccount: null,
    documents: [],
    missingRequirements: ['Owner and business information'],
    rejectionReason: null,
    submittedAt: null,
    approvedAt: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  });

  it('saves a step as a draft and advances', async () => {
    on('get', /\/partner\/application$/, () => null);
    on('put', /\/partner\/application$/, (_u, body) =>
      app({ business: (body as { business: PartnerApplicationDto['business'] }).business }),
    );
    const user = userEvent.setup();
    renderWithProviders([{ path: '/partner/onboarding', element: <PartnerOnboardingPage /> }], {
      route: '/partner/onboarding',
      user: makeUser(),
    });
    await user.type(
      await screen.findByLabelText(/^Owner \/ authorised signatory name/),
      'Ravi Menon',
    );
    await user.type(screen.getByLabelText(/^Registered business name/), 'Lakeview LLP');
    await user.click(screen.getByRole('button', { name: 'Save and continue' }));
    expect(
      await screen.findByRole('heading', { name: 'Business address and contact details' }),
    ).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'put')?.body).toEqual({
      business: {
        businessName: 'Lakeview LLP',
        businessType: 'PRIVATE_LIMITED',
        ownerName: 'Ravi Menon',
      },
    });
  });

  it('shows the rejection reason and lets the owner resubmit', async () => {
    on('get', /\/partner\/application$/, () =>
      app({
        verificationStatus: 'REJECTED',
        rejectionReason: 'GSTIN does not match PAN',
        missingRequirements: [],
      }),
    );
    on('post', /\/submit$/, () =>
      app({ verificationStatus: 'UNDER_REVIEW', missingRequirements: [] }),
    );
    const user = userEvent.setup();
    renderWithProviders([{ path: '/partner/onboarding', element: <PartnerOnboardingPage /> }], {
      route: '/partner/onboarding',
      user: makeUser(),
    });
    expect(await screen.findByText(/GSTIN does not match PAN/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Review & submit/ }));
    await user.click(screen.getByRole('button', { name: 'Submit for review' }));
    expect(await screen.findByText('Under review')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit for review' })).not.toBeInTheDocument();
  });
});
