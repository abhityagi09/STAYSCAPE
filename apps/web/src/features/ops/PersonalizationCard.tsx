import { Card, CardContent, CardHeader, CardTitle, Checkbox, useToast } from '@/components/ui';
import { useUpdatePreferences } from '@/features/account/api';
import { useAuth } from '@/features/auth/use-auth';
import { normalizeApiError } from '@/lib/api/errors';
import { fmtDate } from './components';

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
        <CardTitle as="h2">Personalised recommendations</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm text-fg-muted">
        <Checkbox
          label="Recommend stays based on my bookings and saved properties"
          checked={p.recommendations}
          disabled={update.isPending}
          onChange={(e) =>
            update.mutate(
              { personalization: { recommendations: e.target.checked } },
              { onError: (err) => toast({ title: 'Could not update', description: normalizeApiError(err).message, variant: 'error' }) },
            )
          }
        />
        <p>
          We only use your own bookings and saved stays on Stayscape, never browsing history or third-party data. Turning this off stops
          personalised picks immediately.{p.consentedAt && ` You agreed on ${fmtDate(p.consentedAt)}.`}
        </p>
      </CardContent>
    </Card>
  );
}
