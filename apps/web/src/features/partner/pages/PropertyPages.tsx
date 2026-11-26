import { useEffect, useState } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { NavLink, Navigate, Outlet, useNavigate, useOutletContext, useParams } from 'react-router';
import { z } from 'zod';
import { ArrowDown, ArrowUp, Building2, ImagePlus, Plus, Star, Trash2 } from 'lucide-react';
import {
  IMAGE_MAX_BYTES,
  PROPERTY_TYPES,
  PROPERTY_TYPE_LABELS,
  hotelContentSchema,
  hotelPoliciesSchema,
  hotelVideoSchema,
  type HotelContentDto,
  type PartnerHotelDto,
  type PublicationStatus,
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
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  PageSpinner,
  Select,
  Textarea,
  useToast,
  type BadgeTone,
} from '@/components/ui';
import { MapView } from '@/components/map/MapView';
import { useAuth } from '@/features/auth/use-auth';
import { useAmenities } from '@/features/marketplace/api';
import { ResponsiveImage } from '@/features/marketplace/components/HotelCard';
import { errorMessage, normalizeApiError } from '@/lib/api/errors';
import { applyServerErrors } from '@/lib/forms';
import { cn } from '@/lib/cn';
import {
  partnerApi,
  partnerKeys,
  useHotelMutation,
  usePartnerHotel,
  usePartnerHotels,
} from '../api';
import { useQueryClient } from '@tanstack/react-query';
import { tr, trf } from '@/lib/tr';

export const STATUS_TONE: Record<PublicationStatus, BadgeTone> = {
  DRAFT: 'neutral',
  SUBMITTED: 'info',
  UNDER_REVIEW: 'info',
  APPROVED: 'primary',
  PUBLISHED: 'success',
  REJECTED: 'danger',
  SUSPENDED: 'danger',
  ARCHIVED: 'outline',
};
export const statusLabel = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace('_', ' ');

export function PropertiesPage() {
  const hotels = usePartnerHotels();
  const { can } = useAuth();
  if (!can('partner:access')) return <Navigate to="/partner/onboarding" replace />;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={tr('Properties')}
        description={tr('Your listings and their review status.')}
        actions={
          can('hotels:create') && (
            <ButtonLink
              to="/partner/properties/new"
              leftIcon={<Plus className="size-4" aria-hidden="true" />}
            >
              {tr('Add property')}
            </ButtonLink>
          )
        }
      />
      {hotels.isPending ? (
        <PageSpinner />
      ) : hotels.isError ? (
        <ErrorState
          description={errorMessage(hotels.error)}
          onRetry={() => void hotels.refetch()}
        />
      ) : hotels.data.length === 0 ? (
        <EmptyState
          icon={<Building2 />}
          title={tr('No properties yet')}
          description={tr(
            'Add your first property. It stays private until our team approves it and you publish it.',
          )}
          action={
            can('hotels:create') && (
              <ButtonLink to="/partner/properties/new">{tr('Add property')}</ButtonLink>
            )
          }
        />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {hotels.data.map((h) => (
            <li key={h.id}>
              <Card className="flex overflow-hidden">
                <ResponsiveImage
                  image={h.coverImage}
                  sizes="10rem"
                  className="h-full w-36 shrink-0"
                />
                <div className="flex flex-1 flex-col gap-2 p-4">
                  <div className="flex flex-wrap gap-1.5">
                    <Badge tone={STATUS_TONE[h.publicationStatus]}>
                      {statusLabel(h.publicationStatus)}
                    </Badge>
                    {h.revisionStatus !== 'NONE' && (
                      <Badge tone="warning">
                        {tr('Changes')} {h.revisionStatus.toLowerCase()}
                      </Badge>
                    )}
                  </div>
                  <h2 className="font-display text-lg font-semibold">{h.name}</h2>
                  <p className="text-sm text-fg-muted">
                    {h.city} · {tr(PROPERTY_TYPE_LABELS[h.propertyType])} · {h.roomTypeCount}{' '}
                    {h.roomTypeCount === 1 ? tr('room category') : tr('room categories')}
                  </p>
                  <ButtonLink
                    to={`/partner/properties/${h.id}`}
                    variant="outline"
                    size="sm"
                    className="mt-auto w-fit"
                  >
                    {tr('Manage')}
                  </ButtonLink>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- property shell */
export interface PropertyContext {
  hotel: PartnerHotelDto;
}
export const usePropertyContext = () => useOutletContext<PropertyContext>();

export function PropertyLayout() {
  const { id = '' } = useParams();
  const hotel = usePartnerHotel(id);
  if (hotel.isPending) return <PageSpinner label={tr('Loading property')} />;
  if (hotel.isError)
    return normalizeApiError(hotel.error).status === 404 ? (
      <EmptyState
        title={tr('Property not found')}
        action={<ButtonLink to="/partner/properties">{tr('Back to properties')}</ButtonLink>}
      />
    ) : (
      <ErrorState description={errorMessage(hotel.error)} onRetry={() => void hotel.refetch()} />
    );
  const tabs = [
    { to: '', label: tr('Overview'), end: true },
    { to: 'edit', label: tr('Details') },
    { to: 'media', label: tr('Photos & videos') },
    { to: 'policies', label: tr('Policies & fees') },
    { to: 'rooms', label: tr('Rooms') },
    { to: 'rates', label: tr('Rates & pricing') },
  ];
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumb={[
          { label: tr('Properties'), to: '/partner/properties' },
          { label: hotel.data.working.name },
        ]}
        title={hotel.data.working.name}
        description={`${hotel.data.working.city} · ${PROPERTY_TYPE_LABELS[hotel.data.working.propertyType]}`}
        actions={
          <Badge tone={STATUS_TONE[hotel.data.publicationStatus]} className="text-sm">
            {statusLabel(hotel.data.publicationStatus)}
          </Badge>
        }
      />
      <nav
        aria-label={tr('Property sections')}
        className="-mt-2 flex gap-1 overflow-x-auto border-b border-border"
      >
        {tabs.map((t) => (
          <NavLink
            key={t.label}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              cn(
                '-mb-px border-b-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap',
                isActive
                  ? 'border-primary text-fg'
                  : 'border-transparent text-fg-muted hover:text-fg',
              )
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet context={{ hotel: hotel.data } satisfies PropertyContext} />
    </div>
  );
}

/* ---------------------------------------------------------------- overview & workflow */
export function PropertyOverviewPage() {
  const { hotel } = usePropertyContext();
  const { toast } = useToast();
  const [confirmArchive, setConfirmArchive] = useState(false);
  const act = useHotelMutation(hotel.id, (action: 'submit' | 'publish' | 'unpublish' | 'archive') =>
    partnerApi.action(hotel.id, action),
  );
  const run = (action: 'submit' | 'publish' | 'unpublish' | 'archive', success: string) =>
    act.mutate(action, {
      onSuccess: () => toast({ title: success, variant: 'success' }),
      onError: (e) =>
        toast({
          title: tr('Action failed'),
          description: normalizeApiError(e).message,
          variant: 'error',
        }),
    });
  const s = hotel.publicationStatus;
  const revision = hotel.revision;
  const steps: PublicationStatus[] = [
    'DRAFT',
    'SUBMITTED',
    'UNDER_REVIEW',
    'APPROVED',
    'PUBLISHED',
  ];

  return (
    <div className="flex flex-col gap-6">
      {s === 'REJECTED' && (
        <Alert tone="danger" title={tr('Changes requested')}>
          {hotel.rejectionReason} {tr('Edit the listing and submit it again.')}
        </Alert>
      )}
      {s === 'SUSPENDED' && (
        <Alert tone="danger" title={tr('Listing suspended')}>
          {hotel.rejectionReason ?? tr('Contact support for details.')}
        </Alert>
      )}
      {revision.status === 'DRAFT' && (
        <Alert tone="warning" title={tr('Unsubmitted changes')}>
          {tr('You have edited')} {revision.changedFields.join(', ')}
          {tr(
            '. Travellers still see the approved version until you submit and we approve the changes.',
          )}
        </Alert>
      )}
      {revision.status === 'SUBMITTED' && (
        <Alert tone="info" title={tr('Changes under review')}>
          {tr('Your edits are awaiting approval; the live listing is unchanged.')}
        </Alert>
      )}
      {revision.status === 'REJECTED' && (
        <Alert tone="danger" title={tr('Changes not approved')}>
          {revision.rejectionReason}
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle as="h2">{tr('Publication')}</CardTitle>
          <CardDescription>
            {tr('Listings must be approved by STAYSCAPE before you can publish them to search.')}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <ol className="flex flex-wrap gap-2" aria-label={tr('Publication workflow')}>
            {steps.map((step, i) => {
              const reached = steps.indexOf(s) >= i || (s === 'REJECTED' && i <= 1);
              return (
                <li key={step}>
                  <Badge
                    tone={step === s ? STATUS_TONE[step] : reached ? 'success' : 'outline'}
                    aria-current={step === s ? 'step' : undefined}
                  >
                    {i + 1}. {statusLabel(step)}
                  </Badge>
                </li>
              );
            })}
          </ol>
          {!hotel.completeness.ready && (
            <Alert tone="warning" title={tr('Complete these before submitting')}>
              <ul className="list-disc pl-5">
                {hotel.completeness.missing.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </Alert>
          )}
          <div className="flex flex-wrap gap-2">
            {(s === 'DRAFT' || s === 'REJECTED') && (
              <Button
                disabled={!hotel.completeness.ready}
                loading={act.isPending}
                onClick={() => run('submit', 'Submitted for review')}
              >
                {tr('Submit for review')}
              </Button>
            )}
            {hotel.everApproved &&
              (revision.status === 'DRAFT' || revision.status === 'REJECTED') && (
                <Button
                  loading={act.isPending}
                  onClick={() => run('submit', 'Changes submitted for review')}
                >
                  {tr('Submit changes for review')}
                </Button>
              )}
            {s === 'APPROVED' && (
              <Button loading={act.isPending} onClick={() => run('publish', 'Listing published')}>
                {tr('Publish to search')}
              </Button>
            )}
            {s === 'PUBLISHED' && (
              <Button
                variant="outline"
                loading={act.isPending}
                onClick={() => run('unpublish', 'Listing unpublished')}
              >
                {tr('Unpublish')}
              </Button>
            )}
            {s === 'PUBLISHED' && (
              <ButtonLink to={`/hotels/${hotel.slug}`} variant="ghost" target="_blank">
                {tr('View public page')}
              </ButtonLink>
            )}
            {s !== 'ARCHIVED' && s !== 'SUSPENDED' && (
              <Button variant="ghost" onClick={() => setConfirmArchive(true)}>
                {tr('Archive')}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-5">
          <p className="text-sm text-fg-muted">{tr('Photos')}</p>
          <p className="mt-1 font-display text-2xl font-semibold">{hotel.images.length}</p>
        </Card>
        <Card className="p-5">
          <p className="text-sm text-fg-muted">{tr('Verification')}</p>
          <p className="mt-1 font-display text-2xl font-semibold">
            {statusLabel(hotel.verificationStatus)}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-sm text-fg-muted">{tr('Featured')}</p>
          <p className="mt-1 font-display text-2xl font-semibold">
            {hotel.featured ? tr('Yes') : tr('No')}
          </p>
        </Card>
      </div>
      <ConfirmationDialog
        open={confirmArchive}
        title={tr('Archive this property?')}
        description={tr(
          'It will be removed from search and can no longer be edited. Properties with upcoming reservations cannot be archived.',
        )}
        tone="danger"
        confirmLabel={tr('Archive')}
        loading={act.isPending}
        onCancel={() => setConfirmArchive(false)}
        onConfirm={() => {
          run('archive', 'Property archived');
          setConfirmArchive(false);
        }}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- details form */
const detailsSchema = hotelContentSchema
  .pick({
    name: true,
    shortDescription: true,
    description: true,
    propertyType: true,
    starCategory: true,
    address: true,
    city: true,
    state: true,
    country: true,
    postalCode: true,
    location: true,
    timeZone: true,
    contactDetails: true,
    amenities: true,
    checkInTime: true,
    checkOutTime: true,
    instantConfirmation: true,
    nearbyAttractions: true,
  })
  .extend({
    languages: z.string().max(300),
  });
type DetailsValues = z.input<typeof detailsSchema>;

function toDetails(c?: HotelContentDto): DetailsValues {
  return {
    name: c?.name ?? '',
    shortDescription: c?.shortDescription ?? '',
    description: c?.description ?? '',
    propertyType: c?.propertyType ?? 'HOTEL',
    starCategory: c?.starCategory ?? 3,
    address: { line1: c?.address.line1 ?? '', line2: c?.address.line2 ?? '' },
    city: c?.city ?? '',
    state: c?.state ?? '',
    country: c?.country ?? 'IN',
    postalCode: c?.postalCode ?? '',
    location: c?.location ?? { lat: 20.5937, lng: 78.9629 },
    timeZone: c?.timeZone ?? 'Asia/Kolkata',
    contactDetails: {
      phone: c?.contactDetails.phone ?? '',
      email: c?.contactDetails.email ?? '',
      website: c?.contactDetails.website ?? '',
    },
    amenities: c?.amenities ?? [],
    checkInTime: c?.checkInTime ?? '14:00',
    checkOutTime: c?.checkOutTime ?? '11:00',
    instantConfirmation: c?.instantConfirmation ?? true,
    nearbyAttractions: c?.nearbyAttractions ?? [],
    languages: (c?.languagesSpoken ?? ['English']).join(', '),
  };
}

export function PropertyFormPage({ mode }: { mode: 'create' | 'edit' }) {
  const ctx = useOutletContext<PropertyContext | undefined>();
  const hotel = mode === 'edit' ? ctx?.hotel : undefined;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const amenities = useAmenities();
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, control, setError, watch, setValue, formState } =
    useForm<DetailsValues>({
      resolver: zodResolver(detailsSchema),
      values: toDetails(hotel?.working),
    });
  const attractions = useFieldArray({ control, name: 'nearbyAttractions' });
  const e = formState.errors;
  const location = watch('location');
  const locked =
    hotel && ['SUBMITTED', 'UNDER_REVIEW', 'ARCHIVED'].includes(hotel.publicationStatus);

  const onSubmit = handleSubmit(async ({ languages, ...values }) => {
    setFormError(null);
    const body = {
      ...values,
      languagesSpoken: languages
        .split(',')
        .map((l) => l.trim())
        .filter(Boolean),
    };
    try {
      if (hotel) {
        const updated = await partnerApi.updateHotel(hotel.id, body);
        qc.setQueryData(partnerKeys.hotel(hotel.id), updated);
        toast({
          title: hotel.everApproved ? 'Changes saved as a draft revision' : 'Details saved',
          description: hotel.everApproved
            ? 'Submit them for review from the overview tab.'
            : undefined,
          variant: 'success',
        });
      } else {
        const created = await partnerApi.createHotel(body);
        void qc.invalidateQueries({ queryKey: partnerKeys.hotels });
        toast({
          title: tr('Property created'),
          description: tr('Add photos, rooms and rates next.'),
          variant: 'success',
        });
        navigate(`/partner/properties/${created.id}/media`);
      }
    } catch (error) {
      setFormError(
        applyServerErrors(error, setError, [
          'name',
          'description',
          'shortDescription',
          'city',
          'state',
          'postalCode',
          'country',
        ]),
      );
    }
  });

  const form = (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      {formError && <Alert tone="danger">{formError}</Alert>}
      {locked && (
        <Alert tone="info">
          {tr('This listing is')} {statusLabel(hotel.publicationStatus)}{' '}
          {tr("and can't be edited right now.")}
        </Alert>
      )}
      {hotel?.everApproved && (
        <Alert tone="info">
          {tr(
            'This listing has been approved. Your edits are saved as a revision and go live only after review.',
          )}
        </Alert>
      )}
      <fieldset disabled={locked} className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle as="h2">{tr('Basics')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <Input
              label={tr('Property name')}
              required
              containerClassName="sm:col-span-2"
              error={e.name?.message}
              {...register('name')}
            />
            <Select
              label={tr('Property type')}
              options={PROPERTY_TYPES.map((t) => ({
                value: t,
                label: tr(PROPERTY_TYPE_LABELS[t]),
              }))}
              {...register('propertyType')}
            />
            <Select
              label={tr('Star category')}
              options={[0, 1, 2, 3, 4, 5].map((n) => ({
                value: String(n),
                label: n === 0 ? 'Unrated' : `${n} star`,
              }))}
              {...register('starCategory', { valueAsNumber: true })}
            />
            <Input
              label={tr('Short description')}
              required
              containerClassName="sm:col-span-2"
              hint={tr('Shown on search results (max 240 characters)')}
              error={e.shortDescription?.message}
              {...register('shortDescription')}
            />
            <Textarea
              label={tr('Full description')}
              required
              className="min-h-40"
              error={e.description?.message}
              {...register('description')}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle as="h2">{tr('Location')}</CardTitle>
            <CardDescription>
              {tr('Click the map to place the pin precisely, or enter coordinates.')}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <Input
              label={tr('Address line 1')}
              required
              containerClassName="sm:col-span-2"
              error={e.address?.line1?.message}
              {...register('address.line1')}
            />
            <Input
              label={tr('Address line 2')}
              optionalLabel
              containerClassName="sm:col-span-2"
              {...register('address.line2')}
            />
            <Input label={tr('City')} required error={e.city?.message} {...register('city')} />
            <Input label={tr('State')} required error={e.state?.message} {...register('state')} />
            <Input
              label={tr('Postal code')}
              required
              error={e.postalCode?.message}
              {...register('postalCode')}
            />
            <Input
              label={tr('Country code')}
              required
              error={e.country?.message}
              {...register('country')}
            />
            <Input
              label={tr('Latitude')}
              type="number"
              step="any"
              required
              error={e.location?.lat?.message}
              {...register('location.lat', { valueAsNumber: true })}
            />
            <Input
              label={tr('Longitude')}
              type="number"
              step="any"
              required
              error={e.location?.lng?.message}
              {...register('location.lng', { valueAsNumber: true })}
            />
            <MapView
              label={tr('Choose the property location')}
              className="h-72 sm:col-span-2"
              markers={
                Number.isFinite(location?.lat) && Number.isFinite(location?.lng)
                  ? [
                      {
                        id: 'pin',
                        lat: location.lat,
                        lng: location.lng,
                        label: '●',
                        title: tr('Property'),
                      },
                    ]
                  : []
              }
              center={location}
              zoom={hotel ? 14 : 4}
              onMapClick={(p) => {
                setValue('location.lat', p.lat, { shouldDirty: true, shouldValidate: true });
                setValue('location.lng', p.lng, { shouldDirty: true, shouldValidate: true });
              }}
            />
            <Input
              label={tr('Time zone')}
              hint={tr('IANA name, used for check-in dates and booking windows')}
              error={e.timeZone?.message}
              {...register('timeZone')}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle as="h2">{tr('Contact & arrival')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <Input
              label={tr('Reservations phone')}
              type="tel"
              required
              error={e.contactDetails?.phone?.message}
              {...register('contactDetails.phone')}
            />
            <Input
              label={tr('Reservations email')}
              type="email"
              required
              error={e.contactDetails?.email?.message}
              {...register('contactDetails.email')}
            />
            <Input
              label={tr('Website')}
              optionalLabel
              containerClassName="sm:col-span-2"
              error={e.contactDetails?.website?.message}
              {...register('contactDetails.website')}
            />
            <Input
              label={tr('Check-in from')}
              type="time"
              error={e.checkInTime?.message}
              {...register('checkInTime')}
            />
            <Input
              label={tr('Check-out until')}
              type="time"
              error={e.checkOutTime?.message}
              {...register('checkOutTime')}
            />
            <Input
              label={tr('Languages spoken')}
              hint={tr('Comma separated')}
              containerClassName="sm:col-span-2"
              {...register('languages')}
            />
            <Controller
              control={control}
              name="instantConfirmation"
              render={({ field }) => (
                <Checkbox
                  label={tr('Instant confirmation')}
                  description={tr('Bookings are confirmed without manual approval.')}
                  checked={Boolean(field.value)}
                  onChange={(ev) => field.onChange(ev.target.checked)}
                />
              )}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle as="h2">{tr('Amenities')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Controller
              control={control}
              name="amenities"
              render={({ field }) => (
                <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <legend className="sr-only">{tr('Amenities')}</legend>
                  {(amenities.data ?? []).map((a) => (
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
        <Card>
          <CardHeader>
            <CardTitle as="h2">{tr('Nearby attractions')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {attractions.fields.map((f, i) => (
              <div key={f.id} className="grid items-end gap-3 sm:grid-cols-[1fr_8rem_10rem_auto]">
                <Input
                  label={tr('Name')}
                  {...register(`nearbyAttractions.${i}.name`)}
                  error={e.nearbyAttractions?.[i]?.name?.message}
                />
                <Input
                  label={tr('Distance (km)')}
                  type="number"
                  step="0.1"
                  {...register(`nearbyAttractions.${i}.distanceKm`, { valueAsNumber: true })}
                />
                <Input label={tr('Category')} {...register(`nearbyAttractions.${i}.category`)} />
                <Button
                  variant="ghost"
                  onClick={() => attractions.remove(i)}
                  aria-label={trf('Remove attraction {0}', [i + 1])}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              leftIcon={<Plus className="size-4" aria-hidden="true" />}
              onClick={() => attractions.append({ name: '', distanceKm: 1, category: 'Sight' })}
              disabled={attractions.fields.length >= 15}
            >
              {tr('Add attraction')}
            </Button>
          </CardContent>
        </Card>
      </fieldset>
      <div className="flex justify-end gap-2">
        <Button type="submit" loading={formState.isSubmitting} disabled={locked}>
          {mode === 'create' ? tr('Create property') : tr('Save details')}
        </Button>
      </div>
    </form>
  );
  if (mode === 'create')
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          breadcrumb={[
            { label: tr('Properties'), to: '/partner/properties' },
            { label: tr('New') },
          ]}
          title={tr('Add a property')}
          description={tr(
            'Start with the essentials — you can save and come back. Nothing is public until approved and published.',
          )}
        />
        {form}
      </div>
    );
  return form;
}

/* ---------------------------------------------------------------- media */
export function PropertyMediaPage() {
  const { hotel } = usePropertyContext();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [images, setImages] = useState(hotel.working.images);
  const [cover, setCover] = useState<string | null>(hotel.working.coverImageId);
  const [videos, setVideos] = useState(hotel.working.videos);
  const [videoUrl, setVideoUrl] = useState('');
  const [uploading, setUploading] = useState(0);
  const [library, setLibrary] = useState(() => new Map(hotel.images.map((i) => [i.id, i])));
  useEffect(() => {
    setImages(hotel.working.images);
    setCover(hotel.working.coverImageId);
    setVideos(hotel.working.videos);
    setLibrary((prev) => new Map([...prev, ...hotel.images.map((i) => [i.id, i] as const)]));
  }, [hotel]);
  const save = useHotelMutation(hotel.id, () =>
    partnerApi.updateHotel(hotel.id, {
      images,
      coverImageId:
        cover && images.some((i) => i.mediaId === cover) ? cover : (images[0]?.mediaId ?? null),
      videos,
    }),
  );
  const move = (i: number, d: number) =>
    setImages((list) => {
      const next = [...list];
      const [item] = next.splice(i, 1);
      next.splice(i + d, 0, item!);
      return next;
    });

  const onFiles = async (files: FileList | null) => {
    for (const file of Array.from(files ?? [])) {
      if (file.size > IMAGE_MAX_BYTES) {
        toast({
          title: trf('{0} is too large', [file.name]),
          description: tr('Images must be 10 MB or smaller.'),
          variant: 'error',
        });
        continue;
      }
      setUploading((n) => n + 1);
      try {
        const image = await partnerApi.uploadImage(hotel.id, file);
        setLibrary((prev) => new Map(prev).set(image.id, image));
        setImages((list) => [...list, { mediaId: image.id, alt: '' }]);
      } catch (error) {
        toast({
          title: trf('Could not upload {0}', [file.name]),
          description: errorMessage(error),
          variant: 'error',
        });
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle as="h2">{tr('Photos')}</CardTitle>
          <CardDescription>
            {tr(
              'JPEG, PNG, WebP or AVIF, at least 400 × 300 px, up to 10 MB. We create optimised WebP/AVIF versions and remove location metadata. The first photo is used if no cover is chosen.',
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-border-strong p-8 text-center hover:bg-surface-muted">
            <ImagePlus className="size-7 text-fg-subtle" aria-hidden="true" />
            <span className="text-sm font-medium">
              {uploading ? trf('Uploading {0}…', [uploading]) : tr('Choose photos to upload')}
            </span>
            <input
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,image/avif"
              className="sr-only"
              onChange={(ev) => {
                void onFiles(ev.target.files);
                ev.target.value = '';
              }}
            />
          </label>
          {images.length === 0 ? (
            <p className="text-sm text-fg-muted">{tr('No photos in the listing yet.')}</p>
          ) : (
            <ol
              className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
              aria-label={tr('Listing photos in display order')}
            >
              {images.map((img, i) => {
                const asset = library.get(img.mediaId);
                return (
                  <li
                    key={img.mediaId}
                    className={cn(
                      'flex flex-col gap-2 rounded-xl border p-2',
                      cover === img.mediaId ? 'border-primary' : 'border-border',
                    )}
                  >
                    <ResponsiveImage
                      image={asset ?? null}
                      sizes="20rem"
                      className="aspect-[4/3] w-full rounded-lg"
                    />
                    <Input
                      label={trf('Alt text for photo {0}', [i + 1])}
                      hideLabel
                      placeholder={tr('Describe the photo')}
                      value={img.alt}
                      onChange={(ev) =>
                        setImages((list) =>
                          list.map((x, j) => (j === i ? { ...x, alt: ev.target.value } : x)),
                        )
                      }
                    />
                    <div className="flex flex-wrap gap-1">
                      <Button
                        size="sm"
                        variant={cover === img.mediaId ? 'primary' : 'ghost'}
                        leftIcon={<Star className="size-3.5" aria-hidden="true" />}
                        onClick={() => setCover(img.mediaId)}
                        aria-pressed={cover === img.mediaId}
                      >
                        {tr('Cover')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                        aria-label={trf('Move photo {0} earlier', [i + 1])}
                      >
                        <ArrowUp className="size-3.5" aria-hidden="true" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={i === images.length - 1}
                        onClick={() => move(i, 1)}
                        aria-label={trf('Move photo {0} later', [i + 1])}
                      >
                        <ArrowDown className="size-3.5" aria-hidden="true" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setImages((list) => list.filter((_, j) => j !== i))}
                        aria-label={trf('Remove photo {0} from listing', [i + 1])}
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle as="h2">{tr('Videos')}</CardTitle>
          <CardDescription>{tr('YouTube or Vimeo links.')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {videos.map((v, i) => (
            <div key={v.url} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">{v.title || v.url}</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setVideos((list) => list.filter((_, j) => j !== i))}
              >
                {tr('Remove')}
              </Button>
            </div>
          ))}
          <div className="flex items-end gap-2">
            <Input
              label={tr('Video URL')}
              containerClassName="flex-1"
              value={videoUrl}
              onChange={(ev) => setVideoUrl(ev.target.value)}
              placeholder="https://www.youtube.com/watch?v=…"
            />
            <Button
              variant="outline"
              onClick={() => {
                const parsed = hotelVideoSchema.safeParse({ url: videoUrl });
                if (!parsed.success)
                  return toast({
                    title: tr('Invalid video link'),
                    description: parsed.error.issues[0]?.message,
                    variant: 'error',
                  });
                setVideos((list) => [...list, { url: parsed.data.url, title: '' }]);
                setVideoUrl('');
              }}
            >
              {tr('Add')}
            </Button>
          </div>
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <Button
          loading={save.isPending}
          disabled={uploading > 0}
          onClick={() =>
            save.mutate(undefined, {
              onSuccess: () => {
                toast({
                  title: hotel.everApproved
                    ? 'Photo changes saved as a draft revision'
                    : 'Photos saved',
                  variant: 'success',
                });
                void qc.invalidateQueries({ queryKey: partnerKeys.hotels });
              },
              onError: (err) =>
                toast({
                  title: tr('Could not save'),
                  description: errorMessage(err),
                  variant: 'error',
                }),
            })
          }
        >
          {tr('Save photos & videos')}
        </Button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- policies & fees */
const policiesForm = z.object({
  policies: hotelPoliciesSchema,
  rules: z.string().max(3000),
  fees: z.array(
    z.object({
      label: z.string().trim().min(1, 'Label required').max(60),
      amount: z.string().regex(/^\d{1,7}(\.\d{1,2})?$/, 'Enter an amount like 250 or 99.50'),
      chargeBasis: z.enum(['PER_STAY', 'PER_NIGHT', 'PER_ROOM_NIGHT']),
    }),
  ),
});
type PoliciesValues = z.input<typeof policiesForm>;

export function PropertyPoliciesPage() {
  const { hotel } = usePropertyContext();
  const { toast } = useToast();
  const p = hotel.working.policies;
  const { register, handleSubmit, control, formState } = useForm<PoliciesValues>({
    resolver: zodResolver(policiesForm),
    values: {
      policies: { ...p },
      rules: p.additionalRules.join('\n'),
      fees: hotel.working.taxConfig.fees.map((f) => ({
        label: f.label,
        amount: (f.amountMinor / 100).toFixed(2),
        chargeBasis: f.chargeBasis,
      })),
    },
  });
  const fees = useFieldArray({ control, name: 'fees' });
  const save = useHotelMutation(hotel.id, (values: PoliciesValues) =>
    partnerApi.updateHotel(hotel.id, {
      policies: {
        ...values.policies,
        additionalRules: values.rules
          .split('\n')
          .map((r) => r.trim())
          .filter(Boolean),
      },
      taxConfig: {
        taxes: hotel.working.taxConfig.taxes,
        fees: values.fees.map((f, i) => {
          const [whole = '0', frac = ''] = f.amount.split('.');
          return {
            code: `FEE_${i + 1}`,
            label: f.label,
            amountMinor: Number(whole) * 100 + Number(frac.padEnd(2, '0')),
            chargeBasis: f.chargeBasis,
          };
        }),
      },
    }),
  );
  const e = formState.errors;
  return (
    <form
      noValidate
      onSubmit={handleSubmit((v) =>
        save.mutate(v, {
          onSuccess: () => toast({ title: tr('Policies saved'), variant: 'success' }),
          onError: (err) =>
            toast({
              title: tr('Could not save'),
              description: errorMessage(err),
              variant: 'error',
            }),
        }),
      )}
      className="flex flex-col gap-6"
    >
      <Card>
        <CardHeader>
          <CardTitle as="h2">{tr('House policies')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <Controller
            control={control}
            name="policies.petsAllowed"
            render={({ field }) => (
              <Checkbox
                label={tr('Pets allowed')}
                checked={Boolean(field.value)}
                onChange={(ev) => field.onChange(ev.target.checked)}
              />
            )}
          />
          <Controller
            control={control}
            name="policies.smokingAllowed"
            render={({ field }) => (
              <Checkbox
                label={tr('Smoking allowed (designated areas)')}
                checked={Boolean(field.value)}
                onChange={(ev) => field.onChange(ev.target.checked)}
              />
            )}
          />
          <Controller
            control={control}
            name="policies.coupleFriendly"
            render={({ field }) => (
              <Checkbox
                label={tr('Couple friendly')}
                checked={Boolean(field.value)}
                onChange={(ev) => field.onChange(ev.target.checked)}
              />
            )}
          />
          <Input
            label={tr('Minimum check-in age')}
            type="number"
            error={e.policies?.minimumCheckInAge?.message}
            {...register('policies.minimumCheckInAge', { valueAsNumber: true })}
          />
          <Textarea
            label={tr('Cancellation summary')}
            {...register('policies.cancellationSummary')}
          />
          <Textarea label={tr('Child policy')} {...register('policies.childPolicy')} />
          <Textarea label={tr('Pet policy')} {...register('policies.petPolicy')} />
          <Textarea label={tr('Extra bed policy')} {...register('policies.extraBedPolicy')} />
          <Input
            label={tr('ID requirement')}
            containerClassName="sm:col-span-2"
            {...register('policies.idRequirement')}
          />
          <Textarea label={tr('House rules (one per line)')} {...register('rules')} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle as="h2">{tr('Taxes & fees')}</CardTitle>
          <CardDescription>
            {tr('Taxes:')}{' '}
            {hotel.working.taxConfig.taxes
              .map(
                (t) =>
                  `${t.label} (${t.slabs.map((s) => `${s.basisPoints / 100}%${s.upToMinor !== null ? ` up to ₹${s.upToMinor / 100} per room-night` : ' above'}`).join(', ')})`,
              )
              .join('; ')}
            {tr('. Fees below are added to every quote and are shown to guests before payment.')}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {fees.fields.map((f, i) => (
            <div key={f.id} className="grid items-end gap-3 sm:grid-cols-[1fr_9rem_12rem_auto]">
              <Input
                label={tr('Fee label')}
                error={e.fees?.[i]?.label?.message}
                {...register(`fees.${i}.label`)}
              />
              <Input
                label={tr('Amount (₹)')}
                inputMode="decimal"
                error={e.fees?.[i]?.amount?.message}
                {...register(`fees.${i}.amount`)}
              />
              <Select
                label={tr('Charged')}
                options={[
                  { value: 'PER_STAY', label: tr('Per stay') },
                  { value: 'PER_NIGHT', label: tr('Per night') },
                  { value: 'PER_ROOM_NIGHT', label: tr('Per room per night') },
                ]}
                {...register(`fees.${i}.chargeBasis`)}
              />
              <Button
                variant="ghost"
                onClick={() => fees.remove(i)}
                aria-label={trf('Remove fee {0}', [i + 1])}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            leftIcon={<Plus className="size-4" aria-hidden="true" />}
            onClick={() => fees.append({ label: '', amount: '0', chargeBasis: 'PER_STAY' })}
          >
            {tr('Add fee')}
          </Button>
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <Button type="submit" loading={save.isPending}>
          {tr('Save policies')}
        </Button>
      </div>
    </form>
  );
}
