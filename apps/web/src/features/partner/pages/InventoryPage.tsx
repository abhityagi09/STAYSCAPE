import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, CalendarRange } from 'lucide-react';
import { addDays, dateRange, dayOfWeek, type InventoryDayDto } from '@stayscape/shared';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Select,
  SkeletonText,
  todayIsoDate,
  useToast,
} from '@/components/ui';
import { normalizeApiError } from '@/lib/api/errors';
import { cn } from '@/lib/cn';
import { partnerApi, usePartnerHotels, useRoomTypes } from '../api';
import { tr, trf } from '@/lib/tr';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
const monthEnd = (d: string) => addDays(`${addDays(monthStart(d), 32).slice(0, 7)}-01`, -1);
const monthLabel = (d: string) =>
  new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${d}T00:00:00Z`),
  );

function DayCell({
  day,
  selected,
  past,
  onClick,
}: {
  day: InventoryDayDto;
  selected: boolean;
  past: boolean;
  onClick: () => void;
}) {
  const soldOut = day.available <= 0;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={past}
      aria-pressed={selected}
      aria-label={trf('{0}: {1} available, {2} blocked, {3} booked, {4} held{5}{6}', [
        day.date,
        day.available,
        day.blockedRooms,
        day.bookedRooms,
        day.heldRooms,
        day.closedToArrival ? ', closed to arrival' : '',
        day.closedToDeparture ? ', closed to departure' : '',
      ])}
      className={cn(
        'flex min-h-20 flex-col items-start gap-0.5 rounded-lg border p-1.5 text-left text-[11px] transition-colors',
        selected ? 'border-primary bg-primary-soft' : 'border-border hover:border-border-strong',
        soldOut && !selected && 'bg-danger-soft/60',
        past && 'cursor-not-allowed opacity-40',
      )}
    >
      <span className="text-xs font-semibold">{Number(day.date.slice(8))}</span>
      <span className={cn('font-medium', soldOut ? 'text-danger' : 'text-success')}>
        {day.available} {tr('avail')}
      </span>
      {day.blockedRooms > 0 && (
        <span className="text-fg-muted">
          {day.blockedRooms} {tr('blocked')}
        </span>
      )}
      {day.bookedRooms > 0 && (
        <span className="text-fg-muted">
          {day.bookedRooms} {tr('booked')}
        </span>
      )}
      {day.heldRooms > 0 && (
        <span className="text-warning">
          {day.heldRooms} {tr('held')}
        </span>
      )}
      {(day.closedToArrival || day.closedToDeparture) && (
        <span className="text-info">
          {day.closedToArrival ? tr('CTA ') : ''}
          {day.closedToDeparture ? 'CTD' : ''}
        </span>
      )}
      {day.minimumStay && (
        <span className="text-fg-subtle">
          {tr('min')} {day.minimumStay}
          {tr('n')}
        </span>
      )}
    </button>
  );
}

export function InventoryPage() {
  const [params, setParams] = useSearchParams();
  const hotels = usePartnerHotels();
  const hotelId = params.get('property') ?? hotels.data?.[0]?.id ?? '';
  const rooms = useRoomTypes(hotelId);
  const roomTypeId = params.get('room') ?? rooms.data?.find((r) => r.status === 'ACTIVE')?.id ?? '';
  const today = todayIsoDate();
  const [anchor, setAnchor] = useState(monthStart(today));
  const [view, setView] = useState<'month' | 'week'>('month');
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [pendingStart, setPendingStart] = useState<string | null>(null);
  const from = view === 'month' ? monthStart(anchor) : anchor;
  const to = view === 'month' ? monthEnd(anchor) : addDays(anchor, 6);
  const qc = useQueryClient();
  const { toast } = useToast();
  const calendar = useQuery({
    queryKey: ['partner', 'hotel', hotelId, 'inventory', roomTypeId, from, to],
    queryFn: ({ signal }) => partnerApi.inventory(hotelId, { roomTypeId, from, to }, signal),
    enabled: Boolean(hotelId && roomTypeId),
  });

  const [blocked, setBlocked] = useState('');
  const [cta, setCta] = useState<'keep' | 'on' | 'off'>('keep');
  const [ctd, setCtd] = useState<'keep' | 'on' | 'off'>('keep');
  const [minStay, setMinStay] = useState('');
  const [maxStay, setMaxStay] = useState('');
  const [days, setDays] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<{ message: string; dates: string[] } | null>(null);
  useEffect(() => setRange(null), [hotelId, roomTypeId]);

  const leading = useMemo(() => (view === 'month' ? dayOfWeek(from) : 0), [from, view]);
  const inRange = (d: string) => (range ? d >= range.from && d <= range.to : pendingStart === d);

  const select = (date: string) => {
    setConflict(null);
    if (!pendingStart) {
      setPendingStart(date);
      setRange({ from: date, to: date });
    } else {
      const [a, b] = [pendingStart, date].sort() as [string, string];
      setRange({ from: a, to: b });
      setPendingStart(null);
    }
  };

  const apply = async () => {
    if (!range) return;
    const set: Record<string, unknown> = {};
    if (blocked !== '') set.blockedRooms = Number(blocked);
    if (cta !== 'keep') set.closedToArrival = cta === 'on';
    if (ctd !== 'keep') set.closedToDeparture = ctd === 'on';
    if (minStay !== '') set.minimumStay = minStay === '0' ? null : Number(minStay);
    if (maxStay !== '') set.maximumStay = maxStay === '0' ? null : Number(maxStay);
    if (Object.keys(set).length === 0)
      return toast({ title: tr('Choose at least one change'), variant: 'warning' });
    setSaving(true);
    try {
      await partnerApi.updateInventory(hotelId, {
        roomTypeId,
        from: range.from,
        to: range.to,
        daysOfWeek: days,
        set,
      });
      toast({
        title: tr('Inventory updated'),
        description: `${range.from} → ${range.to}`,
        variant: 'success',
      });
      await qc.invalidateQueries({ queryKey: ['partner', 'hotel', hotelId, 'inventory'] });
      setRange(null);
    } catch (error) {
      const e = normalizeApiError(error);
      const dates = Array.isArray(e.details.dates) ? (e.details.dates as string[]) : [];
      setConflict({ message: e.message, dates });
    } finally {
      setSaving(false);
    }
  };

  if (hotels.isPending) return <SkeletonText lines={6} />;
  if (hotels.data?.length === 0)
    return (
      <EmptyState
        icon={<CalendarRange />}
        title={tr('No properties yet')}
        description={tr('Create a property and room categories to manage inventory.')}
      />
    );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={tr('Inventory calendar')}
        description={tr(
          'Rooms by date. Select a date, then a second date to choose a range, and apply changes. Booked and held rooms can never be blocked.',
        )}
      />
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <Select
          label={tr('Property')}
          value={hotelId}
          onChange={(e) => setParams({ property: e.target.value })}
          options={(hotels.data ?? []).map((h) => ({ value: h.id, label: h.name }))}
        />
        <Select
          label={tr('Room category')}
          value={roomTypeId}
          onChange={(e) => setParams({ property: hotelId, room: e.target.value })}
          options={(rooms.data ?? [])
            .filter((r) => r.status !== 'ARCHIVED')
            .map((r) => ({ value: r.id, label: `${r.name} (${r.totalInventory})` }))}
          placeholder={rooms.data?.length ? undefined : tr('No room categories')}
        />
        <div className="flex items-end gap-1" role="group" aria-label={tr('Calendar view')}>
          {(['month', 'week'] as const).map((v) => (
            <Button
              key={v}
              size="md"
              variant={view === v ? 'primary' : 'outline'}
              aria-pressed={view === v}
              onClick={() => {
                setView(v);
                setAnchor(v === 'month' ? monthStart(anchor) : today);
              }}
            >
              {v === 'month' ? tr('Month') : tr('Week')}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              aria-label={tr('Previous')}
              onClick={() =>
                setAnchor(view === 'month' ? monthStart(addDays(from, -1)) : addDays(anchor, -7))
              }
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
            </Button>
            <CardTitle as="h2">{view === 'month' ? monthLabel(from) : `${from} → ${to}`}</CardTitle>
            <Button
              variant="ghost"
              size="sm"
              aria-label={tr('Next')}
              onClick={() => setAnchor(view === 'month' ? addDays(to, 1) : addDays(anchor, 7))}
            >
              <ChevronRight className="size-4" aria-hidden="true" />
            </Button>
          </CardHeader>
          <CardContent>
            {!roomTypeId ? (
              <EmptyState compact title={tr('Choose a room category')} />
            ) : calendar.isPending ? (
              <SkeletonText lines={8} />
            ) : calendar.isError ? (
              <ErrorState
                description={normalizeApiError(calendar.error).message}
                onRetry={() => void calendar.refetch()}
              />
            ) : (
              <div
                className="grid grid-cols-7 gap-1.5"
                role="grid"
                aria-label={tr('Inventory by date')}
              >
                {DOW.map((d) => (
                  <div
                    key={d}
                    role="columnheader"
                    className="pb-1 text-center text-xs font-semibold text-fg-subtle"
                  >
                    {d}
                  </div>
                ))}
                {Array.from({ length: leading }, (_, i) => (
                  <div key={`pad-${i}`} aria-hidden="true" />
                ))}
                {calendar.data.map((day) => (
                  <DayCell
                    key={day.date}
                    day={day}
                    selected={inRange(day.date)}
                    past={day.date < today}
                    onClick={() => select(day.date)}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2">{tr('Update range')}</CardTitle>
            <CardDescription>
              {range
                ? trf('{0} → {1} ({2} days)', [
                    range.from,
                    range.to,
                    dateRange(range.from, range.to).length,
                  ])
                : tr('Select dates on the calendar.')}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {conflict && (
              <Alert tone="danger">
                {conflict.message}
                {conflict.dates.length > 0 &&
                  trf(' Conflicting dates: {0}.', [conflict.dates.join(', ')])}
              </Alert>
            )}
            <Input
              label={tr('Blocked rooms')}
              type="number"
              min={0}
              hint={tr('Leave empty to keep. Set 0 to unblock.')}
              value={blocked}
              onChange={(e) => setBlocked(e.target.value)}
            />
            <Select
              label={tr('Closed to arrival')}
              value={cta}
              onChange={(e) => setCta(e.target.value as 'keep')}
              options={[
                { value: 'keep', label: tr('No change') },
                { value: 'on', label: tr('Close') },
                { value: 'off', label: tr('Open') },
              ]}
            />
            <Select
              label={tr('Closed to departure')}
              value={ctd}
              onChange={(e) => setCtd(e.target.value as 'keep')}
              options={[
                { value: 'keep', label: tr('No change') },
                { value: 'on', label: tr('Close') },
                { value: 'off', label: tr('Open') },
              ]}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label={tr('Min stay')}
                type="number"
                min={0}
                hint={tr('0 clears')}
                value={minStay}
                onChange={(e) => setMinStay(e.target.value)}
              />
              <Input
                label={tr('Max stay')}
                type="number"
                min={0}
                hint={tr('0 clears')}
                value={maxStay}
                onChange={(e) => setMaxStay(e.target.value)}
              />
            </div>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">
                {tr('Only these days (optional)')}
              </legend>
              <div className="flex flex-wrap gap-2">
                {DOW.map((d, i) => (
                  <Checkbox
                    key={d}
                    label={d}
                    checked={days.includes(i)}
                    onChange={() =>
                      setDays((v) => (v.includes(i) ? v.filter((x) => x !== i) : [...v, i]))
                    }
                  />
                ))}
              </div>
            </fieldset>
            <Button disabled={!range} loading={saving} onClick={() => void apply()}>
              {tr('Apply to range')}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
