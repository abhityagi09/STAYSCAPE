import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { CalendarClock, Check, GitCompareArrows, Heart, Minus, X } from 'lucide-react';
import {
  PROPERTY_TYPE_LABELS,
  formatMinorUnits,
  type QuoteDto,
  type QuoteRevalidationDto,
} from '@stayscape/shared';
import { useAppDispatch, useAppSelector } from '@/app/store';
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  PageHeader,
  PageSpinner,
  SkeletonText,
} from '@/components/ui';
import { errorMessage } from '@/lib/api/errors';
import { marketplaceApi, useCompare, useWishlist } from '../api';
import { clearCompare, removeCompare } from '../compare-slice';
import {
  HotelCard,
  HotelCardSkeleton,
  RatingBadge,
  ResponsiveImage,
} from '../components/HotelCard';
import { PriceBreakdown } from '../components/PriceBreakdown';
import { parseSearch } from '../search-state';
import { SELECTION_STORAGE_KEY } from './HotelDetailPage';
import { useQuery } from '@tanstack/react-query';

const yes = (v: boolean | null | undefined) =>
  v === null || v === undefined ? (
    <span className="text-fg-subtle">—</span>
  ) : v ? (
    <Check className="size-4 text-success" aria-label="Yes" />
  ) : (
    <Minus className="size-4 text-fg-subtle" aria-label="No" />
  );

export function ComparePage() {
  const items = useAppSelector((s) => s.compare.items);
  const dispatch = useAppDispatch();
  const [params] = useSearchParams();
  const search = parseSearch(params);
  const stay = search.checkIn
    ? {
        checkIn: search.checkIn,
        checkOut: search.checkOut,
        adults: search.adults,
        rooms: search.rooms,
      }
    : {};
  const ids = items.map((i) => i.id);
  const query = useCompare(ids, stay);

  if (items.length === 0) {
    return (
      <div className="container-page py-16">
        <EmptyState
          icon={<GitCompareArrows />}
          title="Nothing to compare yet"
          description="Use the Compare button on up to four stays in your search results."
          action={<ButtonLink to="/hotels">Browse stays</ButtonLink>}
        />
      </div>
    );
  }
  const hotels = query.data ?? [];
  const rows: Array<{ label: string; render: (h: (typeof hotels)[number]) => React.ReactNode }> = [
    { label: 'Property type', render: (h) => PROPERTY_TYPE_LABELS[h.propertyType] },
    { label: 'Location', render: (h) => `${h.city}, ${h.state}` },
    {
      label: 'Star category',
      render: (h) => (h.starCategory ? '★'.repeat(h.starCategory) : 'Unrated'),
    },
    { label: 'Guest rating', render: (h) => <RatingBadge rating={h.ratingSummary} /> },
    { label: 'Review count', render: (h) => h.ratingSummary.count },
    {
      label: search.checkIn ? `Price for ${search.checkIn} → ${search.checkOut}` : 'Price',
      render: (h) =>
        !search.checkIn ? (
          <span className="text-fg-subtle">Add dates</span>
        ) : h.price ? (
          <span className="font-semibold">
            {formatMinorUnits(h.price.totalMinor, h.price.currency)}
            <span className="block text-xs font-normal text-fg-subtle">
              incl. taxes · {h.price.roomTypeName}
            </span>
          </span>
        ) : (
          <span className="text-warning">Not available</span>
        ),
    },
    {
      label: 'Rooms available',
      render: (h) =>
        h.price
          ? `${h.price.roomsLeft} for these dates`
          : `${h.roomCategories} categories · ${h.totalRooms} rooms`,
    },
    { label: 'Breakfast', render: (h) => yes(h.breakfastAvailable) },
    { label: 'Parking', render: (h) => yes(h.parking) },
    { label: 'Pool', render: (h) => yes(h.pool) },
    { label: 'Free cancellation available', render: (h) => yes(h.freeCancellationAvailable) },
    { label: 'Check-in / out', render: (h) => `${h.checkInTime} / ${h.checkOutTime}` },
    { label: 'Pets', render: (h) => yes(h.policies.petsAllowed) },
    { label: 'Minimum check-in age', render: (h) => h.policies.minimumCheckInAge },
  ];

  return (
    <div className="container-page py-10">
      <PageHeader
        title="Compare stays"
        description={
          search.checkIn
            ? 'Prices are live quotes for your dates, including taxes.'
            : 'Add dates in your search to compare real prices.'
        }
        actions={
          <Button variant="outline" size="sm" onClick={() => dispatch(clearCompare())}>
            Clear all
          </Button>
        }
      />
      {query.isPending ? (
        <SkeletonText lines={8} />
      ) : query.isError ? (
        <ErrorState description={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        <div
          className="overflow-x-auto rounded-2xl border border-border bg-surface"
          role="region"
          aria-label="Comparison table"
          tabIndex={0}
        >
          <table className="w-full min-w-[720px] text-sm">
            <caption className="sr-only">Comparison of {hotels.length} stays</caption>
            <thead>
              <tr>
                <th
                  scope="col"
                  className="w-48 p-4 text-left align-bottom text-xs font-semibold tracking-wide text-fg-muted uppercase"
                >
                  Property
                </th>
                {hotels.map((h) => (
                  <th key={h.id} scope="col" className="p-4 text-left align-top font-normal">
                    <div className="flex flex-col gap-2">
                      <ResponsiveImage
                        image={h.coverImage}
                        sizes="240px"
                        className="aspect-[4/3] w-full rounded-lg"
                      />
                      <Link
                        to={`/hotels/${h.slug}?${params.toString()}`}
                        className="font-display text-base font-semibold hover:underline"
                      >
                        {h.name}
                      </Link>
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={<X className="size-3.5" aria-hidden="true" />}
                        onClick={() => dispatch(removeCompare(h.id))}
                      >
                        Remove
                      </Button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={row.label}>
                  <th scope="row" className="p-4 text-left font-medium text-fg-muted">
                    {row.label}
                  </th>
                  {hotels.map((h) => (
                    <td key={h.id} className="p-4">
                      {row.render(h)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {items.length > hotels.length && query.isSuccess && (
        <p className="mt-4 text-sm text-fg-subtle">
          Some saved comparisons are no longer available and were skipped.
        </p>
      )}
    </div>
  );
}

/** The booking workflow arrives in Phase 3. This page preserves the selection and re-validates the quote — it never takes payment. */
export function CheckoutPreviewPage() {
  const [params] = useSearchParams();
  const token = params.get('quote');
  const stored = useMemo(() => {
    try {
      return JSON.parse(sessionStorage.getItem(SELECTION_STORAGE_KEY) ?? 'null') as {
        quote: QuoteDto;
        hotel: { slug: string; name: string };
      } | null;
    } catch {
      return null;
    }
  }, []);
  const [result, setResult] = useState<QuoteRevalidationDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!token) return;
    marketplaceApi
      .revalidate(token)
      .then(setResult)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [token]);

  if (!token)
    return (
      <div className="container-page py-16">
        <EmptyState
          title="No stay selected"
          description="Choose a room and rate on a property page first."
          action={<ButtonLink to="/hotels">Find a stay</ButtonLink>}
        />
      </div>
    );
  if (!result && !error) return <PageSpinner label="Checking the latest price" />;
  const quote = result?.quote ?? stored?.quote ?? null;
  return (
    <div className="container-page max-w-3xl py-12">
      <PageHeader eyebrow="Booking" title="Review your stay" />
      <div className="flex flex-col gap-6">
        {error && <Alert tone="danger">{error}</Alert>}
        {result && !result.valid && (
          <Alert
            tone="warning"
            title={result.priceChanged ? 'The price has changed' : 'This selection needs updating'}
          >
            {result.reason} {result.priceChanged && 'The updated price is shown below.'}
          </Alert>
        )}
        {result?.valid && <Alert tone="success">Price and availability confirmed just now.</Alert>}
        <Alert tone="info" title="Online booking opens soon">
          Secure checkout and payment arrive with the next release. Your selection is saved in this
          browser session — nothing has been booked or charged.
        </Alert>
        {quote && (
          <Card>
            <CardHeader>
              <CardTitle as="h2">{quote.hotel.name}</CardTitle>
              <p className="text-sm text-fg-muted">
                {quote.roomType.name} · {quote.ratePlan.name}
              </p>
              <p className="flex items-center gap-1.5 text-sm text-fg-subtle">
                <CalendarClock className="size-4" aria-hidden="true" />
                {quote.checkIn} → {quote.checkOut} · {quote.nights} night
                {quote.nights === 1 ? '' : 's'} · {quote.rooms} room{quote.rooms === 1 ? '' : 's'}
              </p>
            </CardHeader>
            <CardContent>
              <PriceBreakdown quote={quote} />
            </CardContent>
          </Card>
        )}
        <div className="flex gap-3">
          <ButtonLink
            to={`/hotels/${quote?.hotel.slug ?? stored?.hotel.slug ?? ''}`}
            variant="outline"
          >
            Back to property
          </ButtonLink>
          <Button disabled aria-disabled="true">
            Booking available soon
          </Button>
        </div>
      </div>
    </div>
  );
}

export function SavedStaysPage() {
  const { ids } = useWishlist();
  const query = useQuery({
    queryKey: ['wishlist', 'list', ids.size],
    queryFn: ({ signal }) => marketplaceApi.wishlist(signal),
  });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Saved stays"
        description="Properties you've saved. Only currently published listings are shown."
      />
      {query.isPending ? (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <HotelCardSkeleton key={i} />
          ))}
        </div>
      ) : query.isError ? (
        <ErrorState description={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : query.data.length === 0 ? (
        <EmptyState
          icon={<Heart />}
          title="No saved stays yet"
          description="Tap the heart on any property to save it here."
          action={<ButtonLink to="/hotels">Explore stays</ButtonLink>}
        />
      ) : (
        <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {query.data.map((h) => (
            <li key={h.id}>
              <HotelCard hotel={h} href={`/hotels/${h.slug}`} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
