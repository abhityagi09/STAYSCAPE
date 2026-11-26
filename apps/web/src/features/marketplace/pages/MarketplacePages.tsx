import { Link, useSearchParams } from 'react-router';
import { Check, GitCompareArrows, Heart, Minus, X } from 'lucide-react';
import { PROPERTY_TYPE_LABELS, formatMinorUnits } from '@stayscape/shared';
import { useAppDispatch, useAppSelector } from '@/app/store';
import {
  Button,
  ButtonLink,
  EmptyState,
  ErrorState,
  PageHeader,
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
import { parseSearch } from '../search-state';
import { useQuery } from '@tanstack/react-query';
import { tr } from '@/lib/tr';

const yes = (v: boolean | null | undefined) =>
  v === null || v === undefined ? (
    <span className="text-fg-subtle">—</span>
  ) : v ? (
    <Check className="size-4 text-success" aria-label={tr('Yes')} />
  ) : (
    <Minus className="size-4 text-fg-subtle" aria-label={tr('No')} />
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
          title={tr('Nothing to compare yet')}
          description={tr('Use the Compare button on up to four stays in your search results.')}
          action={<ButtonLink to="/hotels">{tr('Browse stays')}</ButtonLink>}
        />
      </div>
    );
  }
  const hotels = query.data ?? [];
  const rows: Array<{ label: string; render: (h: (typeof hotels)[number]) => React.ReactNode }> = [
    { label: tr('Property type'), render: (h) => PROPERTY_TYPE_LABELS[h.propertyType] },
    { label: tr('Location'), render: (h) => `${h.city}, ${h.state}` },
    {
      label: tr('Star category'),
      render: (h) => (h.starCategory ? '★'.repeat(h.starCategory) : 'Unrated'),
    },
    { label: tr('Guest rating'), render: (h) => <RatingBadge rating={h.ratingSummary} /> },
    { label: tr('Review count'), render: (h) => h.ratingSummary.count },
    {
      label: search.checkIn ? `Price for ${search.checkIn} → ${search.checkOut}` : 'Price',
      render: (h) =>
        !search.checkIn ? (
          <span className="text-fg-subtle">{tr('Add dates')}</span>
        ) : h.price ? (
          <span className="font-semibold">
            {formatMinorUnits(h.price.totalMinor, h.price.currency)}
            <span className="block text-xs font-normal text-fg-subtle">
              {tr('incl. taxes ·')} {h.price.roomTypeName}
            </span>
          </span>
        ) : (
          <span className="text-warning">{tr('Not available')}</span>
        ),
    },
    {
      label: tr('Rooms available'),
      render: (h) =>
        h.price
          ? `${h.price.roomsLeft} for these dates`
          : `${h.roomCategories} categories · ${h.totalRooms} rooms`,
    },
    { label: tr('Breakfast'), render: (h) => yes(h.breakfastAvailable) },
    { label: tr('Parking'), render: (h) => yes(h.parking) },
    { label: tr('Pool'), render: (h) => yes(h.pool) },
    { label: tr('Free cancellation available'), render: (h) => yes(h.freeCancellationAvailable) },
    { label: tr('Check-in / out'), render: (h) => `${h.checkInTime} / ${h.checkOutTime}` },
    { label: tr('Pets'), render: (h) => yes(h.policies.petsAllowed) },
    { label: tr('Minimum check-in age'), render: (h) => h.policies.minimumCheckInAge },
  ];

  return (
    <div className="container-page py-10">
      <PageHeader
        title={tr('Compare stays')}
        description={
          search.checkIn
            ? tr('Prices are live quotes for your dates, including taxes.')
            : tr('Add dates in your search to compare real prices.')
        }
        actions={
          <Button variant="outline" size="sm" onClick={() => dispatch(clearCompare())}>
            {tr('Clear all')}
          </Button>
        }
      />
      {query.isPending ? (
        <SkeletonText lines={8} />
      ) : query.isError ? (
        <ErrorState description={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        <div
          className="relative overflow-x-auto rounded-2xl border border-border bg-surface"
          role="region"
          aria-label={tr('Comparison table')}
          tabIndex={0}
        >
          <table className="w-full min-w-[720px] text-sm">
            <caption className="sr-only">
              {tr('Comparison of')} {hotels.length} {tr('stays')}
            </caption>
            <thead>
              <tr>
                <th
                  scope="col"
                  className="w-48 p-4 text-left align-bottom text-xs font-semibold tracking-wide text-fg-muted uppercase"
                >
                  {tr('Property')}
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
                        {tr('Remove')}
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
          {tr('Some saved comparisons are no longer available and were skipped.')}
        </p>
      )}
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
        title={tr('Saved stays')}
        description={tr("Properties you've saved. Only currently published listings are shown.")}
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
          title={tr('No saved stays yet')}
          description={tr('Tap the heart on any property to save it here.')}
          action={<ButtonLink to="/hotels">{tr('Explore stays')}</ButtonLink>}
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
