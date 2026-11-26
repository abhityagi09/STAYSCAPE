import { useEffect, useState } from 'react';
import {
  ACCESSIBILITY_FEATURES,
  ACCESSIBILITY_FEATURE_LABELS,
  type AccessibilityFeature,
  type AccessibilityFeatureDto,
} from '@stayscape/shared';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Input,
  PageHeader,
  Select,
  useToast,
} from '@/components/ui';
import { usePartnerHotels } from '@/features/partner/api';
import { normalizeApiError } from '@/lib/api/errors';
import { api, useApiMutation, useApiQuery } from './api';
import { QueryState, SectionCard, fmtDate } from './components';
import { tr, trf } from '@/lib/tr';

/** /partner/accessibility — the property states its features; Stayscape may verify them. */
export function PartnerAccessibilityPage() {
  const hotels = usePartnerHotels();
  const [picked, setPicked] = useState('');
  const hotelId = picked || hotels.data?.[0]?.id || '';
  const current = useApiQuery<AccessibilityFeatureDto[]>(
    ['partner', 'accessibility', hotelId],
    hotelId ? `/partner/hotels/${hotelId}/accessibility` : null,
  );
  const [draft, setDraft] = useState<Record<string, string | undefined>>({});
  useEffect(() => {
    if (current.data) setDraft(Object.fromEntries(current.data.map((f) => [f.code, f.note])));
  }, [current.data]);
  const { toast } = useToast();
  const save = useApiMutation(
    () =>
      api.put(`/partner/hotels/${hotelId}/accessibility`, {
        features: Object.entries(draft)
          .filter(([, v]) => v !== undefined)
          .map(([code, note]) => ({ code, note: note ?? '' })),
      }),
    [['partner', 'accessibility']],
  );
  const byCode = new Map((current.data ?? []).map((f) => [f.code, f]));
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={tr('Accessibility')}
        description={tr(
          'Tell guests what your property offers. Guests see that you stated it; features checked by Stayscape are marked as verified.',
        )}
      />
      {hotels.data && hotels.data.length > 1 && (
        <Select
          label={tr('Property')}
          value={hotelId}
          onChange={(e) => setPicked(e.target.value)}
          options={hotels.data.map((h) => ({ value: h.id, label: h.name }))}
          containerClassName="w-64"
        />
      )}
      <Alert tone="info" title={tr('Be precise')}>
        {tr(
          'Changing the description of a verified feature returns it to “stated by the property” until Stayscape checks it again.',
        )}
      </Alert>
      <QueryState query={current}>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(undefined, {
              onSuccess: () => toast({ title: tr('Accessibility saved'), variant: 'success' }),
              onError: (err) =>
                toast({
                  title: tr('Could not save'),
                  description: normalizeApiError(err).message,
                  variant: 'error',
                }),
            });
          }}
        >
          {ACCESSIBILITY_FEATURES.map((code) => {
            const on = draft[code] !== undefined;
            const saved = byCode.get(code);
            return (
              <div
                key={code}
                className="flex flex-wrap items-end gap-3 rounded-xl border border-border p-3"
              >
                <Checkbox
                  label={tr(ACCESSIBILITY_FEATURE_LABELS[code])}
                  checked={on}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      [code]: e.target.checked ? (draft[code] ?? '') : undefined,
                    })
                  }
                />
                {on && (
                  <Input
                    label={trf('Details for {0} (optional)', [ACCESSIBILITY_FEATURE_LABELS[code]])}
                    value={draft[code] ?? ''}
                    maxLength={200}
                    onChange={(e) => setDraft({ ...draft, [code]: e.target.value })}
                    containerClassName="w-80"
                  />
                )}
                {saved && (
                  <Badge tone={saved.source === 'ADMIN_VERIFIED' ? 'success' : 'outline'}>
                    {saved.source === 'ADMIN_VERIFIED'
                      ? trf('Verified {0}', [fmtDate(saved.verifiedAt)])
                      : tr('Stated by you')}
                  </Badge>
                )}
              </div>
            );
          })}
          <Button type="submit" className="self-start" loading={save.isPending} disabled={!hotelId}>
            {tr('Save accessibility')}
          </Button>
        </form>
      </QueryState>
    </div>
  );
}

/** Admin verification of declared features, with evidence recorded internally (never shown publicly). */
export function AdminAccessibilityPanel({ hotelId }: { hotelId: string }) {
  const list = useApiQuery<Array<AccessibilityFeatureDto & { evidence: string | null }>>(
    ['admin', 'accessibility', hotelId],
    `/admin/hotels/${hotelId}/accessibility`,
  );
  const [selected, setSelected] = useState<AccessibilityFeature[]>([]);
  const [evidence, setEvidence] = useState('');
  const { toast } = useToast();
  const verify = useApiMutation(
    (verified: boolean) =>
      api.post(`/admin/hotels/${hotelId}/accessibility/verify`, {
        codes: selected,
        verified,
        evidence,
      }),
    [['admin', 'accessibility', hotelId]],
  );
  const run = (verified: boolean) =>
    verify.mutate(verified, {
      onSuccess: () => {
        setSelected([]);
        setEvidence('');
        toast({
          title: verified ? 'Features verified' : 'Verification removed',
          variant: 'success',
        });
      },
      onError: (e) =>
        toast({
          title: tr('Could not update'),
          description: normalizeApiError(e).message,
          variant: 'error',
        }),
    });
  return (
    <SectionCard
      title={tr('Accessibility verification')}
      description={tr(
        'Verify only what you have checked (site visit, photos, documents). Evidence stays internal.',
      )}
    >
      <QueryState query={list}>
        {list.data?.length ? (
          <>
            <ul className="flex flex-col gap-2">
              {list.data.map((f) => (
                <li key={f.code} className="flex flex-wrap items-center gap-2 text-sm">
                  <Checkbox
                    label={f.label}
                    checked={selected.includes(f.code)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, f.code]
                          : selected.filter((c) => c !== f.code),
                      )
                    }
                  />
                  <Badge tone={f.source === 'ADMIN_VERIFIED' ? 'success' : 'outline'}>
                    {f.source === 'ADMIN_VERIFIED'
                      ? trf('Verified {0}', [fmtDate(f.verifiedAt)])
                      : tr('Stated by the property')}
                  </Badge>
                  {f.note && <span className="text-fg-muted">— {f.note}</span>}
                  {f.evidence && (
                    <span className="text-xs text-fg-subtle">
                      {tr('Evidence:')} {f.evidence}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-end gap-2">
              <Input
                label={tr('Evidence')}
                value={evidence}
                onChange={(e) => setEvidence(e.target.value)}
                containerClassName="w-96"
              />
              <Button
                size="sm"
                disabled={!selected.length || evidence.trim().length < 5}
                loading={verify.isPending}
                onClick={() => run(true)}
              >
                {tr('Mark verified')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={!selected.length || evidence.trim().length < 5}
                onClick={() => run(false)}
              >
                {tr('Remove verification')}
              </Button>
            </div>
          </>
        ) : (
          <p className="text-sm text-fg-muted">
            {tr('The property has not declared any accessibility features.')}
          </p>
        )}
      </QueryState>
    </SectionCard>
  );
}
