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
import { tr, trf } from '@/lib/tr';

interface PreferencesValues {
  language: Language;
  currency: CurrencyCode;
  notifications: NotificationPreferences;
}

const currencyLabels: Record<CurrencyCode, string> = {
  get INR() {
    return tr('Indian rupee (₹ INR)');
  },
  get USD() {
    return tr('US dollar ($ USD)');
  },
  get EUR() {
    return tr('Euro (€ EUR)');
  },
  get GBP() {
    return tr('British pound (£ GBP)');
  },
  get AED() {
    return tr('UAE dirham (AED)');
  },
};

const notificationOptions: Array<{
  key: keyof NotificationPreferences;
  label: string;
  description: string;
  locked?: boolean;
}> = [
  {
    key: 'emailBookingUpdates',
    get label() {
      return tr('Booking updates by email');
    },
    get description() {
      return tr('Confirmations, changes and reminders for your stays.');
    },
  },
  {
    key: 'emailSecurityAlerts',
    get label() {
      return tr('Security alerts by email');
    },
    get description() {
      return tr('Password changes and unusual sign-in activity. Strongly recommended.');
    },
  },
  {
    key: 'emailPromotions',
    get label() {
      return tr('Offers and travel inspiration');
    },
    get description() {
      return tr('Occasional curated deals. Unsubscribe any time.');
    },
  },
  {
    key: 'smsBookingUpdates',
    get label() {
      return tr('Booking updates by SMS');
    },
    get description() {
      return tr('Requires a mobile number on your profile.');
    },
  },
  {
    key: 'pushEnabled',
    get label() {
      return tr('Push notifications');
    },
    get description() {
      return tr('For the mobile app when it launches.');
    },
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
      // Send only what this form edits (personalisation consent has its own control).
      const { language, currency, notifications } = values;
      const updated = await update.mutateAsync({ language, currency, notifications });
      reset(updated.preferences);
      toast({ title: tr('Preferences saved'), variant: 'success' });
    } catch (error) {
      setFormError(errorMessage(error));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      {formError && <Alert tone="danger">{formError}</Alert>}
      <Card>
        <CardHeader>
          <CardTitle>{tr('Language & currency')}</CardTitle>
          <CardDescription>
            {tr(
              "Prices are always charged in the property's currency; your choice controls how estimates are displayed.",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          <Controller
            control={control}
            name="language"
            render={({ field }) => (
              <RadioGroup
                legend={tr('Display language')}
                name="language"
                value={field.value}
                onChange={field.onChange}
                options={LANGUAGES.map((code) => ({
                  value: code,
                  label: tr(LANGUAGE_LABELS[code]),
                  description:
                    code === 'en'
                      ? 'Fully translated'
                      : 'Translation in progress — some screens remain in English',
                }))}
              />
            )}
          />
          <Select
            label={tr('Display currency')}
            options={CURRENCIES.map((code) => ({ value: code, label: tr(currencyLabels[code]) }))}
            {...register('currency')}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{tr('Notifications')}</CardTitle>
          <CardDescription>
            {tr('Choose how STAYSCAPE keeps in touch. In-app notifications are always on.')}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {notificationOptions.map((option) => (
            <Checkbox
              key={option.key}
              label={option.label}
              description={
                option.key === 'smsBookingUpdates' && !user.phone
                  ? trf('{0} Add one on your profile first.', [option.description])
                  : option.description
              }
              {...register(`notifications.${option.key}`)}
            />
          ))}
        </CardContent>
      </Card>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" disabled={!formState.isDirty} onClick={() => reset()}>
          {tr('Discard')}
        </Button>
        <Button
          type="submit"
          disabled={!formState.isDirty}
          loading={formState.isSubmitting}
          loadingText="Saving…"
        >
          {tr('Save preferences')}
        </Button>
      </div>
    </form>
  );
}
