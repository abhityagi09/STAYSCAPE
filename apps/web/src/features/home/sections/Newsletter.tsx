import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CircleCheck } from 'lucide-react';
import {
  newsletterSubscribeSchema,
  type MessageDto,
  type NewsletterSubscribeInput,
} from '@stayscape/shared';
import { Alert, Button, Input } from '@/components/ui';
import { http, unwrap } from '@/lib/api/client';
import { applyServerErrors } from '@/lib/forms';

export function Newsletter() {
  const [done, setDone] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<NewsletterSubscribeInput>({
    resolver: zodResolver(newsletterSubscribeSchema),
    defaultValues: { email: '', source: 'homepage' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const result = await unwrap<MessageDto>(http.post('/newsletter/subscriptions', values));
      setDone(result.message);
    } catch (error) {
      setFormError(applyServerErrors(error, setError, ['email']));
    }
  });

  return (
    <section aria-labelledby="newsletter-title" className="container-page mt-24">
      <div className="grid gap-8 rounded-3xl border border-border bg-surface-muted px-6 py-12 sm:px-12 lg:grid-cols-2 lg:items-center">
        <div>
          <p className="eyebrow">The STAYSCAPE letter</p>
          <h2
            id="newsletter-title"
            className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl"
          >
            Thoughtful travel, once a month.
          </h2>
          <p className="mt-3 max-w-md text-fg-muted">
            Seasonal destination notes and launch news. No spam — unsubscribe whenever you like.
          </p>
        </div>
        {done ? (
          <div
            role="status"
            className="flex items-center gap-3 rounded-2xl bg-surface p-5 text-success shadow-sm"
          >
            <CircleCheck className="size-6 shrink-0" aria-hidden="true" />
            <p className="text-sm font-medium text-fg">{done}</p>
          </div>
        ) : (
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
            {formError && <Alert tone="danger">{formError}</Alert>}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <Input
                label="Email address"
                hideLabel
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                containerClassName="flex-1"
                error={errors.email?.message}
                {...register('email')}
              />
              <Button type="submit" size="md" loading={isSubmitting} loadingText="Subscribing…">
                Subscribe
              </Button>
            </div>
            <p className="text-xs text-fg-subtle">
              By subscribing you agree to our privacy policy.
            </p>
          </form>
        )}
      </div>
    </section>
  );
}
