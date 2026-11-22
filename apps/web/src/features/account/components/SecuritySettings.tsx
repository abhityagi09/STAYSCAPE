import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router';
import { Laptop, LogOut, Smartphone } from 'lucide-react';
import {
  changePasswordFormSchema,
  type ChangePasswordFormValues,
  type SessionDto,
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
  ErrorState,
  PasswordInput,
  SkeletonText,
  useToast,
} from '@/components/ui';
import { authApi } from '@/features/auth/api';
import { useSignOut } from '@/features/auth/use-auth';
import { errorMessage, normalizeApiError } from '@/lib/api/errors';
import { applyServerErrors } from '@/lib/forms';
import { useRevokeSession, useSessions } from '../api';

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function ChangePasswordCard() {
  const { toast } = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordFormValues>({
    resolver: zodResolver(changePasswordFormSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const onSubmit = handleSubmit(async ({ currentPassword, newPassword }) => {
    setFormError(null);
    try {
      const result = await authApi.changePassword({ currentPassword, newPassword });
      reset();
      toast({ title: 'Password changed', description: result.message, variant: 'success' });
    } catch (error) {
      setFormError(applyServerErrors(error, setError, ['currentPassword', 'newPassword']));
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Change password</CardTitle>
        <CardDescription>Changing your password signs out every other device.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
          {formError && <Alert tone="danger">{formError}</Alert>}
          <PasswordInput
            label="Current password"
            autoComplete="current-password"
            required
            error={errors.currentPassword?.message}
            {...register('currentPassword')}
          />
          <PasswordInput
            label="New password"
            autoComplete="new-password"
            required
            showRequirements
            error={errors.newPassword?.message}
            {...register('newPassword')}
          />
          <PasswordInput
            label="Confirm new password"
            autoComplete="new-password"
            required
            error={errors.confirmPassword?.message}
            {...register('confirmPassword')}
          />
          <div className="flex justify-end">
            <Button type="submit" loading={isSubmitting} loadingText="Updating…">
              Update password
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function SessionRow({
  session,
  onRevoke,
}: {
  session: SessionDto;
  onRevoke: (session: SessionDto) => void;
}) {
  const mobile = /Android|iOS/.test(session.deviceLabel);
  const Icon = mobile ? Smartphone : Laptop;
  return (
    <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-muted text-fg-muted">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <div>
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
            {session.deviceLabel}
            {session.current && <Badge tone="success">This device</Badge>}
          </p>
          <p className="text-xs text-fg-subtle">
            Signed in {dateTime.format(new Date(session.signedInAt))} · Last active{' '}
            {dateTime.format(new Date(session.lastActiveAt))}
            {session.ipAddress ? ` · IP ${session.ipAddress}` : ''}
          </p>
        </div>
      </div>
      {!session.current && (
        <Button variant="outline" size="sm" onClick={() => onRevoke(session)}>
          Sign out
        </Button>
      )}
    </li>
  );
}

export function SessionsCard() {
  const sessions = useSessions();
  const revoke = useRevokeSession();
  const signOut = useSignOut();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [target, setTarget] = useState<SessionDto | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [signingOutAll, setSigningOutAll] = useState(false);

  return (
    <Card>
      <CardHeader className="sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>Active sessions</CardTitle>
          <CardDescription>
            Devices currently signed in to your account. Sign out any you don&apos;t recognise.
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          leftIcon={<LogOut className="size-4" aria-hidden="true" />}
          onClick={() => setConfirmAll(true)}
        >
          Sign out everywhere
        </Button>
      </CardHeader>
      <CardContent>
        {sessions.isPending && <SkeletonText lines={4} />}
        {sessions.isError && (
          <ErrorState
            description={errorMessage(sessions.error)}
            requestId={normalizeApiError(sessions.error).requestId}
            onRetry={() => void sessions.refetch()}
          />
        )}
        {sessions.data && (
          <ul className="divide-y divide-border">
            {sessions.data.map((session) => (
              <SessionRow key={session.id} session={session} onRevoke={setTarget} />
            ))}
          </ul>
        )}
      </CardContent>

      <ConfirmationDialog
        open={target !== null}
        title="Sign out this device?"
        description={target ? `${target.deviceLabel} will need to sign in again.` : undefined}
        confirmLabel="Sign out device"
        tone="danger"
        loading={revoke.isPending}
        onCancel={() => setTarget(null)}
        onConfirm={() => {
          if (!target) return;
          revoke.mutate(target.id, {
            onSuccess: () => {
              toast({ title: 'Device signed out', variant: 'success' });
              setTarget(null);
            },
            onError: (error) =>
              toast({
                title: 'Could not sign out device',
                description: errorMessage(error),
                variant: 'error',
              }),
          });
        }}
      />
      <ConfirmationDialog
        open={confirmAll}
        title="Sign out of all devices?"
        description="Every session, including this one, will end. You'll need to sign in again."
        confirmLabel="Sign out everywhere"
        tone="danger"
        loading={signingOutAll}
        onCancel={() => setConfirmAll(false)}
        onConfirm={() => {
          setSigningOutAll(true);
          void signOut('all').finally(() => {
            setSigningOutAll(false);
            setConfirmAll(false);
            toast({ title: 'Signed out of all devices', variant: 'success' });
            navigate('/login');
          });
        }}
      />
    </Card>
  );
}
