import { useState } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate, useParams } from 'react-router';
import { z } from 'zod';
import { BedDouble, Plus, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  BED_TYPES,
  CANCELLATION_POLICY_TYPES,
  MEAL_PLANS,
  MEAL_PLAN_LABELS,
  PRICING_RULE_TYPES,
  addDays,
  formatMinorUnits,
  parseMajorToMinor,
  roomTypeSchema,
  type PartnerRoomTypeDto,
  type PricingRuleDto,
  type QuoteDto,
  type RatePlanDto,
} from '@stayscape/shared';
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  ConfirmationDialog,
  DataTable,
  DatePicker,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  PageSpinner,
  Select,
  Textarea,
  todayIsoDate,
  useToast,
  type Column,
} from '@/components/ui';
import { useAmenities } from '@/features/marketplace/api';
import { ResponsiveImage } from '@/features/marketplace/components/HotelCard';
import { PriceBreakdown } from '@/features/marketplace/components/PriceBreakdown';
import { errorMessage, normalizeApiError } from '@/lib/api/errors';
import { applyServerErrors } from '@/lib/forms';
import { partnerApi, partnerKeys, usePricingRules, useRatePlans, useRoomTypes } from '../api';
import { usePropertyContext } from './PropertyPages';

const money = (minor: number) => formatMinorUnits(minor, 'INR');
const rupees = (minor: number) => (minor / 100).toFixed(2);
const toMinor = (v: string) => {
  try {
    return parseMajorToMinor(v || '0', 'INR');
  } catch {
    return NaN;
  }
};
const amount = z.string().regex(/^\d{1,8}(\.\d{1,2})?$/, 'Enter an amount like 4500 or 4500.50');

/* ---------------------------------------------------------------- rooms */
export function RoomsPage() {
  const { hotel } = usePropertyContext();
  const rooms = useRoomTypes(hotel.id);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [target, setTarget] = useState<PartnerRoomTypeDto | null>(null);
  const [busy, setBusy] = useState(false);
  if (rooms.isPending) return <PageSpinner />;
  if (rooms.isError)
    return (
      <ErrorState description={errorMessage(rooms.error)} onRetry={() => void rooms.refetch()} />
    );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <ButtonLink to="new" leftIcon={<Plus className="size-4" aria-hidden="true" />}>
          Add room category
        </ButtonLink>
      </div>
      {rooms.data.length === 0 ? (
        <EmptyState
          icon={<BedDouble />}
          title="No room categories yet"
          description="Add at least one room category with rooms and a rate plan before submitting the listing."
        />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {rooms.data.map((r) => (
            <li key={r.id}>
              <Card className="flex overflow-hidden">
                <ResponsiveImage
                  image={r.images[0] ?? null}
                  sizes="9rem"
                  className="w-32 shrink-0"
                />
                <div className="flex flex-1 flex-col gap-1.5 p-4">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{r.name}</h3>
                    <Badge tone={r.status === 'ACTIVE' ? 'success' : 'neutral'}>
                      {r.status.toLowerCase()}
                    </Badge>
                  </div>
                  <p className="text-sm text-fg-muted">
                    {r.totalInventory} rooms · sleeps {r.maximumOccupancy} · {r.roomSize}{' '}
                    {r.roomSizeUnit === 'SQM' ? 'm²' : 'sq ft'}
                  </p>
                  <div className="mt-auto flex gap-2 pt-2">
                    <ButtonLink to={`${r.id}/edit`} size="sm" variant="outline">
                      Edit
                    </ButtonLink>
                    <Button size="sm" variant="ghost" onClick={() => setTarget(r)}>
                      Remove
                    </Button>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <ConfirmationDialog
        open={target !== null}
        title={`Remove ${target?.name}?`}
        description="Categories that have ever had reservations or holds are archived instead of deleted, so booking history is preserved."
        tone="danger"
        confirmLabel="Remove"
        loading={busy}
        onCancel={() => setTarget(null)}
        onConfirm={async () => {
          if (!target) return;
          setBusy(true);
          try {
            const result = await partnerApi.deleteRoomType(hotel.id, target.id);
            toast({
              title: result.archived ? 'Room category archived' : 'Room category deleted',
              variant: 'success',
            });
            await qc.invalidateQueries({ queryKey: ['partner', 'hotel', hotel.id] });
          } catch (error) {
            toast({
              title: 'Could not remove',
              description: errorMessage(error),
              variant: 'error',
            });
          } finally {
            setBusy(false);
            setTarget(null);
          }
        }}
      />
    </div>
  );
}

export function RoomFormPage() {
  const { hotel } = usePropertyContext();
  const { roomId } = useParams();
  const rooms = useRoomTypes(hotel.id);
  const existing = rooms.data?.find((r) => r.id === roomId);
  if (roomId && rooms.isPending) return <PageSpinner />;
  if (roomId && !existing) return <EmptyState title="Room category not found" />;
  return <RoomForm key={existing?.id ?? 'new'} existing={existing} />;
}

function RoomForm({ existing }: { existing?: PartnerRoomTypeDto | undefined }) {
  const { hotel } = usePropertyContext();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const amenities = useAmenities();
  const { toast } = useToast();
  const [formError, setFormError] = useState<{ text: string; dates?: string[] } | null>(null);
  const { register, control, handleSubmit, setError, formState } = useForm({
    resolver: zodResolver(roomTypeSchema),
    defaultValues: existing
      ? {
          name: existing.name,
          description: existing.description,
          images: existing.imageRefs,
          roomSize: existing.roomSize,
          roomSizeUnit: existing.roomSizeUnit,
          bedConfiguration: existing.bedConfiguration,
          maximumAdults: existing.maximumAdults,
          maximumChildren: existing.maximumChildren,
          maximumOccupancy: existing.maximumOccupancy,
          amenities: existing.amenities,
          totalInventory: existing.totalInventory,
          status: existing.status === 'ARCHIVED' ? 'INACTIVE' : existing.status,
        }
      : {
          name: '',
          description: '',
          images: [],
          roomSize: 25,
          roomSizeUnit: 'SQM' as const,
          bedConfiguration: [{ type: 'DOUBLE' as const, count: 1 }],
          maximumAdults: 2,
          maximumChildren: 1,
          maximumOccupancy: 3,
          amenities: [],
          totalInventory: 5,
          status: 'ACTIVE' as const,
        },
  });
  const beds = useFieldArray({ control, name: 'bedConfiguration' });
  const e = formState.errors;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await partnerApi.saveRoomType(hotel.id, existing?.id ?? null, values);
      await qc.invalidateQueries({ queryKey: ['partner', 'hotel', hotel.id] });
      toast({
        title: existing ? 'Room category saved' : 'Room category added',
        variant: 'success',
      });
      navigate(`/partner/properties/${hotel.id}/rooms`);
    } catch (error) {
      const text = applyServerErrors(error, setError, [
        'name',
        'maximumOccupancy',
        'totalInventory',
      ]);
      const dates = normalizeApiError(error).details.dates;
      if (text)
        setFormError({ text, ...(Array.isArray(dates) ? { dates: dates as string[] } : {}) });
    }
  });

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-6">
      {formError && (
        <Alert tone="danger">
          {formError.text}
          {formError.dates?.length
            ? ` Affected dates: ${formError.dates.slice(0, 8).join(', ')}${formError.dates.length > 8 ? '…' : ''}`
            : ''}
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle as="h2">{existing ? `Edit ${existing.name}` : 'New room category'}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <Input
            label="Name"
            required
            containerClassName="sm:col-span-2"
            error={e.name?.message}
            {...register('name')}
          />
          <Textarea
            label="Description"
            required
            error={e.description?.message}
            {...register('description')}
          />
          <Input
            label="Room size"
            type="number"
            step="0.1"
            error={e.roomSize?.message}
            {...register('roomSize', { valueAsNumber: true })}
          />
          <Select
            label="Size unit"
            options={[
              { value: 'SQM', label: 'Square metres' },
              { value: 'SQFT', label: 'Square feet' },
            ]}
            {...register('roomSizeUnit')}
          />
          <Input
            label="Max adults"
            type="number"
            error={e.maximumAdults?.message}
            {...register('maximumAdults', { valueAsNumber: true })}
          />
          <Input
            label="Max children"
            type="number"
            error={e.maximumChildren?.message}
            {...register('maximumChildren', { valueAsNumber: true })}
          />
          <Input
            label="Max occupancy"
            type="number"
            error={e.maximumOccupancy?.message}
            {...register('maximumOccupancy', { valueAsNumber: true })}
          />
          <Input
            label="Number of rooms"
            type="number"
            hint="Reductions are refused if they'd fall below reserved or blocked rooms on any future date."
            error={e.totalInventory?.message}
            {...register('totalInventory', { valueAsNumber: true })}
          />
          <Select
            label="Status"
            options={[
              { value: 'ACTIVE', label: 'Active — bookable' },
              { value: 'INACTIVE', label: 'Inactive — hidden' },
            ]}
            {...register('status')}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle as="h2">Beds</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {beds.fields.map((f, i) => (
            <div key={f.id} className="grid items-end gap-3 sm:grid-cols-[1fr_8rem_auto]">
              <Select
                label="Bed type"
                options={BED_TYPES.map((b) => ({
                  value: b,
                  label: b.charAt(0) + b.slice(1).toLowerCase().replace('_', ' '),
                }))}
                {...register(`bedConfiguration.${i}.type`)}
              />
              <Input
                label="Count"
                type="number"
                {...register(`bedConfiguration.${i}.count`, { valueAsNumber: true })}
              />
              <Button
                variant="ghost"
                disabled={beds.fields.length === 1}
                onClick={() => beds.remove(i)}
                aria-label={`Remove bed ${i + 1}`}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            </div>
          ))}
          {e.bedConfiguration?.message && (
            <p className="text-xs text-danger">{e.bedConfiguration.message}</p>
          )}
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() => beds.append({ type: 'SINGLE', count: 1 })}
            disabled={beds.fields.length >= 6}
          >
            Add bed
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle as="h2">Photos & amenities</CardTitle>
          <CardDescription>
            Choose from the property photo library (upload under Photos & videos).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <Controller
            control={control}
            name="images"
            render={({ field }) => (
              <fieldset className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <legend className="sr-only">Room photos</legend>
                {hotel.images.length === 0 && (
                  <p className="col-span-full text-sm text-fg-muted">No property photos yet.</p>
                )}
                {hotel.images.map((img) => {
                  const selected = (field.value ?? []).some((v) => v.mediaId === img.id);
                  return (
                    <label
                      key={img.id}
                      className={`relative cursor-pointer overflow-hidden rounded-lg border-2 ${selected ? 'border-primary' : 'border-transparent'}`}
                    >
                      <ResponsiveImage image={img} sizes="12rem" className="aspect-[4/3] w-full" />
                      <input
                        type="checkbox"
                        className="absolute top-2 left-2 size-4"
                        checked={selected}
                        onChange={() =>
                          field.onChange(
                            selected
                              ? (field.value ?? []).filter((v) => v.mediaId !== img.id)
                              : [...(field.value ?? []), { mediaId: img.id, alt: img.alt }],
                          )
                        }
                        aria-label={`Use photo ${img.alt || img.id} for this room`}
                      />
                    </label>
                  );
                })}
              </fieldset>
            )}
          />
          <Controller
            control={control}
            name="amenities"
            render={({ field }) => (
              <fieldset className="grid gap-3 sm:grid-cols-3">
                <legend className="mb-2 text-sm font-medium">Room amenities</legend>
                {(amenities.data ?? [])
                  .filter((a) => ['ROOM', 'BATHROOM', 'GENERAL'].includes(a.category))
                  .map((a) => (
                    <Checkbox
                      key={a.code}
                      label={a.name}
                      checked={(field.value ?? []).includes(a.code)}
                      onChange={() =>
                        field.onChange(
                          (field.value ?? []).includes(a.code)
                            ? (field.value ?? []).filter((c) => c !== a.code)
                            : [...(field.value ?? []), a.code],
                        )
                      }
                    />
                  ))}
              </fieldset>
            )}
          />
        </CardContent>
      </Card>
      <div className="flex justify-end gap-2">
        <ButtonLink to={`/partner/properties/${hotel.id}/rooms`} variant="ghost">
          Cancel
        </ButtonLink>
        <Button type="submit" loading={formState.isSubmitting}>
          {existing ? 'Save room category' : 'Add room category'}
        </Button>
      </div>
    </form>
  );
}

/* ---------------------------------------------------------------- rates */
const rateForm = z.object({
  roomTypeId: z.string().min(1, 'Choose a room'),
  name: z.string().trim().min(1, 'Name required').max(80),
  mealPlan: z.enum(MEAL_PLANS),
  cancellationType: z.enum(CANCELLATION_POLICY_TYPES),
  freeCancellationHours: z.number().int().min(0).max(720),
  basePrice: amount,
  includedAdults: z.number().int().min(1).max(20),
  additionalAdultPrice: amount,
  additionalChildPrice: amount,
  extraBedPrice: amount,
  mealSupplement: amount,
  minimumStay: z.number().int().min(1).max(30),
  maximumStay: z.number().int().min(1).max(30),
  active: z.boolean(),
});
type RateValues = z.infer<typeof rateForm>;

function RatePlanModal({
  hotelId,
  rooms,
  plan,
  onClose,
}: {
  hotelId: string;
  rooms: PartnerRoomTypeDto[];
  plan: RatePlanDto | 'new';
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const p = plan === 'new' ? null : plan;
  const { register, handleSubmit, formState, control } = useForm<RateValues>({
    resolver: zodResolver(rateForm),
    defaultValues: {
      roomTypeId: p?.roomTypeId ?? rooms[0]?.id ?? '',
      name: p?.name ?? 'Standard rate',
      mealPlan: p?.mealPlan ?? 'ROOM_ONLY',
      cancellationType: p?.cancellationPolicy.type ?? 'FREE_CANCELLATION',
      freeCancellationHours: p?.cancellationPolicy.freeCancellationHours ?? 48,
      basePrice: p ? rupees(p.basePriceMinor) : '',
      includedAdults: p?.includedAdults ?? 2,
      additionalAdultPrice: p ? rupees(p.additionalAdultPriceMinor) : '0',
      additionalChildPrice: p ? rupees(p.additionalChildPriceMinor) : '0',
      extraBedPrice: p ? rupees(p.extraBedPriceMinor) : '0',
      mealSupplement: p ? rupees(p.mealSupplementPerGuestMinor) : '0',
      minimumStay: p?.minimumStay ?? 1,
      maximumStay: p?.maximumStay ?? 30,
      active: p?.active ?? true,
    },
  });
  const e = formState.errors;
  const onSubmit = handleSubmit(async (v) => {
    try {
      await partnerApi.saveRatePlan(hotelId, p?.id ?? null, {
        roomTypeId: v.roomTypeId,
        name: v.name,
        mealPlan: v.mealPlan,
        cancellationPolicy: {
          type: v.cancellationType,
          freeCancellationHours: v.freeCancellationHours,
          refundBasisPointsAfterDeadline: 0,
        },
        basePriceMinor: toMinor(v.basePrice),
        includedAdults: v.includedAdults,
        includedChildren: 0,
        additionalAdultPriceMinor: toMinor(v.additionalAdultPrice),
        additionalChildPriceMinor: toMinor(v.additionalChildPrice),
        extraBedPriceMinor: toMinor(v.extraBedPrice),
        mealSupplementPerGuestMinor: toMinor(v.mealSupplement),
        minimumStay: v.minimumStay,
        maximumStay: v.maximumStay,
        active: v.active,
      });
      await qc.invalidateQueries({ queryKey: ['partner', 'hotel', hotelId] });
      toast({ title: 'Rate plan saved', variant: 'success' });
      onClose();
    } catch (error) {
      toast({
        title: 'Could not save rate plan',
        description: errorMessage(error),
        variant: 'error',
      });
    }
  });
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={p ? `Edit ${p.name}` : 'New rate plan'}
      description="All amounts are in rupees per room per night unless stated; they are stored as exact paise."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={formState.isSubmitting} onClick={() => void onSubmit()}>
            Save rate plan
          </Button>
        </>
      }
    >
      <form noValidate onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Room category"
          options={rooms.map((r) => ({ value: r.id, label: r.name }))}
          error={e.roomTypeId?.message}
          {...register('roomTypeId')}
        />
        <Input label="Rate name" error={e.name?.message} {...register('name')} />
        <Select
          label="Meal plan"
          options={MEAL_PLANS.map((m) => ({ value: m, label: MEAL_PLAN_LABELS[m] }))}
          {...register('mealPlan')}
        />
        <Select
          label="Cancellation"
          options={[
            { value: 'FREE_CANCELLATION', label: 'Free cancellation' },
            { value: 'PARTIALLY_REFUNDABLE', label: 'Partially refundable' },
            { value: 'NON_REFUNDABLE', label: 'Non-refundable' },
          ]}
          {...register('cancellationType')}
        />
        <Input
          label="Base price (₹ / night)"
          inputMode="decimal"
          error={e.basePrice?.message}
          {...register('basePrice')}
        />
        <Input
          label="Free cancellation until (hours before)"
          type="number"
          {...register('freeCancellationHours', { valueAsNumber: true })}
        />
        <Input
          label="Adults included in base"
          type="number"
          {...register('includedAdults', { valueAsNumber: true })}
        />
        <Input
          label="Each extra adult (₹)"
          inputMode="decimal"
          error={e.additionalAdultPrice?.message}
          {...register('additionalAdultPrice')}
        />
        <Input
          label="Each child (₹)"
          inputMode="decimal"
          error={e.additionalChildPrice?.message}
          {...register('additionalChildPrice')}
        />
        <Input
          label="Extra bed (₹)"
          inputMode="decimal"
          error={e.extraBedPrice?.message}
          {...register('extraBedPrice')}
        />
        <Input
          label="Meal supplement per guest (₹)"
          inputMode="decimal"
          error={e.mealSupplement?.message}
          {...register('mealSupplement')}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Min stay"
            type="number"
            {...register('minimumStay', { valueAsNumber: true })}
          />
          <Input
            label="Max stay"
            type="number"
            {...register('maximumStay', { valueAsNumber: true })}
          />
        </div>
        <Controller
          control={control}
          name="active"
          render={({ field }) => (
            <Checkbox
              label="Active"
              checked={field.value}
              onChange={(ev) => field.onChange(ev.target.checked)}
            />
          )}
        />
      </form>
    </Modal>
  );
}

const ruleForm = z.object({
  name: z.string().trim().min(1).max(80),
  ruleType: z.enum(PRICING_RULE_TYPES),
  scopeRoomTypeId: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  daysOfWeek: z.array(z.number()),
  mode: z.enum(['PERCENT', 'AMOUNT', 'FIXED_PRICE']),
  value: z.string().regex(/^-?\d{1,8}(\.\d{1,2})?$/, 'Enter a number'),
  priority: z.number().int().min(0).max(1000),
  exclusive: z.boolean(),
  minNights: z.string(),
  minDays: z.string(),
  maxDays: z.string(),
});
type RuleValues = z.infer<typeof ruleForm>;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function RuleModal({
  hotelId,
  rooms,
  rule,
  onClose,
}: {
  hotelId: string;
  rooms: PartnerRoomTypeDto[];
  rule: PricingRuleDto | 'new';
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const r = rule === 'new' ? null : rule;
  const { register, handleSubmit, control, watch, formState } = useForm<RuleValues>({
    resolver: zodResolver(ruleForm),
    defaultValues: {
      name: r?.name ?? 'Weekend rate',
      ruleType: r?.ruleType ?? 'WEEKEND',
      scopeRoomTypeId: r?.roomTypeId ?? '',
      startDate: r?.startDate ?? '',
      endDate: r?.endDate ?? '',
      daysOfWeek: r?.daysOfWeek ?? [5, 6],
      mode: r?.adjustmentType ?? 'PERCENT',
      value: r
        ? r.adjustmentType === 'PERCENT'
          ? (r.adjustmentValue / 100).toString()
          : rupees(r.adjustmentValue)
        : '15',
      priority: r?.priority ?? 100,
      exclusive: r?.stackingPolicy === 'EXCLUSIVE',
      minNights: r?.conditions.minNights?.toString() ?? '',
      minDays: r?.conditions.minDaysBeforeArrival?.toString() ?? '',
      maxDays: r?.conditions.maxDaysBeforeArrival?.toString() ?? '',
    },
  });
  const type = watch('ruleType');
  const isDiscount = ['LONG_STAY', 'EARLY_BIRD', 'LAST_MINUTE'].includes(type);
  const onSubmit = handleSubmit(async (v) => {
    const raw =
      v.mode === 'PERCENT'
        ? Math.round(Number(v.value) * 100)
        : toMinor(v.value.replace('-', '')) * (v.value.startsWith('-') ? -1 : 1);
    const num = (s: string) => (s ? Number(s) : undefined);
    try {
      await partnerApi.saveRule(hotelId, r?.id ?? null, {
        name: v.name,
        ruleType: v.ruleType,
        roomTypeId: v.scopeRoomTypeId || null,
        ratePlanId: null,
        startDate: v.startDate || null,
        endDate: v.endDate || null,
        daysOfWeek: v.daysOfWeek,
        adjustmentType:
          v.ruleType === 'DATE_OVERRIDE'
            ? 'FIXED_PRICE'
            : v.mode === 'FIXED_PRICE'
              ? 'AMOUNT'
              : v.mode,
        adjustmentValue: isDiscount ? -Math.abs(raw) : raw,
        priority: v.priority,
        stackingPolicy: v.exclusive ? 'EXCLUSIVE' : 'STACKABLE',
        conditions: {
          minNights: num(v.minNights),
          minDaysBeforeArrival: num(v.minDays),
          maxDaysBeforeArrival: num(v.maxDays),
        },
        active: true,
      });
      await qc.invalidateQueries({ queryKey: partnerKeys.rules(hotelId) });
      toast({ title: 'Pricing rule saved', variant: 'success' });
      onClose();
    } catch (error) {
      toast({ title: 'Could not save rule', description: errorMessage(error), variant: 'error' });
    }
  });
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={r ? `Edit ${r.name}` : 'New pricing rule'}
      description="Higher priority rules are applied first. An exclusive rule at the top prevents others of its kind from stacking."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={formState.isSubmitting} onClick={() => void onSubmit()}>
            Save rule
          </Button>
        </>
      }
    >
      <form noValidate onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
        <Input label="Name" {...register('name')} />
        <Select
          label="Type"
          options={PRICING_RULE_TYPES.map((t) => ({
            value: t,
            label: t.replace('_', ' ').toLowerCase(),
          }))}
          {...register('ruleType')}
        />
        <Select
          label="Applies to"
          options={[
            { value: '', label: 'All rooms' },
            ...rooms.map((rm) => ({ value: rm.id, label: rm.name })),
          ]}
          {...register('scopeRoomTypeId')}
        />
        {type === 'DATE_OVERRIDE' ? (
          <Input label="Fixed nightly price (₹)" inputMode="decimal" {...register('value')} />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Adjustment"
              options={[
                { value: 'PERCENT', label: '%' },
                { value: 'AMOUNT', label: '₹ amount' },
              ]}
              {...register('mode')}
            />
            <Input
              label={isDiscount ? 'Discount' : 'Change (+/−)'}
              inputMode="decimal"
              error={formState.errors.value?.message}
              {...register('value')}
            />
          </div>
        )}
        <DatePicker label="Start date" {...register('startDate')} />
        <DatePicker label="End date" {...register('endDate')} />
        {(type === 'WEEKDAY' || type === 'WEEKEND' || type === 'SEASONAL' || type === 'EVENT') && (
          <Controller
            control={control}
            name="daysOfWeek"
            render={({ field }) => (
              <fieldset className="sm:col-span-2">
                <legend className="mb-2 text-sm font-medium">Nights of the week</legend>
                <div className="flex flex-wrap gap-3">
                  {DOW.map((d, i) => (
                    <Checkbox
                      key={d}
                      label={d}
                      checked={field.value.includes(i)}
                      onChange={() =>
                        field.onChange(
                          field.value.includes(i)
                            ? field.value.filter((x) => x !== i)
                            : [...field.value, i],
                        )
                      }
                    />
                  ))}
                </div>
              </fieldset>
            )}
          />
        )}
        {type === 'LONG_STAY' && (
          <Input label="Minimum nights" type="number" {...register('minNights')} />
        )}
        {type === 'EARLY_BIRD' && (
          <Input label="Book at least N days ahead" type="number" {...register('minDays')} />
        )}
        {type === 'LAST_MINUTE' && (
          <Input label="Book within N days of arrival" type="number" {...register('maxDays')} />
        )}
        <Input
          label="Priority (0–1000)"
          type="number"
          {...register('priority', { valueAsNumber: true })}
        />
        <Controller
          control={control}
          name="exclusive"
          render={({ field }) => (
            <Checkbox
              label="Exclusive (don't stack)"
              checked={field.value}
              onChange={(ev) => field.onChange(ev.target.checked)}
            />
          )}
        />
      </form>
    </Modal>
  );
}

export function RatesPage() {
  const { hotel } = usePropertyContext();
  const rooms = useRoomTypes(hotel.id);
  const plans = useRatePlans(hotel.id);
  const rules = usePricingRules(hotel.id);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [planModal, setPlanModal] = useState<RatePlanDto | 'new' | null>(null);
  const [ruleModal, setRuleModal] = useState<PricingRuleDto | 'new' | null>(null);
  const [preview, setPreview] = useState<{ quote: QuoteDto | null; error: string | null }>({
    quote: null,
    error: null,
  });
  const [previewInput, setPreviewInput] = useState({
    planId: '',
    checkIn: addDays(todayIsoDate(), 14),
    nights: 2,
    adults: 2,
  });
  if (rooms.isPending || plans.isPending || rules.isPending) return <PageSpinner />;
  if (rooms.isError || plans.isError || rules.isError)
    return (
      <ErrorState
        description="Could not load rates."
        onRetry={() => void qc.invalidateQueries({ queryKey: ['partner', 'hotel', hotel.id] })}
      />
    );
  const roomName = (id: string | null) =>
    id ? (rooms.data.find((r) => r.id === id)?.name ?? '—') : 'All rooms';

  const planColumns: Column<RatePlanDto>[] = [
    {
      id: 'name',
      header: 'Rate plan',
      cell: (p) => (
        <>
          <p className="font-medium">{p.name}</p>
          <p className="text-xs text-fg-subtle">{roomName(p.roomTypeId)}</p>
        </>
      ),
    },
    { id: 'meal', header: 'Meals', cell: (p) => MEAL_PLAN_LABELS[p.mealPlan] },
    {
      id: 'cancel',
      header: 'Cancellation',
      cell: (p) => p.cancellationPolicy.type.replace('_', ' ').toLowerCase(),
    },
    { id: 'price', header: 'Base / night', align: 'right', cell: (p) => money(p.basePriceMinor) },
    {
      id: 'status',
      header: 'Status',
      cell: (p) => (
        <Badge tone={p.active ? 'success' : 'neutral'}>{p.active ? 'Active' : 'Inactive'}</Badge>
      ),
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (p) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => setPlanModal(p)}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              try {
                await partnerApi.deleteRatePlan(hotel.id, p.id);
                await qc.invalidateQueries({ queryKey: ['partner', 'hotel', hotel.id] });
              } catch (err) {
                toast({
                  title: 'Could not delete',
                  description: errorMessage(err),
                  variant: 'error',
                });
              }
            }}
          >
            Delete
          </Button>
        </div>
      ),
    },
  ];
  const ruleColumns: Column<PricingRuleDto>[] = [
    {
      id: 'name',
      header: 'Rule',
      cell: (r) => (
        <>
          <p className="font-medium">{r.name}</p>
          <p className="text-xs text-fg-subtle">
            {r.ruleType.replace('_', ' ').toLowerCase()} · {roomName(r.roomTypeId)}
          </p>
        </>
      ),
    },
    {
      id: 'adj',
      header: 'Adjustment',
      cell: (r) =>
        r.adjustmentType === 'PERCENT'
          ? `${r.adjustmentValue > 0 ? '+' : ''}${r.adjustmentValue / 100}%`
          : r.adjustmentType === 'FIXED_PRICE'
            ? `= ${money(r.adjustmentValue)}`
            : `${r.adjustmentValue > 0 ? '+' : '−'}${money(Math.abs(r.adjustmentValue))}`,
    },
    {
      id: 'when',
      header: 'When',
      cell: (r) => (
        <span className="text-xs">
          {r.startDate ? `${r.startDate} → ${r.endDate}` : 'Always'}
          {r.daysOfWeek.length ? ` · ${r.daysOfWeek.map((d) => DOW[d]).join(', ')}` : ''}
        </span>
      ),
    },
    {
      id: 'prio',
      header: 'Priority',
      cell: (r) => `${r.priority}${r.stackingPolicy === 'EXCLUSIVE' ? ' · exclusive' : ''}`,
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (r) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => setRuleModal(r)}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              await partnerApi.deleteRule(hotel.id, r.id);
              await qc.invalidateQueries({ queryKey: partnerKeys.rules(hotel.id) });
            }}
          >
            Delete
          </Button>
        </div>
      ),
    },
  ];
  const runPreview = async () => {
    const plan = plans.data.find((p) => p.id === (previewInput.planId || plans.data[0]?.id));
    if (!plan) return;
    try {
      const quote = await partnerApi.quotePreview(hotel.id, {
        roomTypeId: plan.roomTypeId,
        ratePlanId: plan.id,
        checkIn: previewInput.checkIn,
        checkOut: addDays(previewInput.checkIn, previewInput.nights),
        adults: previewInput.adults,
        children: 0,
        childrenAges: [],
        rooms: 1,
        extraBeds: 0,
      });
      setPreview({ quote, error: null });
    } catch (error) {
      setPreview({ quote: null, error: errorMessage(error) });
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex-row items-start justify-between">
          <div>
            <CardTitle as="h2">Rate plans</CardTitle>
            <CardDescription>
              Base prices per room per night. Taxes are added on top for guests.
            </CardDescription>
          </div>
          <Button size="sm" disabled={rooms.data.length === 0} onClick={() => setPlanModal('new')}>
            Add rate plan
          </Button>
        </CardHeader>
        <CardContent>
          <DataTable
            caption="Rate plans"
            columns={planColumns}
            rows={plans.data}
            getRowId={(p) => p.id}
            empty={
              <p className="text-center text-sm text-fg-muted">
                {rooms.data.length ? 'No rate plans yet.' : 'Add a room category first.'}
              </p>
            }
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex-row items-start justify-between">
          <div>
            <CardTitle as="h2">Pricing rules</CardTitle>
            <CardDescription>
              Weekend, seasonal and event rates, date overrides and discounts. See the precedence
              explained in the help text when editing.
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setRuleModal('new')}>
            Add rule
          </Button>
        </CardHeader>
        <CardContent>
          <DataTable
            caption="Pricing rules"
            columns={ruleColumns}
            rows={rules.data}
            getRowId={(r) => r.id}
            empty={
              <p className="text-center text-sm text-fg-muted">
                No rules — the base rate applies every night.
              </p>
            }
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle as="h2">Price preview</CardTitle>
          <CardDescription>
            Uses the same engine as public quotes, including availability and restrictions.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid items-end gap-3 sm:grid-cols-[1.5fr_1fr_6rem_6rem_auto]">
            <Select
              label="Rate plan"
              value={previewInput.planId}
              onChange={(ev) => setPreviewInput((p) => ({ ...p, planId: ev.target.value }))}
              options={plans.data.map((p) => ({
                value: p.id,
                label: `${p.name} (${roomName(p.roomTypeId)})`,
              }))}
            />
            <DatePicker
              label="Check-in"
              value={previewInput.checkIn}
              onChange={(ev) => setPreviewInput((p) => ({ ...p, checkIn: ev.target.value }))}
            />
            <Input
              label="Nights"
              type="number"
              min={1}
              max={30}
              value={previewInput.nights}
              onChange={(ev) =>
                setPreviewInput((p) => ({ ...p, nights: Number(ev.target.value) || 1 }))
              }
            />
            <Input
              label="Adults"
              type="number"
              min={1}
              value={previewInput.adults}
              onChange={(ev) =>
                setPreviewInput((p) => ({ ...p, adults: Number(ev.target.value) || 1 }))
              }
            />
            <Button
              variant="outline"
              disabled={plans.data.length === 0}
              onClick={() => void runPreview()}
            >
              Calculate
            </Button>
          </div>
          {preview.error && <Alert tone="warning">{preview.error}</Alert>}
          {preview.quote && <PriceBreakdown quote={preview.quote} />}
        </CardContent>
      </Card>
      {planModal && (
        <RatePlanModal
          hotelId={hotel.id}
          rooms={rooms.data}
          plan={planModal}
          onClose={() => setPlanModal(null)}
        />
      )}
      {ruleModal && (
        <RuleModal
          hotelId={hotel.id}
          rooms={rooms.data}
          rule={ruleModal}
          onClose={() => setRuleModal(null)}
        />
      )}
    </div>
  );
}
