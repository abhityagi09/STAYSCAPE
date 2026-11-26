import { Card, CardContent, CardHeader, CardTitle, Checkbox, useToast } from '@/components/ui';
import { useUpdatePreferences } from '@/features/account/api';
import { useAuth } from '@/features/auth/use-auth';
import { normalizeApiError } from '@/lib/api/errors';
import { fmtDate } from './components';
import { tr, trf } from '@/lib/tr';

/** Opt-in consent for personalised recommendations (off by default; can be withdrawn at any time). */
export function PersonalizationCard() {
  const { user } = useAuth();
  const update = useUpdatePreferences();
  const { toast } = useToast();
  if (!user) return null;
  const p = user.preferences.personalization;
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{tr('Personalised recommendations')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm text-fg-muted">
        <Checkbox
          label={tr('Recommend stays based on my bookings and saved properties')}
          checked={p.recommendations}
          disabled={update.isPending}
          onChange={(e) =>
            update.mutate(
              { personalization: { recommendations: e.target.checked } },
              {
                onError: (err) =>
                  toast({
                    title: tr('Could not update'),
                    description: normalizeApiError(err).message,
                    variant: 'error',
                  }),
              },
            )
          }
        />
        <p>
          {tr(
            'We only use your own bookings and saved stays on Stayscape, never browsing history or third-party data. Turning this off stops personalised picks immediately.',
          )}
          {p.consentedAt && trf(' You agreed on {0}.', [fmtDate(p.consentedAt)])}
        </p>
      </CardContent>
    </Card>
  );
}
