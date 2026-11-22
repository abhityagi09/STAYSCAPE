import { Navigate } from 'react-router';
import { BedDouble, Building2, CalendarCheck, Check, Circle, Clock, Wallet } from 'lucide-react';
import {
  Accordion,
  Alert,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
} from '@/components/ui';
import { useAuth } from '@/features/auth/use-auth';
import { cn } from '@/lib/cn';

export function PartnerDashboardPage() {
  const { can } = useAuth();
  if (!can('partner:access')) return <Navigate to="/partner/onboarding" replace />;

  const modules = [
    {
      icon: Building2,
      title: 'Properties',
      phase: 'Phase 2',
      body: 'Create listings, upload photos, set amenities and house rules.',
    },
    {
      icon: BedDouble,
      title: 'Rooms & rates',
      phase: 'Phase 2',
      body: 'Room types, calendar inventory and nightly rates in your local currency.',
    },
    {
      icon: CalendarCheck,
      title: 'Reservations',
      phase: 'Phase 3',
      body: 'Arrivals, departures and guest communication.',
    },
    {
      icon: Wallet,
      title: 'Payouts',
      phase: 'Phase 3',
      body: 'Settlement statements and payout history.',
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Partner workspace"
        title="Overview"
        description="Manage your properties on STAYSCAPE."
      />
      <Alert tone="info" title="Property tools are being rolled out">
        Your partner access is active. Listing and inventory management arrive with the property
        module; nothing here is live to travellers yet.
      </Alert>
      <section aria-labelledby="partner-modules" className="flex flex-col gap-4">
        <h2 id="partner-modules" className="font-display text-xl font-semibold">
          Workspace modules
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {modules.map((module) => (
            <Card key={module.title}>
              <CardHeader className="flex-row items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-full bg-primary-soft text-primary">
                    <module.icon className="size-5" aria-hidden="true" />
                  </span>
                  <CardTitle>{module.title}</CardTitle>
                </div>
                <Badge tone="outline">{module.phase}</Badge>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-fg-muted">{module.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
      <EmptyState
        icon={<Building2 />}
        title="No properties yet"
        description="Once the property module is available you'll add your first listing here. Listings go live only after STAYSCAPE verification."
      />
    </div>
  );
}

export function PartnerOnboardingPage() {
  const { user, can } = useAuth();
  const isPartner = can('partner:access');

  const steps = [
    {
      title: 'Create a STAYSCAPE account',
      status: 'done' as const,
      body: 'You are signed in. This account will own your partner profile.',
    },
    {
      title: 'Verify your email address',
      status: user?.emailVerified ? ('done' as const) : ('todo' as const),
      body: 'Required so we can reach you about verification and reservations.',
    },
    {
      title: 'Business details & KYC',
      status: 'upcoming' as const,
      body: 'Legal entity, GST/tax registration, authorised signatory and payout bank account.',
    },
    {
      title: 'Create your first property listing',
      status: 'upcoming' as const,
      body: 'Address and map pin, photos, room types, amenities, policies and nightly rates.',
    },
    {
      title: 'STAYSCAPE review',
      status: 'upcoming' as const,
      body: 'Our team verifies documents and the listing. Typical review time will be published at launch.',
    },
    {
      title: 'Go live and accept bookings',
      status: 'upcoming' as const,
      body: 'Approved listings become searchable and bookable by travellers.',
    },
  ];

  const icon = (status: 'done' | 'todo' | 'upcoming') =>
    status === 'done' ? (
      <Check className="size-4" aria-hidden="true" />
    ) : status === 'todo' ? (
      <Circle className="size-4" aria-hidden="true" />
    ) : (
      <Clock className="size-4" aria-hidden="true" />
    );
  const label = { done: 'Complete', todo: 'To do', upcoming: 'Opens with the property module' };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Partner onboarding"
        title="List your property on STAYSCAPE"
        description="Here is exactly how onboarding works. Steps 1–2 are available today; the application form opens with the property module."
      />
      {isPartner && (
        <Alert tone="success" title="Partner access is already active">
          An administrator has granted your account partner permissions. You can open the partner
          overview from the navigation.
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle as="h2">Your onboarding progress</CardTitle>
          <CardDescription>
            Applications are not being accepted yet — you will not be charged or listed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="relative flex flex-col gap-6 border-l border-border pl-8">
            {steps.map((step, index) => (
              <li key={step.title} className="relative">
                <span
                  className={cn(
                    'absolute -left-[45px] flex size-7 items-center justify-center rounded-full border-2 bg-surface',
                    step.status === 'done'
                      ? 'border-success text-success'
                      : step.status === 'todo'
                        ? 'border-warning text-warning'
                        : 'border-border-strong text-fg-subtle',
                  )}
                >
                  {icon(step.status)}
                </span>
                <p className="flex flex-wrap items-center gap-2 font-medium text-fg">
                  <span className="text-fg-subtle">{index + 1}.</span> {step.title}
                  <Badge
                    tone={
                      step.status === 'done'
                        ? 'success'
                        : step.status === 'todo'
                          ? 'warning'
                          : 'neutral'
                    }
                  >
                    {label[step.status]}
                  </Badge>
                </p>
                <p className="mt-1 text-sm text-fg-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
      <section aria-labelledby="partner-faq" className="flex flex-col gap-4">
        <h2 id="partner-faq" className="font-display text-xl font-semibold">
          Before you apply
        </h2>
        <Accordion
          items={[
            {
              id: 'docs',
              title: 'Which documents will I need?',
              content:
                'Proof of business registration, tax registration (e.g. GSTIN in India), identity proof of the authorised signatory, property ownership or management agreement, and a cancelled cheque or bank letter for payouts.',
            },
            {
              id: 'cost',
              title: 'What does it cost to list?',
              content:
                'Commercial terms will be published before applications open. Nothing is charged during Phase 1.',
            },
            {
              id: 'staff',
              title: 'Can my staff help manage the property?',
              content:
                'Yes. Owners will be able to invite staff with limited permissions — for example, managing rooms and viewing reservations without access to payouts.',
            },
          ]}
        />
      </section>
    </div>
  );
}
