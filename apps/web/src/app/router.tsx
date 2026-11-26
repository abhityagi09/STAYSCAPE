import { Navigate, createBrowserRouter, useLocation, type RouteObject } from 'react-router';
import { RedirectIfAuthenticated, RequireAuth } from '@/features/auth/guards';
import { AuthLayout } from '@/layouts/AuthLayout';
import { PublicLayout } from '@/layouts/PublicLayout';
import NotFoundPage, { ForbiddenPage, RouteErrorPage } from '@/pages/StatusPages';

/** Route-based code splitting: each screen group is its own chunk. */
const lazy =
  <M,>(load: () => Promise<M>, pick: (module: M) => React.ComponentType) =>
  async () => ({ Component: pick(await load()) });

const auth = () => import('@/features/auth/pages/LoginPage');
const account = () => import('@/features/account/pages/AccountPages');
const partner = () => import('@/features/partner/pages/PartnerPages');
const admin = () => import('@/features/admin/pages/AdminPages');
const legal = () => import('@/pages/LegalPages');
const workspaces = () => import('@/layouts/workspaces');
const market = () => import('@/features/marketplace/pages/MarketplacePages');
const review = () => import('@/features/admin/pages/MarketplaceReviewPages');
const checkout = () => import('@/features/bookings/pages/CheckoutPages');
const trips = () => import('@/features/bookings/pages/AccountBookingPages');
const extras = () => import('@/features/bookings/pages/AccountExtrasPages');
const reservations = () => import('@/features/partner/pages/ReservationsPages');
const operations = () => import('@/features/admin/pages/OperationsPage');
const partnerOps = () => import('@/features/ops/PartnerOpsPages');
const adminOps = () => import('@/features/ops/AdminOpsPages');
const contentPages = () => import('@/features/ops/ContentPages');
const customerOps = () => import('@/features/ops/CustomerPages');

/** Old /search links keep working. */
function SearchRedirect() {
  const location = useLocation();
  return <Navigate to={`/hotels${location.search}`} replace />;
}

/** Shown while the first lazily loaded route module downloads. */
function InitialLoading() {
  return (
    <div role="status" aria-live="polite" className="flex min-h-[50vh] items-center justify-center">
      <span className="sr-only">Loading…</span>
      <span
        aria-hidden="true"
        className="size-8 animate-spin rounded-full border-2 border-border border-t-brand"
      />
    </div>
  );
}

export const routes: RouteObject[] = [
  {
    errorElement: <RouteErrorPage />,
    hydrateFallbackElement: <InitialLoading />,
    children: [
      {
        element: <PublicLayout />,
        children: [
          {
            index: true,
            lazy: lazy(
              () => import('@/features/home/HomePage'),
              (m) => m.default,
            ),
          },
          { path: 'search', element: <SearchRedirect /> },
          {
            path: 'hotels',
            lazy: lazy(
              () => import('@/features/marketplace/pages/SearchResultsPage'),
              (m) => m.default,
            ),
          },
          {
            path: 'hotels/:slug',
            lazy: lazy(
              () => import('@/features/marketplace/pages/HotelDetailPage'),
              (m) => m.default,
            ),
          },
          { path: 'compare', lazy: lazy(market, (m) => m.ComparePage) },
          { path: 'checkout', lazy: lazy(checkout, (m) => m.CheckoutPage) },
          { path: 'checkout/payment', lazy: lazy(checkout, (m) => m.CheckoutPaymentPage) },
          {
            path: 'checkout/confirmation',
            lazy: lazy(checkout, (m) => m.CheckoutConfirmationPage),
          },
          { path: 'checkout/failure', lazy: lazy(checkout, (m) => m.CheckoutFailurePage) },
          { path: 'wishlists/shared/:token', lazy: lazy(extras, (m) => m.SharedWishlistPage) },
          { path: 'trips/shared/:token', lazy: lazy(customerOps, (m) => m.SharedTripPage) },
          { path: 'guides', lazy: lazy(contentPages, (m) => m.GuidesIndexPage) },
          {
            path: 'guides/:slug',
            lazy: lazy(contentPages, (m) => () => <m.ContentEntryPage type="GUIDE" />),
          },
          {
            path: 'blog/:slug',
            lazy: lazy(contentPages, (m) => () => <m.ContentEntryPage type="BLOG" />),
          },
          {
            path: 'legal/:slug',
            lazy: lazy(contentPages, (m) => () => <m.ContentEntryPage type="LEGAL" />),
          },
          { path: 'help/faq', lazy: lazy(contentPages, (m) => m.FaqPage) },
          { path: 'content/preview/:token', lazy: lazy(contentPages, (m) => m.ContentPreviewPage) },
          { path: 'partners', lazy: lazy(legal, (m) => m.PartnersLandingPage) },
          { path: 'terms', lazy: lazy(legal, (m) => m.TermsPage) },
          { path: 'privacy', lazy: lazy(legal, (m) => m.PrivacyPage) },
          { path: '403', element: <ForbiddenPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
      {
        element: <AuthLayout />,
        children: [
          {
            element: <RedirectIfAuthenticated />,
            children: [
              { path: 'login', lazy: lazy(auth, (m) => m.default) },
              {
                path: 'register',
                lazy: lazy(
                  () => import('@/features/auth/pages/RegisterPage'),
                  (m) => m.default,
                ),
              },
            ],
          },
          {
            path: 'forgot-password',
            lazy: lazy(
              () => import('@/features/auth/pages/ForgotPasswordPage'),
              (m) => m.default,
            ),
          },
          {
            path: 'reset-password',
            lazy: lazy(
              () => import('@/features/auth/pages/ResetPasswordPage'),
              (m) => m.default,
            ),
          },
          {
            path: 'verify-email',
            lazy: lazy(
              () => import('@/features/auth/pages/VerifyEmailPage'),
              (m) => m.default,
            ),
          },
        ],
      },
      {
        path: 'account',
        element: <RequireAuth />,
        children: [
          {
            lazy: lazy(workspaces, (m) => m.CustomerLayout),
            children: [
              { index: true, lazy: lazy(trips, (m) => m.AccountOverviewPage) },
              { path: 'bookings', lazy: lazy(trips, (m) => m.BookingsListPage) },
              { path: 'bookings/:reference', lazy: lazy(trips, (m) => m.BookingDetailPage) },
              { path: 'payments', lazy: lazy(trips, (m) => m.PaymentsPage) },
              { path: 'refunds', lazy: lazy(trips, (m) => m.RefundsPage) },
              { path: 'wishlists', lazy: lazy(extras, (m) => m.WishlistsPage) },
              { path: 'wishlists/:id', lazy: lazy(extras, (m) => m.WishlistDetailPage) },
              { path: 'reviews', lazy: lazy(extras, (m) => m.ReviewsPage) },
              { path: 'support', lazy: lazy(extras, (m) => m.SupportPage) },
              { path: 'support/new', lazy: lazy(extras, (m) => m.NewTicketPage) },
              { path: 'support/:id', lazy: lazy(extras, (m) => m.TicketPage) },
              { path: 'settings', lazy: lazy(extras, (m) => m.SettingsPage) },
              { path: 'profile', lazy: lazy(account, (m) => m.ProfilePage) },
              { path: 'checklist', lazy: lazy(account, (m) => m.CustomerDashboardPage) },
              // Older links keep working.
              { path: 'preferences', element: <Navigate to="/account/settings" replace /> },
              { path: 'security', element: <Navigate to="/account/settings" replace /> },
              { path: 'trips', element: <Navigate to="/account/bookings" replace /> },
              { path: 'notifications', lazy: lazy(account, (m) => m.NotificationsPage) },
              { path: 'saved', lazy: lazy(market, (m) => m.SavedStaysPage) },
              { path: 'rewards', lazy: lazy(customerOps, (m) => m.RewardsPage) },
              { path: 'price-alerts', lazy: lazy(customerOps, (m) => m.PriceAlertsPage) },
              { path: 'assistant', lazy: lazy(customerOps, (m) => m.AssistantPage) },
              { path: 'corporate', lazy: lazy(customerOps, (m) => m.CorporatePage) },
              { path: 'corporate/reports', lazy: lazy(customerOps, (m) => m.CorporateReportsPage) },
            ],
          },
        ],
      },
      {
        path: 'trips',
        element: <RequireAuth />,
        children: [
          {
            lazy: lazy(workspaces, (m) => m.CustomerLayout),
            children: [
              { index: true, lazy: lazy(customerOps, (m) => m.TripsPage) },
              { path: 'new', lazy: lazy(customerOps, (m) => m.TripFormPage) },
              { path: 'join', lazy: lazy(customerOps, (m) => m.TripJoinPage) },
              { path: ':id', lazy: lazy(customerOps, (m) => m.TripDetailPage) },
              { path: ':id/edit', lazy: lazy(customerOps, (m) => m.TripFormPage) },
            ],
          },
        ],
      },
      {
        path: 'partner',
        element: <RequireAuth />,
        children: [
          {
            lazy: lazy(workspaces, (m) => m.PartnerLayout),
            children: [
              { index: true, lazy: lazy(partner, (m) => m.PartnerDashboardPage) },
              { path: 'onboarding', lazy: lazy(partner, (m) => m.PartnerOnboardingPage) },
              {
                element: <RequireAuth permissions={['partner:access']} />,
                children: [
                  { path: 'properties', lazy: lazy(partner, (m) => m.PropertiesPage) },
                  {
                    path: 'properties/new',
                    lazy: lazy(partner, (m) => () => <m.PropertyFormPage mode="create" />),
                  },
                  { path: 'inventory', lazy: lazy(partner, (m) => m.InventoryPage) },
                  { path: 'bookings', lazy: lazy(reservations, (m) => m.PartnerReservationsPage) },
                  {
                    path: 'bookings/:hotelId/:reference',
                    lazy: lazy(reservations, (m) => m.PartnerReservationDetailPage),
                  },
                  { path: 'reservations', element: <Navigate to="/partner/bookings" replace /> },
                  { path: 'guests', element: <Navigate to="/partner/bookings" replace /> },
                  { path: 'rooms', element: <Navigate to="/partner/properties" replace /> },
                  { path: 'rates', element: <Navigate to="/partner/properties" replace /> },
                  { path: 'settings', element: <Navigate to="/account/profile" replace /> },
                  { path: 'dashboard', lazy: lazy(partnerOps, (m) => m.PartnerAnalyticsPage) },
                  { path: 'analytics', lazy: lazy(partnerOps, (m) => m.PartnerAnalyticsPage) },
                  { path: 'staff', lazy: lazy(partnerOps, (m) => m.PartnerStaffPage) },
                  { path: 'settlements', lazy: lazy(partnerOps, (m) => m.PartnerSettlementsPage) },
                  { path: 'payouts', element: <Navigate to="/partner/settlements" replace /> },
                  { path: 'channels', lazy: lazy(partnerOps, (m) => m.PartnerChannelsPage) },
                  { path: 'inventory/blocks', lazy: lazy(partnerOps, (m) => m.PartnerBlocksPage) },
                  { path: 'support', lazy: lazy(partnerOps, (m) => m.PartnerSupportPage) },
                  {
                    path: 'accessibility',
                    lazy: lazy(
                      () => import('@/features/ops/AccessibilityPages'),
                      (m) => m.PartnerAccessibilityPage,
                    ),
                  },
                  { path: 'reviews', lazy: lazy(reservations, (m) => m.PartnerReviewsPage) },
                  {
                    path: 'properties/:id',
                    lazy: lazy(partner, (m) => m.PropertyLayout),
                    children: [
                      { index: true, lazy: lazy(partner, (m) => m.PropertyOverviewPage) },
                      {
                        path: 'edit',
                        lazy: lazy(partner, (m) => () => <m.PropertyFormPage mode="edit" />),
                      },
                      { path: 'media', lazy: lazy(partner, (m) => m.PropertyMediaPage) },
                      { path: 'policies', lazy: lazy(partner, (m) => m.PropertyPoliciesPage) },
                      { path: 'rooms', lazy: lazy(partner, (m) => m.RoomsPage) },
                      { path: 'rooms/new', lazy: lazy(partner, (m) => m.RoomFormPage) },
                      { path: 'rooms/:roomId/edit', lazy: lazy(partner, (m) => m.RoomFormPage) },
                      { path: 'rates', lazy: lazy(partner, (m) => m.RatesPage) },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        path: 'admin',
        element: <RequireAuth permissions={['admin:access']} />,
        children: [
          {
            lazy: lazy(workspaces, (m) => m.AdminLayout),
            children: [
              { index: true, lazy: lazy(admin, (m) => m.AdminDashboardPage) },
              {
                path: 'users',
                element: <RequireAuth permissions={['users:read']} />,
                children: [{ index: true, lazy: lazy(admin, (m) => m.AdminUsersPage) }],
              },
              {
                path: 'audit-logs',
                element: <RequireAuth permissions={['audit:read']} />,
                children: [{ index: true, lazy: lazy(admin, (m) => m.AdminAuditPage) }],
              },
              { path: 'audit', element: <Navigate to="/admin/audit-logs" replace /> },
              ...(
                [
                  ['dashboard', 'reports:view', 'AdminPlatformDashboardPage'],
                  ['reports', 'analytics:platform', 'AdminReportsPage'],
                  ['customers', 'users:read', 'AdminCustomersPage'],
                  ['catalog', 'catalog:manage', 'AdminCatalogPage'],
                  ['bookings', 'bookings:read-all', 'AdminBookingsPage'],
                  ['payments', 'payments:read', 'AdminPaymentsPage'],
                  ['refunds', 'payments:read', 'AdminRefundsPage'],
                  ['commissions', 'payments:read', 'AdminCommissionsPage'],
                  ['settlements', 'payments:read', 'AdminSettlementsPage'],
                  ['coupons', 'coupons:manage', 'AdminCouponsPage'],
                  ['promotions', 'coupons:manage', 'AdminPromotionsPage'],
                  ['support', 'support:manage', 'AdminSupportPage'],
                  ['reviews', 'reviews:moderate', 'AdminReviewsPage'],
                  ['organizations', 'users:manage', 'AdminOrganizationsPage'],
                ] as const
              ).map(([path, permission, page]) => ({
                path,
                element: <RequireAuth permissions={[permission]} />,
                children: [{ index: true, lazy: lazy(adminOps, (m) => m[page]) }],
              })),
              {
                path: 'content',
                element: <RequireAuth permissions={['content:manage']} />,
                children: [{ index: true, lazy: lazy(contentPages, (m) => m.AdminContentPage) }],
              },
              { path: 'settings', lazy: lazy(admin, (m) => m.AdminSettingsPage) },
              {
                path: 'operations',
                element: <RequireAuth permissions={['payments:read']} />,
                children: [{ index: true, lazy: lazy(operations, (m) => m.OperationsPage) }],
              },
              {
                path: 'partners',
                element: <RequireAuth permissions={['partners:approve']} />,
                children: [
                  { index: true, lazy: lazy(review, (m) => m.AdminPartnersPage) },
                  { path: ':id', lazy: lazy(review, (m) => m.AdminPartnerDetailPage) },
                ],
              },
              {
                path: 'properties',
                element: <RequireAuth permissions={['hotels:moderate']} />,
                children: [
                  { index: true, lazy: lazy(review, (m) => m.AdminPropertiesPage) },
                  { path: ':id', lazy: lazy(review, (m) => m.AdminPropertyDetailPage) },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
];

export function createRouter() {
  return createBrowserRouter(routes);
}
