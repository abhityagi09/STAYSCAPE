import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate, useSearchParams } from 'react-router';
import { resetPasswordFormSchema, type ResetPasswordFormValues } from '@stayscape/shared';
import { Alert, Button, ButtonLink, ErrorState, PasswordInput, useToast } from '@/components/ui';
import { ApiClientError } from '@/lib/api/errors';
import { applyServerErrors } from '@/lib/forms';
import { authApi } from '../api';
import { tr } from '@/lib/tr';

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const { toast } = useToast();
  const [formError, setFormError] = useState<{ text: string; expired: boolean } | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordFormSchema),
    defaultValues: { password: '', confirmPassword: '' },
  });

  if (!/^[A-Za-z0-9_-]{20,200}$/.test(token)) {
    return (
      <ErrorState
        title={tr('This reset link is incomplete')}
        description={tr('Open the link from your email again, or request a new one.')}
        className="items-center"
      />
    );
  }

  const onSubmit = handleSubmit(async ({ password }) => {
    setFormError(null);
    try {
      await authApi.resetPassword({ token, password });
      toast({
        title: tr('Password updated'),
        description: tr('Sign in with your new password.'),
        variant: 'success',
      });
      navigate('/login?reason=reset', { replace: true });
    } catch (error) {
      const expired =
        error instanceof ApiClientError && error.code === 'VERIFICATION_TOKEN_INVALID';
      const text = applyServerErrors(error, setError, ['password']);
      if (text) setFormError({ text, expired });
    }
  });

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          {tr('Choose a new password')}
        </h1>
        <p className="mt-2 text-fg-muted">
          {tr("For your security, all devices will be signed out once it's changed.")}
        </p>
      </div>
      {formError && (
        <Alert
          tone="danger"
          action={
            formError.expired ? (
              <ButtonLink to="/forgot-password" size="sm" variant="outline">
                {tr('Request a new link')}
              </ButtonLink>
            ) : undefined
          }
        >
          {formError.text}
        </Alert>
      )}
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <PasswordInput
          label={tr('New password')}
          autoComplete="new-password"
          required
          showRequirements
          error={errors.password?.message}
          {...register('password')}
        />
        <PasswordInput
          label={tr('Confirm new password')}
          autoComplete="new-password"
          required
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />
        <Button type="submit" size="lg" fullWidth loading={isSubmitting} loadingText="Updating…">
          {tr('Update password')}
        </Button>
      </form>
    </div>
  );
}
