import { useDeferredValue, useState } from 'react';
import type { AdminHotelSummaryDto, AdminPartnerSummaryDto } from '@stayscape/shared';
import { Input, Select } from '@/components/ui';
import { tr, trf } from '@/lib/tr';
import { useApiQuery, type Page } from './api';

type Kind = 'partner' | 'hotel';

interface Option {
  value: string;
  label: string;
}

const SOURCES: Record<Kind, { url: string; params: Record<string, string> }> = {
  // Settlements and partner-scoped rules only make sense for verified partners.
  partner: { url: '/admin/partners', params: { status: 'APPROVED' } },
  hotel: { url: '/admin/hotels', params: {} },
};

function toOption(kind: Kind, row: AdminPartnerSummaryDto | AdminHotelSummaryDto): Option {
  if (kind === 'partner') {
    const p = row as AdminPartnerSummaryDto;
    return {
      value: p.id,
      label: trf('{0} · {1}', [p.businessName ?? tr('Untitled application'), p.ownerEmail]),
    };
  }
  const h = row as AdminHotelSummaryDto;
  return { value: h.id, label: trf('{0} · {1}', [h.name, h.city]) };
}

/**
 * Search-and-choose control for admin forms: looks records up by name through the admin list
 * endpoints instead of asking for raw database ids. Emits the chosen id ('' when cleared).
 */
export function RecordPicker({
  kind,
  label,
  value,
  onChange,
  containerClassName,
}: {
  kind: Kind;
  label: string;
  value: string;
  onChange: (id: string) => void;
  containerClassName?: string;
}) {
  const [search, setSearch] = useState('');
  const deferred = useDeferredValue(search.trim());
  const source = SOURCES[kind];
  const results = useApiQuery<Page<AdminPartnerSummaryDto | AdminHotelSummaryDto>>(
    ['admin', 'picker', kind],
    source.url,
    { ...source.params, search: deferred || undefined, limit: 20 },
  );
  const found = (results.data?.items ?? []).map((row) => toOption(kind, row));
  // Keep the current choice listed while the admin searches for something else.
  const [chosen, setChosen] = useState<Option | null>(null);
  const options =
    chosen && chosen.value === value && !found.some((o) => o.value === value)
      ? [chosen, ...found]
      : found;
  const noun = kind === 'partner' ? tr('partner') : tr('property');
  return (
    <div className={containerClassName ?? 'flex flex-wrap items-end gap-2'}>
      <Input
        type="search"
        label={trf('Find {0}', [noun])}
        placeholder={tr('Search by name')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        containerClassName="w-56"
      />
      <Select
        label={label}
        value={value}
        onChange={(e) => {
          setChosen(options.find((o) => o.value === e.target.value) ?? null);
          onChange(e.target.value);
        }}
        placeholder={
          results.isLoading
            ? tr('Loading…')
            : options.length
              ? tr('Choose one')
              : trf('No matching {0}', [noun])
        }
        options={options}
        error={results.isError ? tr('Could not load the list') : undefined}
        containerClassName="w-72"
      />
    </div>
  );
}
