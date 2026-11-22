import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  CURRENCIES,
  LANGUAGE_LABELS,
  LANGUAGES,
  type CurrencyCode,
  type Language,
  type NotificationPreferences,
  type UserDto,
} from '@stayscape/shared';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  RadioGroup,
  Select,
  useToast,
} from '@/components/ui';
import { errorMessage } from '@/lib/api/errors';
import { useUpdatePreferences } from '../api';

interface PreferencesValues {
  language: Language;
  currency: CurrencyCode;
  notifications: NotificationPreferences;
}

const currencyLabels: Record<CurrencyCode, string> = {
  INR: 'Indian rupee (₹ INR)',
  USD: 'US dollar ($ USD)',
  EUR: 'Euro (€ EUR)',
  GBP: 'British pound (£ GBP)',
  AED: 'UAE dirham (AED)',
};

const notificationOptions: Array<{
  key: keyof NotificationPreferences;
  label: string;
  description: string;
  locked?: boolean;
}> = [
  {
    key: 'emailBookingUpdates',
    label: 'Booking updates by email',
    description: 'Confirmations, changes and reminders for your stays.',
  },
  {
    key: 'emailSecurityAlerts',
    label: 'Security alerts by email',
    description: 'Password changes and unusual sign-in activity. Strongly recommended.',
  },
  {
    key: 'emailPromotions',
    label: 'Offers and travel inspiration',
    description: 'Occasional curated deals. Unsubscribe any time.',
  },
  {
    key: 'smsBookingUpdates',
    label: 'Booking updates by SMS',
    description: 'Requires a mobile number on your profile.',
  },
  {
    key: 'pushEnabled',
    label: 'Push notifications',
    description: 'For the mobile app when it launches.',
  },
];

export function PreferencesForm({ user }: { user: UserDto }) {
  const update = useUpdatePreferences();
  const { toast } = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const { control, register, handleSubmit, reset, formState } = useForm<PreferencesValues>({
    values: user.preferences,
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const updated = await update.mutateAsync(values);
      reset(updated.preferences);
      toast({ title: 'Preferences saved', variant: 'success' });
    } catch (error) {
      setFormError(errorMessage(error));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      {formError && <Alert tone="danger">{formError}</Alert>}
      <Card>
        <CardHeader>
          <CardTitle>Language &amp; currency</CardTitle>
          <CardDescription>
            Prices are always charged in the property&apos;s currency; your choice controls how
            estimates are displayed.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          <Controller
            control={control}
            name="language"
            render={({ field }) => (
              <RadioGroup
                legend="Display language"
                name="language"
                value={field.value}
                onChange={field.onChange}
                options={LANGUAGES.map((code) => ({
                  value: code,
                  label: LANGUAGE_LABELS[code],
                  description:
                    code === 'en'
                      ? 'Fully translated'
                      : 'Translation in progress — some screens remain in English',
                }))}
              />
            )}
          />
          <Select
            label="Display currency"
            options={CURRENCIES.map((code) => ({ value: code, label: currencyLabels[code] }))}
            {...register('currency')}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
          <CardDescription>
            Choose how STAYSCAPE keeps in touch. In-app notifications are always on.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {notificationOptions.map((option) => (
            <Checkbox
              key={option.key}
              label={option.label}
              description={
                option.key === 'smsBookingUpdates' && !user.phone
                  ? `${option.description} Add one on your profile first.`
                  : option.description
              }
              {...register(`notifications.${option.key}`)}
            />
          ))}
        </CardContent>
      </Card>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" disabled={!formState.isDirty} onClick={() => reset()}>
          Discard
        </Button>
        <Button
          type="submit"
          disabled={!formState.isDirty}
          loading={formState.isSubmitting}
          loadingText="Saving…"
        >
          Save preferences
        </Button>
      </div>
    </form>
  );
}
