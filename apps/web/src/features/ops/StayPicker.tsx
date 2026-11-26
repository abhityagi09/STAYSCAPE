import { useDeferredValue, useState } from 'react';
import { Input, Select } from '@/components/ui';
import { useHotelDetail, useSuggestions } from '@/features/marketplace/api';
import { tr, trf } from '@/lib/tr';
import { MEAL_PLAN_LABELS } from '@stayscape/shared';

export interface StayChoice {
  hotelId: string;
  roomTypeId: string;
  ratePlanId: string;
}

/**
 * Property → room → rate chooser backed by the public catalogue (search suggestions and the
 * property page data), so travellers never have to copy internal ids.
 */
export function StayPicker({
  value,
  onChange,
}: {
  value: StayChoice;
  onChange: (next: StayChoice) => void;
}) {
  const [search, setSearch] = useState('');
  const [slug, setSlug] = useState('');
  const deferred = useDeferredValue(search.trim());
  const suggestions = useSuggestions(deferred);
  const hotels = (suggestions.data ?? []).filter((s) => s.type === 'hotel');
  const detail = useHotelDetail(slug);
  const hotel = slug ? detail.data : undefined;
  const room = hotel?.roomTypes.find((r) => r.id === value.roomTypeId);

  const hotelOptions = hotels.map((h) => ({
    value: h.slug,
    label: trf('{0} · {1}', [h.label, h.sublabel]),
  }));
  if (slug && hotel && !hotelOptions.some((o) => o.value === slug))
    hotelOptions.unshift({ value: slug, label: trf('{0} · {1}', [hotel.name, hotel.city]) });

  return (
    <>
      <Input
        type="search"
        label={tr('Find a property')}
        placeholder={tr('Property name or city')}
        hint={deferred.length < 2 ? tr('Type at least 2 letters') : undefined}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        containerClassName="w-60"
      />
      <Select
        label={tr('Property')}
        value={slug}
        onChange={(e) => {
          setSlug(e.target.value);
          onChange({ hotelId: '', roomTypeId: '', ratePlanId: '' });
        }}
        placeholder={
          suggestions.isFetching
            ? tr('Searching…')
            : hotelOptions.length
              ? tr('Choose a property')
              : tr('No matching properties')
        }
        options={hotelOptions}
        containerClassName="w-64"
      />
      <Select
        label={tr('Room')}
        value={value.roomTypeId}
        disabled={!hotel}
        onChange={(e) =>
          onChange({ hotelId: hotel?.id ?? '', roomTypeId: e.target.value, ratePlanId: '' })
        }
        placeholder={slug && detail.isLoading ? tr('Loading…') : tr('Choose a room')}
        options={(hotel?.roomTypes ?? []).map((r) => ({ value: r.id, label: r.name }))}
        error={slug && detail.isError ? tr('Could not load this property') : undefined}
        containerClassName="w-56"
      />
      <Select
        label={tr('Rate')}
        value={value.ratePlanId}
        disabled={!room}
        onChange={(e) => onChange({ ...value, ratePlanId: e.target.value })}
        placeholder={tr('Choose a rate')}
        options={(room?.ratePlans ?? []).map((p) => ({
          value: p.id,
          label: trf('{0} · {1}', [p.name, tr(MEAL_PLAN_LABELS[p.mealPlan])]),
        }))}
        containerClassName="w-56"
      />
    </>
  );
}
