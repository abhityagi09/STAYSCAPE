import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { CircleCheck } from 'lucide-react';
import { emailSchema } from '@stayscape/shared';
import { useAppDispatch } from '@/app/store';
import { Alert, Button, ButtonLink, ErrorState, Input, Spinner } from '@/components/ui';
import { errorMessage } from '@/lib/api/errors';
import { authApi } from '../api';
import { userUpdated } from '../auth-slice';
import { useAuth } from '../use-auth';

type State =
  | { kind: 'verifying' }
  | { kind: 'verified'; email: string }
  | { kind: 'failed'; message: string }
  | { kind: 'missing' };

function ResendForm({ defaultEmail }: { defaultEmail?: string }) {
  const [email, setEmail] = useState(defaultEmail ?? '');
  const [status, setStatus] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<string>();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message);
      return;
    }
    setFieldError(undefined);
    setBusy(true);
    try {
      const result = await authApi.resendVerification(parsed.data);
      setStatus({ tone: 'success', text: result.message });
    } catch (error) {
      setStatus({ tone: 'danger', text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex w-full flex-col gap-4 text-left">
      {status && <Alert tone={status.tone}>{status.text}</Alert>}
      <Input
        label="Email address"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={fieldError}
      />
      <Button type="submit" loading={busy} loadingText="Sending…">
        Send a new verification link
      </Button>
    </form>
  );
}

export default function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const dispatch = useAppDispatch();
  const { user } = useAuth();
  const [state, setState] = useState<State>(token ? { kind: 'verifying' } : { kind: 'missing' });
  const attempted = useRef(false);

  useEffect(() => {
    // Tokens are single-use: guard against React StrictMode's double effect invocation.
    if (!token || attempted.current) return;
    attempted.current = true;
    authApi
      .verifyEmail(token)
      .then((result) => {
        dispatch(userUpdated(result.user));
        setState({ kind: 'verified', email: result.user.email });
      })
      .catch((error: unknown) => setState({ kind: 'failed', message: errorMessage(error) }));
  }, [token, dispatch]);

  if (state.kind === 'verifying') {
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center text-primary">
        <Spinner size="lg" label="Verifying your email" />
        <p className="text-fg-muted">Verifying your email address…</p>
      </div>
    );
  }

  if (state.kind === 'verified') {
    return (
      <div className="flex flex-col items-center gap-5 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-success-soft text-success">
          <CircleCheck className="size-7" aria-hidden="true" />
        </span>
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Email verified</h1>
          <p className="mt-2 text-fg-muted" role="status">
            {state.email} is confirmed. Thank you for securing your account.
          </p>
        </div>
        <ButtonLink to={user ? '/account' : '/login'}>
          {user ? 'Go to my account' : 'Sign in'}
        </ButtonLink>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <ErrorState
        title={
          state.kind === 'missing' ? 'Verification link missing' : 'We could not verify this link'
        }
        description={
          state.kind === 'failed'
            ? state.message
            : 'Open the link from your verification email, or request a new one below.'
        }
        className="w-full"
      />
      <ResendForm defaultEmail={user?.email} />
    </div>
  );
}
