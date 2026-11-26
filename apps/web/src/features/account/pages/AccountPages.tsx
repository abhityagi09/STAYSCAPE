import { useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, CalendarCheck, Check, Circle, Search } from 'lucide-react';
import type { UserDto } from '@stayscape/shared';
import {
  ButtonLink,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Pagination,
  PageSpinner,
  Tabs,
  Button,
} from '@/components/ui';
import { useAuth } from '@/features/auth/use-auth';
import { cn } from '@/lib/cn';
import { useMarkAllRead, useNotifications } from '../api';
import { EmailVerificationBanner } from '../components/EmailVerificationBanner';
import { NotificationList } from '../components/Notifications';
import { PreferencesForm } from '../components/PreferencesForm';
import { AvatarCard, ProfileForm } from '../components/ProfileForm';
import { ChangePasswordCard, SessionsCard } from '../components/SecuritySettings';
import { PrivacyCard } from '../components/PrivacyCard';
import { tr, trf } from '@/lib/tr';

function useUser(): UserDto | null {
  return useAuth().user;
}

export function AccountChecklist({ user }: { user: UserDto }) {
  // Derived entirely from the real account record.
  const steps = [
    { done: true, label: tr('Create your account'), to: '/account/profile' },
    { done: user.emailVerified, label: tr('Verify your email address'), to: '/account' },
    { done: Boolean(user.phone), label: tr('Add a mobile number'), to: '/account/profile' },
    { done: Boolean(user.avatarUrl), label: tr('Add a profile photo'), to: '/account/profile' },
  ];
  const complete = steps.filter((s) => s.done).length;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tr('Account setup')}</CardTitle>
        <CardDescription>
          {complete} {tr('of')} {steps.length} {tr('complete')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div
          className="mb-4 h-1.5 overflow-hidden rounded-full bg-surface-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={complete}
          aria-label={tr('Account setup progress')}
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500"
            style={{ width: `${(complete / steps.length) * 100}%` }}
          />
        </div>
        <ul className="flex flex-col gap-2.5">
          {steps.map((step) => (
            <li key={step.label}>
              <Link to={step.to} className="flex items-center gap-2.5 text-sm hover:underline">
                {step.done ? (
                  <Check className="size-4 text-success" aria-hidden="true" />
                ) : (
                  <Circle className="size-4 text-fg-subtle" aria-hidden="true" />
                )}
                <span className={cn(step.done && 'text-fg-muted line-through')}>{step.label}</span>
                <span className="sr-only">{step.done ? tr('(done)') : tr('(to do)')}</span>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function CustomerDashboardPage() {
  const user = useUser();
  const notifications = useNotifications(1, false);
  if (!user) return <PageSpinner />;
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={tr('Your account')}
        title={trf('Hello, {0}', [user.firstName])}
        description={tr('Manage your profile, security and travel preferences.')}
      />
      <EmailVerificationBanner user={user} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>{tr('Upcoming stays')}</CardTitle>
            <CardDescription>{tr('Your confirmed reservations will appear here.')}</CardDescription>
          </CardHeader>
          <CardContent>
            <EmptyState
              compact
              icon={<CalendarCheck />}
              title={tr('No upcoming stays')}
              description={tr(
                "Booking opens as verified properties join STAYSCAPE. You'll be able to reserve and manage trips from here.",
              )}
              action={
                <ButtonLink
                  to="/search"
                  variant="outline"
                  size="sm"
                  leftIcon={<Search className="size-4" aria-hidden="true" />}
                >
                  {tr('Explore stays')}
                </ButtonLink>
              }
            />
          </CardContent>
        </Card>
        <AccountChecklist user={user} />
      </div>
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>{tr('Recent notifications')}</CardTitle>
            <CardDescription>{tr('Account and security activity.')}</CardDescription>
          </div>
          <Link
            to="/account/notifications"
            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            {tr('View all')} <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </CardHeader>
        <CardContent>
          <NotificationList
            compact
            items={notifications.data?.items.slice(0, 4)}
            isPending={notifications.isPending}
            error={notifications.error}
            onRetry={() => void notifications.refetch()}
          />
        </CardContent>
      </Card>
    </div>
  );
}

export function ProfilePage() {
  const user = useUser();
  if (!user) return <PageSpinner />;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={tr('Profile')}
        description={tr('Your personal details and photo.')}
        breadcrumb={[{ label: tr('Account'), to: '/account' }, { label: tr('Profile') }]}
      />
      <EmailVerificationBanner user={user} />
      <AvatarCard user={user} />
      <ProfileForm user={user} />
    </div>
  );
}

export function PreferencesPage() {
  const user = useUser();
  if (!user) return <PageSpinner />;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={tr('Preferences')}
        description={tr('Language, currency and how we contact you.')}
        breadcrumb={[{ label: tr('Account'), to: '/account' }, { label: tr('Preferences') }]}
      />
      <PreferencesForm user={user} />
    </div>
  );
}

export function SecurityPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={tr('Security & sessions')}
        description={tr('Keep your account protected.')}
        breadcrumb={[{ label: tr('Account'), to: '/account' }, { label: tr('Security') }]}
      />
      <ChangePasswordCard />
      <SessionsCard />
      <PrivacyCard />
    </div>
  );
}

function NotificationsPanel({ unreadOnly }: { unreadOnly: boolean }) {
  const [page, setPage] = useState(1);
  const query = useNotifications(page, unreadOnly);
  return (
    <div className="flex flex-col gap-4">
      <NotificationList
        items={query.data?.items}
        isPending={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
      />
      {query.data && (
        <Pagination
          page={page}
          totalPages={query.data.pagination.totalPages}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}

export function NotificationsPage() {
  const markAll = useMarkAllRead();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={tr('Notifications')}
        description={tr('Security, account and booking updates.')}
        actions={
          <Button
            variant="outline"
            size="sm"
            loading={markAll.isPending}
            onClick={() => markAll.mutate()}
          >
            {tr('Mark all as read')}
          </Button>
        }
      />
      <Card>
        <CardContent className="pt-4">
          <Tabs
            label={tr('Notification filters')}
            items={[
              { id: 'all', label: tr('All'), content: <NotificationsPanel unreadOnly={false} /> },
              { id: 'unread', label: tr('Unread'), content: <NotificationsPanel unreadOnly /> },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
