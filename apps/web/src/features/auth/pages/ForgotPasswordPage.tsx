import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'react-router';
import { ArrowLeft, MailCheck } from 'lucide-react';
import { forgotPasswordSchema, type ForgotPasswordInput } from '@stayscape/shared';
import { Alert, Button, ButtonLink, Input } from '@/components/ui';
import { applyServerErrors } from '@/lib/forms';
import { authApi } from '../api';
import { tr } from '@/lib/tr';

export default function ForgotPasswordPage() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [message, setMessage] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const result = await authApi.forgotPassword(values);
      setMessage(result.message);
      setSentTo(values.email);
    } catch (error) {
      setFormError(applyServerErrors(error, setError, ['email']));
    }
  });

  if (sentTo) {
    return (
      <div className="flex flex-col items-start gap-6">
        <span className="flex size-12 items-center justify-center rounded-full bg-success-soft text-success">
          <MailCheck className="size-6" aria-hidden="true" />
        </span>
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {tr('Check your inbox')}
          </h1>
          <p className="mt-3 text-fg-muted" role="status">
            {message}
          </p>
          <p className="mt-2 text-sm text-fg-subtle">
            {tr(
              "The link expires soon and can be used once. Didn't get it? Check spam or try again in a minute.",
            )}
          </p>
        </div>
        <div className="flex gap-3">
          <ButtonLink to="/login" variant="primary">
            {tr('Back to sign in')}
          </ButtonLink>
          <Button variant="ghost" onClick={() => setSentTo(null)}>
            {tr('Use a different email')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <Link
        to="/login"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-fg-muted hover:text-fg"
      >
        <ArrowLeft className="size-4" aria-hidden="true" /> {tr('Back to sign in')}
      </Link>
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          {tr('Reset your password')}
        </h1>
        <p className="mt-2 text-fg-muted">
          {tr("Enter the email for your account and we'll send you a secure reset link.")}
        </p>
      </div>
      {formError && <Alert tone="danger">{formError}</Alert>}
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <Input
          label={tr('Email')}
          type="email"
          autoComplete="email"
          required
          error={errors.email?.message}
          {...register('email')}
        />
        <Button
          type="submit"
          size="lg"
          fullWidth
          loading={isSubmitting}
          loadingText="Sending link…"
        >
          {tr('Send reset link')}
        </Button>
      </form>
    </div>
  );
}
