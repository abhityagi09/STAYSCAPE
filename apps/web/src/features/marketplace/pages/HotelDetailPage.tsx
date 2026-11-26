import { useEffect, useMemo, useState } from 'react';
import { useDocumentTitle } from '@/lib/use-document-title';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  ArrowLeft,
  BedDouble,
  Check,
  Clock,
  MapPin,
  Ruler,
  ShieldCheck,
  Users,
} from 'lucide-react';
import {
  MEAL_PLAN_LABELS,
  PROPERTY_TYPE_LABELS,
  addDays,
  diffDays,
  type HotelDetailDto,
  type QuoteDto,
  type RoomOfferDto,
} from '@stayscape/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DatePicker,
  EmptyState,
  ErrorState,
  PageSpinner,
  Select,
  SkeletonText,
  todayIsoDate,
} from '@/components/ui';
import { MapView } from '@/components/map/MapView';
import { errorMessage, normalizeApiError } from '@/lib/api/errors';
import { cn } from '@/lib/cn';
import { useHotelDetail, useRoomOffers, useSimilar, type StayParams } from '../api';
import { PhotoGrid, Lightbox } from '../components/Gallery';
import { HotelCard, RatingBadge, ResponsiveImage } from '../components/HotelCard';
import { PriceBreakdown } from '../components/PriceBreakdown';
import { HotelReviews } from '@/features/bookings/HotelReviews';
import { ApproxPrice, HotelInsights } from '@/features/ops/HotelInsights';
import { parseSearch, toSearchParams } from '../search-state';
import { tr, trf } from '@/lib/tr';

export const SELECTION_STORAGE_KEY = 'stayscape.selection';
export const LAST_SEARCH_KEY = 'stayscape.lastSearch';

const cancellationText = (q: QuoteDto) =>
  q.ratePlan.cancellationPolicy.type === 'FREE_CANCELLATION'
    ? `Free cancellation until ${q.ratePlan.cancellationPolicy.freeCancellationHours} h before check-in`
    : q.ratePlan.cancellationPolicy.type === 'PARTIALLY_REFUNDABLE'
      ? 'Partially refundable'
      : 'Non-refundable';

function AvailabilityForm({
  stay,
  onChange,
}: {
  stay: StayParams | null;
  onChange: (stay: StayParams) => void;
}) {
  const today = todayIsoDate();
  const [checkIn, setCheckIn] = useState(stay?.checkIn ?? addDays(today, 7));
  const [checkOut, setCheckOut] = useState(stay?.checkOut ?? addDays(today, 9));
  const [adults, setAdults] = useState(stay?.adults ?? 2);
  const [rooms, setRooms] = useState(stay?.rooms ?? 1);
  const [childrenAges, setChildrenAges] = useState<number[]>(stay?.childrenAges ?? []);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      noValidate
      aria-label={tr('Check availability')}
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_0.7fr_0.7fr_0.7fr_auto] lg:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        if (checkIn < today) return setError('Check-in cannot be in the past.');
        if (diffDays(checkIn, checkOut) < 1) return setError('Check-out must be after check-in.');
        if (rooms > adults) return setError('Each room needs at least one adult.');
        setError(null);
        onChange({ checkIn, checkOut, adults, rooms, children: childrenAges.length, childrenAges });
      }}
    >
      <DatePicker
        label={tr('Check-in')}
        min={today}
        value={checkIn}
        onChange={(e) => {
          setCheckIn(e.target.value);
          if (checkOut <= e.target.value) setCheckOut(addDays(e.target.value, 1));
        }}
      />
      <DatePicker
        label={tr('Check-out')}
        min={addDays(checkIn, 1)}
        value={checkOut}
        onChange={(e) => setCheckOut(e.target.value)}
      />
      <Select
        label={tr('Adults')}
        value={String(adults)}
        onChange={(e) => setAdults(Number(e.target.value))}
        options={Array.from({ length: 12 }, (_, i) => ({
          value: String(i + 1),
          label: String(i + 1),
        }))}
      />
      <Select
        label={tr('Children')}
        value={String(childrenAges.length)}
        onChange={(e) =>
          setChildrenAges(
            Array.from({ length: Number(e.target.value) }, (_, i) => childrenAges[i] ?? 8),
          )
        }
        options={Array.from({ length: 7 }, (_, i) => ({ value: String(i), label: String(i) }))}
      />
      <Select
        label={tr('Rooms')}
        value={String(rooms)}
        onChange={(e) => setRooms(Number(e.target.value))}
        options={Array.from({ length: 8 }, (_, i) => ({
          value: String(i + 1),
          label: String(i + 1),
        }))}
      />
      <Button type="submit">{tr('Check availability')}</Button>
      {childrenAges.length > 0 && (
        <div className="flex flex-wrap gap-3 sm:col-span-2 lg:col-span-6">
          {childrenAges.map((age, i) => (
            <Select
              key={i}
              label={trf('Child {0} age', [i + 1])}
              value={String(age)}
              onChange={(e) =>
                setChildrenAges(childrenAges.map((a, j) => (j === i ? Number(e.target.value) : a)))
              }
              options={Array.from({ length: 18 }, (_, a) => ({
                value: String(a),
                label: a === 0 ? 'Under 1' : String(a),
              }))}
              containerClassName="w-32"
            />
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm font-medium text-danger sm:col-span-2 lg:col-span-6">
          {error}
        </p>
      )}
    </form>
  );
}

function RoomOfferCard({
  offer,
  selected,
  onSelect,
}: {
  offer: RoomOfferDto;
  selected: QuoteDto | null;
  onSelect: (q: QuoteDto) => void;
}) {
  const [gallery, setGallery] = useState<number | null>(null);
  const room = offer.roomType;
  return (
    <Card className="overflow-hidden">
      <div className="grid md:grid-cols-[16rem_minmax(0,1fr)]">
        <button
          type="button"
          className="relative aspect-[4/3] bg-surface-muted md:aspect-auto"
          onClick={() => room.images.length && setGallery(0)}
          aria-label={trf('View photos of {0}', [room.name])}
          disabled={!room.images.length}
        >
          <ResponsiveImage
            image={room.images[0] ?? null}
            sizes="(min-width: 768px) 16rem, 100vw"
            className="size-full"
          />
        </button>
        <div className="flex flex-col gap-4 p-5">
          <div>
            <h3 className="font-display text-xl font-semibold">{room.name}</h3>
            <p className="mt-1 text-sm text-fg-muted">{room.description}</p>
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
              <li className="flex items-center gap-1">
                <Ruler className="size-3.5" aria-hidden="true" />
                {room.roomSize} {room.roomSizeUnit === 'SQM' ? 'm²' : tr('sq ft')}
              </li>
              <li className="flex items-center gap-1">
                <BedDouble className="size-3.5" aria-hidden="true" />
                {room.bedConfiguration
                  .map((b) => `${b.count} ${b.type.toLowerCase().replace('_', ' ')}`)
                  .join(', ')}
              </li>
              <li className="flex items-center gap-1">
                <Users className="size-3.5" aria-hidden="true" />
                {tr('Sleeps')} {room.maximumOccupancy} {tr('(max')} {room.maximumAdults}{' '}
                {tr('adults)')}
              </li>
            </ul>
          </div>
          {offer.offers.length === 0 ? (
            <Alert tone="warning">
              {offer.unavailableReason ?? tr('Not available for these dates.')}
            </Alert>
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
              {offer.offers.map((q) => {
                const isSelected =
                  selected?.ratePlan.id === q.ratePlan.id && selected.roomType.id === q.roomType.id;
                return (
                  <li
                    key={q.ratePlan.id}
                    className={cn(
                      'flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between',
                      isSelected && 'bg-primary-soft',
                    )}
                  >
                    <div className="text-sm">
                      <p className="font-medium">{q.ratePlan.name}</p>
                      <p className="text-fg-muted">{tr(MEAL_PLAN_LABELS[q.ratePlan.mealPlan])}</p>
                      <p
                        className={
                          q.ratePlan.cancellationPolicy.type === 'FREE_CANCELLATION'
                            ? 'text-success'
                            : 'text-fg-subtle'
                        }
                      >
                        {cancellationText(q)}
                      </p>
                      {q.roomsLeft <= 3 && (
                        <p className="text-warning">
                          {tr('Only')} {q.roomsLeft} {tr('left')}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-4 sm:flex-col sm:items-end sm:gap-1">
                      <span className="text-lg font-semibold tabular-nums">
                        {new Intl.NumberFormat('en-IN', {
                          style: 'currency',
                          currency: q.currency,
                        }).format(q.totals.totalMinor / 100)}
                      </span>
                      <span className="text-xs text-fg-subtle">
                        {q.nights} {tr('night')}
                        {q.nights === 1 ? '' : 's'}
                        {tr(', incl. taxes')}
                      </span>
                      <ApproxPrice amountMinor={q.totals.totalMinor} currency={q.currency} />
                      <Button
                        size="sm"
                        variant={isSelected ? 'primary' : 'outline'}
                        onClick={() => onSelect(q)}
                        aria-pressed={isSelected}
                      >
                        {isSelected ? tr('Selected') : tr('Select')}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
      {gallery !== null && (
        <Lightbox
          images={room.images}
          index={gallery}
          onIndex={setGallery}
          onClose={() => setGallery(null)}
          title={room.name}
        />
      )}
    </Card>
  );
}

function Overview({ hotel }: { hotel: HotelDetailDto }) {
  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="about">
        <h2 id="about" className="font-display text-2xl font-semibold">
          {tr('About this stay')}
        </h2>
        <p className="mt-3 leading-relaxed whitespace-pre-line text-fg-muted">
          {hotel.description}
        </p>
        {hotel.amenityDetails.length > 0 && (
          <ul className="mt-5 flex flex-wrap gap-2" aria-label={tr('Highlights')}>
            {hotel.amenityDetails.slice(0, 6).map((a) => (
              <li key={a.code}>
                <Badge tone="primary" className="py-1 text-sm">
                  {a.name}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="amenities">
        <h2 id="amenities" className="font-display text-2xl font-semibold">
          {tr('Amenities')}
        </h2>
        <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {hotel.amenityDetails.map((a) => (
            <li key={a.code} className="flex items-center gap-2">
              <Check className="size-4 text-success" aria-hidden="true" />
              {a.name}
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="location" className="flex flex-col gap-4">
        <h2 id="location" className="font-display text-2xl font-semibold">
          {tr('Location')}
        </h2>
        <p className="flex items-center gap-1.5 text-sm text-fg-muted">
          <MapPin className="size-4" aria-hidden="true" />
          {hotel.address.line1}
          {hotel.address.line2 ? `, ${hotel.address.line2}` : ''}, {hotel.city}, {hotel.state}{' '}
          {hotel.postalCode}
        </p>
        <MapView
          label={trf('Map showing {0}', [hotel.name])}
          className="h-72"
          markers={[
            {
              id: hotel.id,
              lat: hotel.location.lat,
              lng: hotel.location.lng,
              label: '●',
              title: hotel.name,
            },
          ]}
          center={hotel.location}
          zoom={14}
        />
        {hotel.nearbyAttractions.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold">{tr('Nearby')}</h3>
            <ul className="mt-2 grid gap-1.5 text-sm text-fg-muted sm:grid-cols-2">
              {hotel.nearbyAttractions.map((a) => (
                <li key={a.name}>
                  {a.name} · {a.distanceKm} {tr('km')}{' '}
                  <span className="text-fg-subtle">({a.category})</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
      <section aria-labelledby="policies">
        <h2 id="policies" className="font-display text-2xl font-semibold">
          {tr('House policies')}
        </h2>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
          <div className="flex gap-2">
            <Clock className="mt-0.5 size-4 text-fg-subtle" aria-hidden="true" />
            <div>
              <dt className="font-medium">{tr('Check-in / check-out')}</dt>
              <dd className="text-fg-muted">
                {tr('From')} {hotel.checkInTime} {tr('· Until')} {hotel.checkOutTime}{' '}
                {tr('(property local time)')}
              </dd>
            </div>
          </div>
          <div className="flex gap-2">
            <ShieldCheck className="mt-0.5 size-4 text-fg-subtle" aria-hidden="true" />
            <div>
              <dt className="font-medium">{tr('Guests')}</dt>
              <dd className="text-fg-muted">
                {tr('Minimum check-in age')} {hotel.policies.minimumCheckInAge}.{' '}
                {hotel.policies.petsAllowed ? tr('Pets welcome.') : tr('No pets.')}{' '}
                {hotel.policies.smokingAllowed
                  ? tr('Smoking allowed in designated areas.')
                  : tr('Non-smoking.')}
              </dd>
            </div>
          </div>
          {hotel.policies.cancellationSummary && (
            <div>
              <dt className="font-medium">{tr('Cancellation')}</dt>
              <dd className="text-fg-muted">{hotel.policies.cancellationSummary}</dd>
            </div>
          )}
          {hotel.policies.childPolicy && (
            <div>
              <dt className="font-medium">{tr('Children')}</dt>
              <dd className="text-fg-muted">{hotel.policies.childPolicy}</dd>
            </div>
          )}
          {hotel.policies.additionalRules.length > 0 && (
            <div className="sm:col-span-2">
              <dt className="font-medium">{tr('House rules')}</dt>
              <dd>
                <ul className="mt-1 list-disc pl-5 text-fg-muted">
                  {hotel.policies.additionalRules.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </dd>
            </div>
          )}
        </dl>
      </section>
      <HotelInsights hotel={hotel} />
      <section aria-labelledby="reviews">
        <h2 id="reviews" className="font-display text-2xl font-semibold">
          {tr('Guest reviews')}
        </h2>
        <div className="mt-3 flex flex-col gap-2 text-sm">
          <RatingBadge rating={hotel.ratingSummary} />
          <p className="text-fg-muted">
            {hotel.ratingSummary.source === 'DEVELOPMENT_SEED'
              ? tr('This rating is sample development data, not verified guest feedback.')
              : hotel.ratingSummary.count === 0
                ? tr('No verified reviews yet. Reviews open to guests after completed stays.')
                : tr('Ratings come from verified guests after completed stays.')}
          </p>
        </div>
        <HotelReviews slug={hotel.slug} />
      </section>
    </div>
  );
}

export default function HotelDetailPage() {
  const { slug = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const detail = useHotelDetail(slug);
  useDocumentTitle(detail.data ? `${detail.data.name}, ${detail.data.city}` : null);
  const similar = useSimilar(slug);
  const search = useMemo(() => parseSearch(params), [params]);
  const stay = useMemo<StayParams | null>(
    () =>
      search.checkIn
        ? {
            checkIn: search.checkIn,
            checkOut: search.checkOut,
            adults: search.adults,
            children: search.children,
            childrenAges: search.childrenAges,
            rooms: search.rooms,
          }
        : null,
    [search],
  );
  const offers = useRoomOffers(slug, stay);
  const [selected, setSelected] = useState<QuoteDto | null>(null);
  useEffect(() => setSelected(null), [stay]);
  const lastSearch =
    typeof window !== 'undefined'
      ? (() => {
          try {
            return sessionStorage.getItem(LAST_SEARCH_KEY);
          } catch {
            return null;
          }
        })()
      : null;

  if (detail.isPending) return <PageSpinner label={tr('Loading property')} />;
  if (detail.isError) {
    const err = normalizeApiError(detail.error);
    return (
      <div className="container-page py-16">
        {err.status === 404 ? (
          <EmptyState
            title={tr('This property is not available')}
            description={tr('It may have been unpublished or the link is incorrect.')}
            action={<Button onClick={() => navigate('/hotels')}>{tr('Browse stays')}</Button>}
          />
        ) : (
          <ErrorState
            description={err.message}
            requestId={err.requestId}
            onRetry={() => void detail.refetch()}
          />
        )}
      </div>
    );
  }
  const hotel = detail.data;

  const continueToBooking = () => {
    if (!selected) return;
    try {
      sessionStorage.setItem(
        SELECTION_STORAGE_KEY,
        JSON.stringify({ quote: selected, hotel: { slug: hotel.slug, name: hotel.name } }),
      );
    } catch {
      /* storage unavailable — the token is also passed in the URL */
    }
    navigate(`/checkout?quote=${encodeURIComponent(selected.quoteToken)}`);
  };

  return (
    <div className="container-page pt-6 pb-24">
      <Link
        to={
          lastSearch
            ? `/hotels${lastSearch}`
            : `/hotels?${toSearchParams({ ...search, destination: hotel.city }).toString()}`
        }
        className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg"
      >
        <ArrowLeft className="size-4" aria-hidden="true" /> {tr('Back to results')}
      </Link>
      <header className="mt-4 flex flex-col gap-2">
        <p className="text-sm text-fg-subtle">
          {tr(PROPERTY_TYPE_LABELS[hotel.propertyType])}
          {hotel.starCategory > 0 ? ` · ${'★'.repeat(hotel.starCategory)}` : ''}
        </p>
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          {hotel.name}
        </h1>
        <div className="flex flex-wrap items-center gap-3 text-sm text-fg-muted">
          <span className="flex items-center gap-1">
            <MapPin className="size-4" aria-hidden="true" />
            {hotel.city}, {hotel.state}
          </span>
          <RatingBadge rating={hotel.ratingSummary} />
        </div>
      </header>
      <div className="mt-6">
        <PhotoGrid images={hotel.images} title={hotel.name} />
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-12">
          <section aria-labelledby="rooms" className="flex flex-col gap-5">
            <h2 id="rooms" className="font-display text-2xl font-semibold">
              {tr('Rooms & availability')}
            </h2>
            <Card variant="muted" className="p-5">
              <AvailabilityForm
                stay={stay}
                onChange={(s) => setParams(toSearchParams({ ...search, ...s }), { replace: true })}
              />
            </Card>
            {!stay ? (
              <div className="flex flex-col gap-4">
                <p className="text-sm text-fg-muted">
                  {tr('Choose dates to see live availability and prices for each room.')}
                </p>
                {hotel.roomTypes.map((room) => (
                  <RoomOfferCard
                    key={room.id}
                    offer={{
                      roomType: room,
                      available: 0,
                      unavailableReason: 'Select dates to see prices.',
                      offers: [],
                    }}
                    selected={null}
                    onSelect={() => undefined}
                  />
                ))}
              </div>
            ) : offers.isPending ? (
              <SkeletonText lines={6} />
            ) : offers.isError ? (
              <ErrorState
                description={errorMessage(offers.error)}
                onRetry={() => void offers.refetch()}
              />
            ) : (
              <div className="flex flex-col gap-4">
                {offers.data.every((o) => o.offers.length === 0) && (
                  <Alert tone="warning" title={tr('No rooms available')}>
                    {tr(
                      'Nothing is available for every night of these dates. Try different dates.',
                    )}
                  </Alert>
                )}
                {offers.data.map((offer) => (
                  <RoomOfferCard
                    key={offer.roomType.id}
                    offer={offer}
                    selected={selected}
                    onSelect={setSelected}
                  />
                ))}
              </div>
            )}
          </section>
          <Overview hotel={hotel} />
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start" aria-label={tr('Booking summary')}>
          <Card>
            <CardHeader>
              <CardTitle as="h2">{tr('Your selection')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {selected ? (
                <>
                  <div className="text-sm">
                    <p className="font-medium">{selected.roomType.name}</p>
                    <p className="text-fg-muted">{selected.ratePlan.name}</p>
                    <p className="text-fg-subtle">
                      {selected.checkIn} → {selected.checkOut} ·{' '}
                      {selected.occupancy.adults + selected.occupancy.children} {tr('guests ·')}{' '}
                      {selected.rooms} {tr('room')}
                      {selected.rooms === 1 ? '' : 's'}
                    </p>
                  </div>
                  <PriceBreakdown quote={selected} />
                  <Button size="lg" fullWidth onClick={continueToBooking}>
                    {tr('Continue to booking')}
                  </Button>
                </>
              ) : (
                <p className="text-sm text-fg-muted">
                  {stay
                    ? tr('Select a room and rate to see the full price breakdown.')
                    : tr('Choose your dates to see prices.')}
                </p>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>

      {similar.data && similar.data.length > 0 && (
        <section aria-labelledby="similar" className="mt-20">
          <h2 id="similar" className="font-display text-2xl font-semibold">
            {tr('Similar stays')}
          </h2>
          <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {similar.data.map((h) => (
              <li key={h.id}>
                <HotelCard
                  hotel={h}
                  href={`/hotels/${h.slug}${params.toString() ? `?${params.toString()}` : ''}`}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
