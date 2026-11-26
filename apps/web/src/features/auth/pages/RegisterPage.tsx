import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { registerFormSchema, type RegisterFormValues } from '@stayscape/shared';
import { Alert, Button, Checkbox, Input, PasswordInput, useToast } from '@/components/ui';
import { applyServerErrors, safeRedirect } from '@/lib/forms';
import { authApi } from '../api';
import { useEstablishSession } from '../use-auth';
import { tr, trf } from '@/lib/tr';

export default function RegisterPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const establish = useEstablishSession();
  const { toast } = useToast();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerFormSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      password: '',
      confirmPassword: '',
      acceptTerms: false,
    },
  });

  const onSubmit = handleSubmit(async ({ confirmPassword: _confirm, ...values }) => {
    setFormError(null);
    try {
      // confirmPassword is validated in the browser only and never sent.
      const session = await authApi.register(values);
      establish(session);
      toast({
        title: tr('Account created'),
        description: trf('We sent a verification link to {0}.', [session.user.email]),
        variant: 'success',
      });
      navigate(safeRedirect(params.get('redirect'), '/account'), { replace: true });
    } catch (error) {
      setFormError(
        applyServerErrors(error, setError, [
          'firstName',
          'lastName',
          'email',
          'phone',
          'password',
          'acceptTerms',
        ]),
      );
    }
  });

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          {tr('Create your account')}
        </h1>
        <p className="mt-2 text-fg-muted">
          {tr('Save stays, manage bookings and travel with confidence.')}
        </p>
      </div>
      {formError && <Alert tone="danger">{formError}</Alert>}
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <Input
            label={tr('First name')}
            autoComplete="given-name"
            required
            error={errors.firstName?.message}
            {...register('firstName')}
          />
          <Input
            label={tr('Last name')}
            autoComplete="family-name"
            required
            error={errors.lastName?.message}
            {...register('lastName')}
          />
        </div>
        <Input
          label={tr('Email')}
          type="email"
          autoComplete="email"
          required
          error={errors.email?.message}
          {...register('email')}
        />
        <Input
          label={tr('Mobile number')}
          type="tel"
          autoComplete="tel"
          optionalLabel
          placeholder="+91 98765 43210"
          hint={tr('International format, e.g. +919876543210')}
          error={errors.phone?.message}
          {...register('phone', { setValueAs: (v: string) => v.replace(/[\s-]/g, '') })}
        />
        <PasswordInput
          label={tr('Password')}
          autoComplete="new-password"
          required
          showRequirements
          error={errors.password?.message}
          {...register('password')}
        />
        <PasswordInput
          label={tr('Confirm password')}
          autoComplete="new-password"
          required
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />
        <Checkbox
          label={
            <>
              {tr('I agree to the')}{' '}
              <Link to="/terms" target="_blank" className="text-primary underline">
                {tr('Terms of service')}
              </Link>{' '}
              {tr('and')}{' '}
              <Link to="/privacy" target="_blank" className="text-primary underline">
                {tr('Privacy policy')}
              </Link>
            </>
          }
          error={errors.acceptTerms?.message}
          {...register('acceptTerms')}
        />
        <Button
          type="submit"
          size="lg"
          fullWidth
          loading={isSubmitting}
          loadingText="Creating account…"
        >
          {tr('Create account')}
        </Button>
      </form>
      <p className="text-center text-sm text-fg-muted">
        {tr('Already have an account?')}{' '}
        <Link to="/login" className="font-semibold text-primary hover:underline">
          {tr('Sign in')}
        </Link>
      </p>
    </div>
  );
}
