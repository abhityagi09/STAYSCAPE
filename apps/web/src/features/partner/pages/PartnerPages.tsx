import { Navigate } from 'react-router';
import { Building2, CalendarRange, CheckCircle2, Clock, Plus } from 'lucide-react';
import { Alert, ButtonLink, Card, EmptyState, PageHeader, SkeletonText } from '@/components/ui';
import { useAuth } from '@/features/auth/use-auth';
import { usePartnerHotels } from '../api';
import { tr } from '@/lib/tr';

export { PartnerOnboardingPage } from './OnboardingPage';
export {
  PropertiesPage,
  PropertyLayout,
  PropertyOverviewPage,
  PropertyFormPage,
  PropertyMediaPage,
  PropertyPoliciesPage,
} from './PropertyPages';
export { RoomsPage, RoomFormPage, RatesPage } from './RoomsRatesPages';
export { InventoryPage } from './InventoryPage';

export function PartnerDashboardPage() {
  const { can } = useAuth();
  const hotels = usePartnerHotels(can('partner:access'));
  if (!can('partner:access')) return <Navigate to="/partner/onboarding" replace />;
  const list = hotels.data ?? [];
  const count = (pred: (s: string) => boolean) =>
    list.filter((h) => pred(h.publicationStatus)).length;
  const stats = [
    { label: tr('Published'), value: count((s) => s === 'PUBLISHED'), icon: CheckCircle2 },
    {
      label: tr('In review'),
      value:
        count((s) => s === 'SUBMITTED' || s === 'UNDER_REVIEW') +
        list.filter((h) => h.revisionStatus === 'SUBMITTED').length,
      icon: Clock,
    },
    {
      label: tr('Drafts & changes requested'),
      value: count((s) => s === 'DRAFT' || s === 'REJECTED'),
      icon: Building2,
    },
  ];
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={tr('Partner workspace')}
        title={tr('Overview')}
        description={tr(
          'Your properties at a glance. Reservations and payouts arrive with online booking.',
        )}
        actions={
          can('hotels:create') && (
            <ButtonLink
              to="/partner/properties/new"
              leftIcon={<Plus className="size-4" aria-hidden="true" />}
            >
              {tr('Add property')}
            </ButtonLink>
          )
        }
      />
      {hotels.isPending ? (
        <SkeletonText lines={4} />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<Building2 />}
          title={tr('Add your first property')}
          description={tr('Create a listing, add rooms and rates, then submit it for review.')}
          action={
            can('hotels:create') && (
              <ButtonLink to="/partner/properties/new">{tr('Add property')}</ButtonLink>
            )
          }
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            {stats.map((s) => (
              <Card key={s.label} className="flex items-center gap-4 p-5">
                <s.icon className="size-6 text-primary" aria-hidden="true" />
                <div>
                  <p className="font-display text-3xl font-semibold">{s.value}</p>
                  <p className="text-sm text-fg-muted">{s.label}</p>
                </div>
              </Card>
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            <ButtonLink
              to="/partner/properties"
              variant="outline"
              leftIcon={<Building2 className="size-4" aria-hidden="true" />}
            >
              {tr('Manage properties')}
            </ButtonLink>
            <ButtonLink
              to="/partner/inventory"
              variant="outline"
              leftIcon={<CalendarRange className="size-4" aria-hidden="true" />}
            >
              {tr('Inventory calendar')}
            </ButtonLink>
          </div>
          {list.some((h) => h.publicationStatus === 'APPROVED') && (
            <Alert tone="success">
              {tr(
                'Some approved listings are not yet published. Open them and choose “Publish to search”.',
              )}
            </Alert>
          )}
        </>
      )}
    </div>
  );
}
