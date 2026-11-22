import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Ellipsis, ScrollText, ShieldCheck, Users } from 'lucide-react';
import {
  ACCOUNT_STATUSES,
  PRIVILEGED_ROLES,
  ROLE_LABELS,
  ROLES,
  checkRoleChange,
  canModerateAccount,
  type AccountStatus,
  type AdminUserDto,
  type AuditLogDto,
  type Role,
} from '@stayscape/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmationDialog,
  DataTable,
  Dropdown,
  EmptyState,
  IconButton,
  Input,
  Modal,
  MultiSelect,
  PageHeader,
  Pagination,
  Popover,
  SearchInput,
  Select,
  Tabs,
  useToast,
  type Column,
} from '@/components/ui';
import { PreferencesForm } from '@/features/account/components/PreferencesForm';
import { AvatarCard, ProfileForm } from '@/features/account/components/ProfileForm';
import { ChangePasswordCard, SessionsCard } from '@/features/account/components/SecuritySettings';
import { useAuth } from '@/features/auth/use-auth';
import { errorMessage, normalizeApiError } from '@/lib/api/errors';
import { useAdminUsers, useAuditLog, useUpdateUserRoles, useUpdateUserStatus } from '../api';

const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const statusTone: Record<AccountStatus, 'success' | 'danger' | 'neutral'> = {
  ACTIVE: 'success',
  SUSPENDED: 'danger',
  DEACTIVATED: 'neutral',
};

function useDebounced<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/* ---------------------------------------------------------------- Audit table */
function AuditTable({
  items,
  loading,
  error,
  onRetry,
}: {
  items: AuditLogDto[] | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const columns: Column<AuditLogDto>[] = [
    {
      id: 'time',
      header: 'Time',
      cell: (row) => (
        <time dateTime={row.timestamp} className="whitespace-nowrap text-fg-muted">
          {dateTime.format(new Date(row.timestamp))}
        </time>
      ),
    },
    {
      id: 'action',
      header: 'Action',
      cell: (row) => (
        <code className="rounded bg-surface-muted px-1.5 py-0.5 text-xs">{row.action}</code>
      ),
    },
    {
      id: 'entity',
      header: 'Entity',
      cell: (row) => (
        <span className="text-fg-muted">
          {row.entityType}
          {row.entityId ? ` · ${row.entityId.slice(-8)}` : ''}
        </span>
      ),
    },
    {
      id: 'actor',
      header: 'Actor',
      cell: (row) => (
        <span className="font-mono text-xs text-fg-muted">
          {row.actorId ? row.actorId.slice(-8) : 'anonymous'}
        </span>
      ),
    },
    {
      id: 'ip',
      header: 'IP',
      cell: (row) => <span className="text-xs text-fg-subtle">{row.ipAddress ?? '—'}</span>,
    },
    {
      id: 'details',
      header: <span className="sr-only">Details</span>,
      align: 'right',
      cell: (row) => (
        <Popover
          label={`Details for ${row.action}`}
          align="end"
          className="w-80"
          trigger={(props) => (
            <IconButton {...props} label="View details" icon={<Ellipsis />} size="sm" />
          )}
        >
          <dl className="flex flex-col gap-2 text-xs">
            <div>
              <dt className="font-semibold">Request ID</dt>
              <dd className="font-mono break-all text-fg-muted">{row.requestId ?? '—'}</dd>
            </div>
            <div>
              <dt className="font-semibold">Metadata</dt>
              <dd>
                <pre className="mt-1 max-h-48 overflow-auto rounded bg-surface-muted p-2 text-[11px]">
                  {JSON.stringify(row.metadata, null, 2)}
                </pre>
              </dd>
            </div>
          </dl>
        </Popover>
      ),
    },
  ];
  const err = error ? normalizeApiError(error) : null;
  return (
    <DataTable
      caption="Audit log"
      columns={columns}
      rows={items}
      getRowId={(row) => row.id}
      loading={loading}
      error={err ? { message: err.message, requestId: err.requestId } : null}
      onRetry={onRetry}
      empty={
        <EmptyState
          compact
          icon={<ScrollText />}
          title="No audit events"
          description="No events match these filters."
        />
      }
    />
  );
}

/* ---------------------------------------------------------------- Dashboard */
export function AdminDashboardPage() {
  const { user, can } = useAuth();
  const audit = useAuditLog({ page: 1, limit: 5 }, can('audit:read'));
  if (!user) return null;
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Administration"
        title="Overview"
        description="Platform administration. Business metrics will appear once bookings and payments are live — nothing here is estimated."
      />
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle>Your access</CardTitle>
            <CardDescription>Effective roles for this session.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-1.5">
              {user.roles.map((role) => (
                <Badge key={role} tone={PRIVILEGED_ROLES.includes(role) ? 'accent' : 'primary'}>
                  {ROLE_LABELS[role]}
                </Badge>
              ))}
            </div>
            <p className="text-xs text-fg-subtle">
              {user.permissions.length} permissions granted. All are enforced by the API on every
              request.
            </p>
          </CardContent>
        </Card>
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Available tools</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {can('users:read') && (
              <Link
                to="/admin/users"
                className="flex items-start gap-3 rounded-xl border border-border p-4 hover:bg-surface-muted"
              >
                <Users className="mt-0.5 size-5 text-primary" aria-hidden="true" />
                <span>
                  <span className="block font-medium">Users & roles</span>
                  <span className="text-sm text-fg-muted">
                    Search accounts, manage roles and status.
                  </span>
                </span>
              </Link>
            )}
            {can('audit:read') && (
              <Link
                to="/admin/audit"
                className="flex items-start gap-3 rounded-xl border border-border p-4 hover:bg-surface-muted"
              >
                <ScrollText className="mt-0.5 size-5 text-primary" aria-hidden="true" />
                <span>
                  <span className="block font-medium">Audit log</span>
                  <span className="text-sm text-fg-muted">
                    Security-relevant activity across the platform.
                  </span>
                </span>
              </Link>
            )}
            <Link
              to="/admin/settings"
              className="flex items-start gap-3 rounded-xl border border-border p-4 hover:bg-surface-muted"
            >
              <ShieldCheck className="mt-0.5 size-5 text-primary" aria-hidden="true" />
              <span>
                <span className="block font-medium">Account & security</span>
                <span className="text-sm text-fg-muted">Your profile, password and sessions.</span>
              </span>
            </Link>
          </CardContent>
        </Card>
      </div>
      {can('audit:read') && (
        <section aria-labelledby="recent-activity" className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 id="recent-activity" className="font-display text-xl font-semibold">
              Recent activity
            </h2>
            <Link to="/admin/audit" className="text-sm font-medium text-primary hover:underline">
              Full audit log
            </Link>
          </div>
          <AuditTable
            items={audit.data?.items}
            loading={audit.isPending}
            error={audit.error}
            onRetry={() => void audit.refetch()}
          />
        </section>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Users */
function RolesDialog({ target, onClose }: { target: AdminUserDto | null; onClose: () => void }) {
  const { user } = useAuth();
  const update = useUpdateUserRoles();
  const { toast } = useToast();
  const [roles, setRoles] = useState<Role[]>([]);
  useEffect(() => setRoles(target?.roles ?? []), [target]);
  if (!target || !user) return null;

  const check = checkRoleChange({
    actorId: user.id,
    actorRoles: user.roles,
    targetId: target.id,
    targetCurrentRoles: target.roles,
    nextRoles: roles,
  });
  const options = ROLES.map((role) => ({
    value: role,
    label: ROLE_LABELS[role],
    disabled: !checkRoleChange({
      actorId: user.id,
      actorRoles: user.roles,
      targetId: target.id,
      targetCurrentRoles: target.roles,
      nextRoles: [role],
    }).allowed,
  }));

  return (
    <Modal
      open
      onClose={onClose}
      title="Change roles"
      description={`${target.firstName} ${target.lastName} · ${target.email}`}
      dismissible={!update.isPending}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={update.isPending}>
            Cancel
          </Button>
          <Button
            loading={update.isPending}
            disabled={!check.allowed || roles.length === 0}
            onClick={() =>
              update.mutate(
                { id: target.id, roles },
                {
                  onSuccess: () => {
                    toast({ title: 'Roles updated', variant: 'success' });
                    onClose();
                  },
                  onError: (error) =>
                    toast({
                      title: 'Could not update roles',
                      description: errorMessage(error),
                      variant: 'error',
                    }),
                },
              )
            }
          >
            Save roles
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <MultiSelect
          label="Roles"
          options={options}
          value={roles}
          onChange={setRoles}
          hint="Privileged roles can only be granted by a super administrator."
          error={roles.length === 0 ? 'Select at least one role' : undefined}
        />
        {!check.allowed && roles.length > 0 && <Alert tone="warning">{check.reason}</Alert>}
      </div>
    </Modal>
  );
}

export function AdminUsersPage() {
  const { user, can } = useAuth();
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);
  const query = useAdminUsers({
    page,
    search: debounced || undefined,
    role: (role || undefined) as Role | undefined,
    status: (status || undefined) as AccountStatus | undefined,
  });
  const updateStatus = useUpdateUserStatus();
  const { toast } = useToast();
  const [rolesTarget, setRolesTarget] = useState<AdminUserDto | null>(null);
  const [statusTarget, setStatusTarget] = useState<{
    user: AdminUserDto;
    next: AccountStatus;
  } | null>(null);
  const [reason, setReason] = useState('');

  useEffect(() => setPage(1), [debounced, role, status]);
  const canManage = can('users:manage');

  const columns: Column<AdminUserDto>[] = [
    {
      id: 'name',
      header: 'User',
      cell: (row) => (
        <div>
          <p className="font-medium">
            {row.firstName} {row.lastName}
          </p>
          <p className="text-xs text-fg-subtle">{row.email}</p>
        </div>
      ),
    },
    {
      id: 'roles',
      header: 'Roles',
      cell: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.roles.map((r) => (
            <Badge key={r} tone={PRIVILEGED_ROLES.includes(r) ? 'accent' : 'neutral'}>
              {ROLE_LABELS[r]}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (row) => (
        <Badge tone={statusTone[row.accountStatus]}>{row.accountStatus.toLowerCase()}</Badge>
      ),
    },
    {
      id: 'verified',
      header: 'Email',
      cell: (row) =>
        row.emailVerified ? (
          <Badge tone="success">Verified</Badge>
        ) : (
          <Badge tone="warning">Unverified</Badge>
        ),
    },
    {
      id: 'created',
      header: 'Joined',
      cell: (row) => <span className="text-fg-muted">{date.format(new Date(row.createdAt))}</span>,
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (row) => {
        if (!canManage || !user || row.id === user.id) return null;
        const moderation = canModerateAccount({
          actorId: user.id,
          actorRoles: user.roles,
          targetId: row.id,
          targetRoles: row.roles,
        });
        return (
          <Dropdown
            trigger={(props) => (
              <IconButton
                {...props}
                label={`Actions for ${row.email}`}
                icon={<Ellipsis />}
                size="sm"
              />
            )}
            items={[
              { id: 'roles', label: 'Change roles…', onSelect: () => setRolesTarget(row) },
              row.accountStatus === 'ACTIVE'
                ? {
                    id: 'suspend',
                    label: 'Suspend account…',
                    danger: true,
                    disabled: !moderation.allowed,
                    onSelect: () => setStatusTarget({ user: row, next: 'SUSPENDED' }),
                  }
                : {
                    id: 'activate',
                    label: 'Reactivate account…',
                    disabled: !moderation.allowed,
                    onSelect: () => setStatusTarget({ user: row, next: 'ACTIVE' }),
                  },
            ]}
          />
        );
      },
    },
  ];

  const err = query.error ? normalizeApiError(query.error) : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Users & roles"
        description="Search accounts and manage access."
        breadcrumb={[{ label: 'Admin', to: '/admin' }, { label: 'Users' }]}
      />
      <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <SearchInput
          label="Search users"
          placeholder="Search by name or email"
          value={search}
          onValueChange={setSearch}
        />
        <Select
          label="Role"
          hideLabel
          value={role}
          onChange={(e) => setRole(e.target.value)}
          placeholder="All roles"
          options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
        />
        <Select
          label="Status"
          hideLabel
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          placeholder="All statuses"
          options={ACCOUNT_STATUSES.map((s) => ({
            value: s,
            label: s.charAt(0) + s.slice(1).toLowerCase(),
          }))}
        />
      </div>
      <DataTable
        caption="Users"
        columns={columns}
        rows={query.data?.items}
        getRowId={(row) => row.id}
        loading={query.isPending}
        error={err ? { message: err.message, requestId: err.requestId } : null}
        onRetry={() => void query.refetch()}
        empty={
          <EmptyState
            compact
            icon={<Users />}
            title="No users found"
            description="Try a different search or filter."
          />
        }
      />
      {query.data && (
        <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
          <p className="text-sm text-fg-subtle" aria-live="polite">
            {query.data.pagination.total} users
          </p>
          <Pagination
            page={page}
            totalPages={query.data.pagination.totalPages}
            onPageChange={setPage}
          />
        </div>
      )}

      <RolesDialog target={rolesTarget} onClose={() => setRolesTarget(null)} />
      <ConfirmationDialog
        open={statusTarget !== null}
        title={
          statusTarget?.next === 'SUSPENDED' ? 'Suspend this account?' : 'Reactivate this account?'
        }
        description={
          statusTarget
            ? `${statusTarget.user.email}${statusTarget.next === 'SUSPENDED' ? ' will be signed out everywhere and unable to sign in.' : ' will be able to sign in again.'}`
            : undefined
        }
        confirmLabel={statusTarget?.next === 'SUSPENDED' ? 'Suspend' : 'Reactivate'}
        tone={statusTarget?.next === 'SUSPENDED' ? 'danger' : 'default'}
        loading={updateStatus.isPending}
        onCancel={() => {
          setStatusTarget(null);
          setReason('');
        }}
        onConfirm={() => {
          if (!statusTarget) return;
          updateStatus.mutate(
            {
              id: statusTarget.user.id,
              status: statusTarget.next,
              reason: reason.trim() || undefined,
            },
            {
              onSuccess: () => {
                toast({ title: 'Account status updated', variant: 'success' });
                setStatusTarget(null);
                setReason('');
              },
              onError: (error) =>
                toast({
                  title: 'Could not update status',
                  description: errorMessage(error),
                  variant: 'error',
                }),
            },
          );
        }}
      >
        <Input
          label="Reason"
          optionalLabel
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          hint="Recorded in the audit log."
          maxLength={500}
        />
      </ConfirmationDialog>
    </div>
  );
}

/* ---------------------------------------------------------------- Audit */
export function AdminAuditPage() {
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const debounced = useDebounced(action);
  useEffect(() => setPage(1), [debounced]);
  const query = useAuditLog({ page, action: debounced || undefined });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Audit log"
        description="Security-relevant events. Passwords, tokens and secrets are never recorded."
        breadcrumb={[{ label: 'Admin', to: '/admin' }, { label: 'Audit log' }]}
      />
      <SearchInput
        label="Filter by exact action"
        placeholder="e.g. auth.login"
        value={action}
        onValueChange={setAction}
        containerClassName="max-w-md"
      />
      <AuditTable
        items={query.data?.items}
        loading={query.isPending}
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

/* ---------------------------------------------------------------- Settings */
export function AdminSettingsPage() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Account & security"
        description="Your own administrator account."
        breadcrumb={[{ label: 'Admin', to: '/admin' }, { label: 'Settings' }]}
      />
      <Tabs
        label="Account settings"
        items={[
          {
            id: 'profile',
            label: 'Profile',
            content: (
              <div className="flex flex-col gap-6">
                <AvatarCard user={user} />
                <ProfileForm user={user} />
              </div>
            ),
          },
          {
            id: 'security',
            label: 'Security',
            content: (
              <div className="flex flex-col gap-6">
                <ChangePasswordCard />
                <SessionsCard />
              </div>
            ),
          },
          { id: 'preferences', label: 'Preferences', content: <PreferencesForm user={user} /> },
        ]}
      />
    </div>
  );
}
