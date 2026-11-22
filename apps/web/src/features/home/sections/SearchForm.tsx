import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router';
import { MapPin, Minus, Plus, Search, UsersRound } from 'lucide-react';
import { Button, DatePicker, Input, Popover, todayIsoDate } from '@/components/ui';
import { cn } from '@/lib/cn';
import { staySearchSchema, toSearchParams, type StaySearch } from '../search';

function Stepper({
  label,
  description,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const id = label.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div>
        <p id={`${id}-label`} className="text-sm font-medium text-fg">
          {label}
        </p>
        {description && <p className="text-xs text-fg-subtle">{description}</p>}
      </div>
      <div className="flex items-center gap-2" role="group" aria-labelledby={`${id}-label`}>
        <button
          type="button"
          className="inline-flex size-8 items-center justify-center rounded-full border border-border-strong text-fg disabled:opacity-40"
          onClick={() => onChange(value - 1)}
          disabled={value <= min}
          aria-label={`Decrease ${label.toLowerCase()}`}
        >
          <Minus className="size-3.5" aria-hidden="true" />
        </button>
        <output
          className="w-6 text-center text-sm font-semibold tabular-nums"
          aria-live="polite"
          aria-label={`${label}: ${value}`}
        >
          {value}
        </output>
        <button
          type="button"
          className="inline-flex size-8 items-center justify-center rounded-full border border-border-strong text-fg disabled:opacity-40"
          onClick={() => onChange(value + 1)}
          disabled={value >= max}
          aria-label={`Increase ${label.toLowerCase()}`}
        >
          <Plus className="size-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function SearchForm({ className }: { className?: string }) {
  const navigate = useNavigate();
  const {
    register,
    control,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<StaySearch>({
    resolver: zodResolver(staySearchSchema),
    defaultValues: {
      destination: '',
      checkIn: todayIsoDate(1),
      checkOut: todayIsoDate(3),
      adults: 2,
      children: 0,
      rooms: 1,
    },
  });
  const checkIn = watch('checkIn');

  const onSubmit = handleSubmit((values) =>
    navigate(`/search?${toSearchParams(values).toString()}`),
  );

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label="Search stays"
      className={cn(
        'grid gap-4 rounded-3xl border border-white/40 bg-surface/95 p-5 shadow-xl backdrop-blur-md sm:p-6 lg:grid-cols-[1.4fr_1fr_1fr_1fr_auto] lg:items-start',
        className,
      )}
    >
      <Input
        label="Destination"
        placeholder="City, region or property"
        leadingIcon={<MapPin />}
        autoComplete="off"
        error={errors.destination?.message}
        {...register('destination')}
      />
      <DatePicker
        label="Check-in"
        min={todayIsoDate()}
        error={errors.checkIn?.message}
        {...register('checkIn')}
      />
      <DatePicker
        label="Check-out"
        min={checkIn || todayIsoDate(1)}
        error={errors.checkOut?.message}
        {...register('checkOut')}
      />
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-fg" id="guests-label">
          Guests
        </span>
        <Popover
          label="Guests and rooms"
          align="end"
          trigger={(props) => (
            <button
              {...props}
              type="button"
              aria-labelledby="guests-label guests-summary"
              className="flex h-11 w-full items-center gap-2 rounded-lg border border-border-strong bg-surface px-3.5 text-left text-sm text-fg shadow-xs hover:border-fg-subtle"
            >
              <UsersRound className="size-4 text-fg-subtle" aria-hidden="true" />
              <span id="guests-summary" className="truncate">
                {plural(watch('adults') + watch('children'), 'guest')} ·{' '}
                {plural(watch('rooms'), 'room')}
              </span>
            </button>
          )}
        >
          {(close) => (
            <div className="flex flex-col divide-y divide-border">
              <Controller
                control={control}
                name="adults"
                render={({ field }) => (
                  <Stepper
                    label="Adults"
                    description="Age 13+"
                    value={field.value}
                    min={1}
                    max={16}
                    onChange={field.onChange}
                  />
                )}
              />
              <Controller
                control={control}
                name="children"
                render={({ field }) => (
                  <Stepper
                    label="Children"
                    description="Age 0–12"
                    value={field.value}
                    min={0}
                    max={10}
                    onChange={field.onChange}
                  />
                )}
              />
              <Controller
                control={control}
                name="rooms"
                render={({ field }) => (
                  <Stepper
                    label="Rooms"
                    value={field.value}
                    min={1}
                    max={8}
                    onChange={field.onChange}
                  />
                )}
              />
              <div className="pt-3">
                <Button size="sm" fullWidth onClick={close}>
                  Done
                </Button>
              </div>
            </div>
          )}
        </Popover>
        {errors.rooms?.message && (
          <p className="text-xs font-medium text-danger">{errors.rooms.message}</p>
        )}
      </div>
      <Button
        type="submit"
        size="lg"
        className="lg:mt-[26px]"
        leftIcon={<Search className="size-4" aria-hidden="true" />}
      >
        Search
      </Button>
    </form>
  );
}
