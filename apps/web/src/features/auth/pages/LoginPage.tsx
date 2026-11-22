import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Mail } from 'lucide-react';
import { loginSchema, type LoginInput } from '@stayscape/shared';
import { Alert, Button, Input, PasswordInput } from '@/components/ui';
import { ApiClientError } from '@/lib/api/errors';
import { applyServerErrors, safeRedirect } from '@/lib/forms';
import { authApi } from '../api';
import { homeFor, useEstablishSession } from '../use-auth';

const notices: Record<string, { tone: 'info' | 'success' | 'warning'; text: string }> = {
  expired: { tone: 'warning', text: 'Your session has ended. Please sign in again to continue.' },
  reset: { tone: 'success', text: 'Your password has been reset. Sign in with your new password.' },
};

export default function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const establish = useEstablishSession();
  const [formError, setFormError] = useState<string | null>(null);
  const notice = notices[params.get('reason') ?? ''];

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const session = await authApi.login(values);
      establish(session);
      navigate(safeRedirect(params.get('redirect'), homeFor(session.user)), { replace: true });
    } catch (error) {
      if (error instanceof ApiClientError && error.code === 'RATE_LIMITED') {
        setFormError(error.message);
        return;
      }
      setFormError(applyServerErrors(error, setError, ['email', 'password']));
    }
  });

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Welcome back</h1>
        <p className="mt-2 text-fg-muted">Sign in to manage your stays and account.</p>
      </div>
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {formError && <Alert tone="danger">{formError}</Alert>}
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          leadingIcon={<Mail />}
          required
          error={errors.email?.message}
          {...register('email')}
        />
        <div className="flex flex-col gap-2">
          <PasswordInput
            label="Password"
            autoComplete="current-password"
            required
            error={errors.password?.message}
            {...register('password')}
          />
          <Link
            to="/forgot-password"
            className="self-end text-sm font-medium text-primary hover:underline"
          >
            Forgot password?
          </Link>
        </div>
        <Button type="submit" size="lg" fullWidth loading={isSubmitting} loadingText="Signing in…">
          Sign in
        </Button>
      </form>
      <p className="text-center text-sm text-fg-muted">
        New to STAYSCAPE?{' '}
        <Link
          to={`/register${params.get('redirect') ? `?redirect=${encodeURIComponent(params.get('redirect') ?? '')}` : ''}`}
          className="font-semibold text-primary hover:underline"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}
