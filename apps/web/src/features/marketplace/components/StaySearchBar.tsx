import { useEffect, useId, useRef, useState } from 'react';
import { MapPin, Minus, Plus, Search, UsersRound } from 'lucide-react';
import { MAX_STAY_NIGHTS, addDays, diffDays } from '@stayscape/shared';
import { Button, DatePicker, Popover, todayIsoDate } from '@/components/ui';
import { controlClasses } from '@/components/ui/Field';
import { cn } from '@/lib/cn';
import { useSuggestions } from '../api';
import type { SearchState } from '../search-state';
import { tr, trf } from '@/lib/tr';

type StayFields = Pick<
  SearchState,
  'destination' | 'checkIn' | 'checkOut' | 'adults' | 'children' | 'childrenAges' | 'rooms'
>;

function Stepper({
  label,
  value,
  min,
  max,
  onChange,
  description,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  description?: string;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div>
        <p id={id} className="text-sm font-medium">
          {label}
        </p>
        {description && <p className="text-xs text-fg-subtle">{description}</p>}
      </div>
      <div className="flex items-center gap-2" role="group" aria-labelledby={id}>
        <button
          type="button"
          className="inline-flex size-8 items-center justify-center rounded-full border border-border-strong disabled:opacity-40"
          onClick={() => onChange(value - 1)}
          disabled={value <= min}
          aria-label={trf('Fewer {0}', [label.toLowerCase()])}
        >
          <Minus className="size-3.5" aria-hidden="true" />
        </button>
        <output className="w-6 text-center text-sm font-semibold tabular-nums" aria-live="polite">
          {value}
        </output>
        <button
          type="button"
          className="inline-flex size-8 items-center justify-center rounded-full border border-border-strong disabled:opacity-40"
          onClick={() => onChange(value + 1)}
          disabled={value >= max}
          aria-label={trf('More {0}', [label.toLowerCase()])}
        >
          <Plus className="size-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/** Destination combobox (WAI-ARIA 1.2) backed by the suggestions API. */
function DestinationInput({
  value,
  onChange,
  onPick,
}: {
  value: string;
  onChange: (v: string) => void;
  onPick: (v: string, kind: 'destination' | 'hotel', slug: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [debounced, setDebounced] = useState(value);
  const listId = useId();
  const inputId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), 250);
    return () => clearTimeout(t);
  }, [value]);
  const suggestions = useSuggestions(debounced);
  const items = open ? (suggestions.data ?? []) : [];

  return (
    <div
      ref={rootRef}
      className="relative flex flex-col gap-1.5"
      onBlur={(e) => !rootRef.current?.contains(e.relatedTarget) && setOpen(false)}
    >
      <label htmlFor={inputId} className="text-sm font-medium">
        {tr('Destination')}
      </label>
      <div className="relative">
        <MapPin
          className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-fg-subtle"
          aria-hidden="true"
        />
        <input
          id={inputId}
          role="combobox"
          aria-expanded={items.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          placeholder={tr('City, region or property')}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, items.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, -1));
            } else if (e.key === 'Enter' && active >= 0 && items[active]) {
              e.preventDefault();
              const item = items[active];
              onPick(item.type === 'destination' ? item.label : item.label, item.type, item.slug);
              setOpen(false);
            } else if (e.key === 'Escape') setOpen(false);
          }}
          className={cn(controlClasses, 'pl-10')}
        />
      </div>
      {items.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label={tr('Suggestions')}
          className="absolute top-full z-30 mt-1 w-full overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-lg"
        >
          {items.map((item, i) => (
            <li
              key={`${item.type}-${item.value}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onPick(item.label, item.type, item.slug);
                setOpen(false);
              }}
              onKeyDown={() => undefined}
              className={cn(
                'flex cursor-pointer flex-col px-3.5 py-2 text-sm',
                i === active ? 'bg-surface-muted' : 'hover:bg-surface-muted',
              )}
            >
              <span className="font-medium">{item.label}</span>
              <span className="text-xs text-fg-subtle">
                {item.type === 'hotel' ? trf('Property · {0}', [item.sublabel]) : item.sublabel}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function StaySearchBar({
  initial,
  onSearch,
  onOpenHotel,
  variant = 'hero',
  className,
}: {
  initial: StayFields;
  onSearch: (values: StayFields) => void;
  onOpenHotel?: (slug: string) => void;
  variant?: 'hero' | 'compact';
  className?: string;
}) {
  const [values, setValues] = useState<StayFields>(initial);
  const [error, setError] = useState<string | null>(null);
  // Re-sync only when the incoming criteria actually change (e.g. back/forward navigation).
  // Keying on object identity wiped what the user had typed whenever the parent re-rendered.
  const initialKey = JSON.stringify([
    initial.destination,
    initial.checkIn,
    initial.checkOut,
    initial.adults,
    initial.children,
    initial.childrenAges,
    initial.rooms,
  ]);
  const initialRef = useRef(initial);
  initialRef.current = initial;
  useEffect(() => setValues(initialRef.current), [initialKey]);
  const set = (patch: Partial<StayFields>) => setValues((v) => ({ ...v, ...patch }));
  const today = todayIsoDate();
  const guests = values.adults + values.children;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (Boolean(values.checkIn) !== Boolean(values.checkOut))
      return setError('Choose both check-in and check-out dates.');
    if (values.checkIn && values.checkIn < today)
      return setError('Check-in cannot be in the past.');
    if (values.checkIn && diffDays(values.checkIn, values.checkOut) < 1)
      return setError('Check-out must be after check-in.');
    if (values.checkIn && diffDays(values.checkIn, values.checkOut) > MAX_STAY_NIGHTS)
      return setError(`Stays can be up to ${MAX_STAY_NIGHTS} nights.`);
    if (values.rooms > values.adults) return setError('Each room needs at least one adult.');
    setError(null);
    onSearch(values);
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label={tr('Search stays')}
      className={cn(
        'grid gap-4 rounded-3xl border p-5 lg:grid-cols-[1.5fr_1fr_1fr_1fr_auto] lg:items-end',
        variant === 'hero'
          ? 'border-white/40 bg-surface/95 shadow-xl backdrop-blur-md sm:p-6'
          : 'border-border bg-surface shadow-sm',
        className,
      )}
    >
      <DestinationInput
        value={values.destination}
        onChange={(destination) => set({ destination })}
        onPick={(label, kind, slug) =>
          kind === 'hotel' && onOpenHotel ? onOpenHotel(slug) : set({ destination: label })
        }
      />
      <DatePicker
        label={tr('Check-in')}
        min={today}
        value={values.checkIn}
        onChange={(e) =>
          set({
            checkIn: e.target.value,
            checkOut:
              values.checkOut && values.checkOut > e.target.value
                ? values.checkOut
                : e.target.value
                  ? addDays(e.target.value, 1)
                  : '',
          })
        }
      />
      <DatePicker
        label={tr('Check-out')}
        min={values.checkIn ? addDays(values.checkIn, 1) : addDays(today, 1)}
        value={values.checkOut}
        onChange={(e) => set({ checkOut: e.target.value })}
      />
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium" id="guest-picker-label">
          {tr('Guests')}
        </span>
        <Popover
          label={tr('Guests and rooms')}
          align="end"
          className="w-80"
          trigger={(props) => (
            <button
              {...props}
              type="button"
              aria-labelledby="guest-picker-label guest-picker-summary"
              className={cn(controlClasses, 'flex items-center gap-2 text-left')}
            >
              <UsersRound className="size-4 text-fg-subtle" aria-hidden="true" />
              <span id="guest-picker-summary" className="truncate">
                {guests} {tr('guest')}
                {guests === 1 ? '' : 's'} · {values.rooms} {tr('room')}
                {values.rooms === 1 ? '' : 's'}
              </span>
            </button>
          )}
        >
          {(close) => (
            <div className="flex flex-col divide-y divide-border">
              <Stepper
                label={tr('Adults')}
                description={tr('Age 13+')}
                value={values.adults}
                min={1}
                max={30}
                onChange={(adults) => set({ adults })}
              />
              <Stepper
                label={tr('Children')}
                description={tr('Age 0–12')}
                value={values.children}
                min={0}
                max={10}
                onChange={(children) =>
                  set({
                    children,
                    childrenAges: Array.from(
                      { length: children },
                      (_, i) => values.childrenAges[i] ?? 8,
                    ),
                  })
                }
              />
              {values.children > 0 && (
                <div className="grid grid-cols-2 gap-2 py-2">
                  {values.childrenAges.map((age, i) => (
                    <label key={i} className="flex flex-col gap-1 text-xs font-medium">
                      {tr('Child')} {i + 1} {tr('age')}
                      <select
                        value={age}
                        onChange={(e) =>
                          set({
                            childrenAges: values.childrenAges.map((a, j) =>
                              j === i ? Number(e.target.value) : a,
                            ),
                          })
                        }
                        className={cn(controlClasses, 'h-9')}
                      >
                        {Array.from({ length: 18 }, (_, a) => (
                          <option key={a} value={a}>
                            {a === 0 ? tr('Under 1') : a}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              )}
              <Stepper
                label={tr('Rooms')}
                value={values.rooms}
                min={1}
                max={8}
                onChange={(rooms) => set({ rooms })}
              />
              <div className="pt-3">
                <Button size="sm" fullWidth onClick={close}>
                  {tr('Done')}
                </Button>
              </div>
            </div>
          )}
        </Popover>
      </div>
      <Button type="submit" size="lg" leftIcon={<Search className="size-4" aria-hidden="true" />}>
        {tr('Search')}
      </Button>
      {error && (
        <p role="alert" className="text-sm font-medium text-danger lg:col-span-5">
          {error}
        </p>
      )}
    </form>
  );
}
