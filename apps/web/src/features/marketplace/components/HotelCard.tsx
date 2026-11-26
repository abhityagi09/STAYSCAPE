import { Link, useNavigate } from 'react-router';
import { GitCompareArrows, Heart, MapPin, Zap } from 'lucide-react';
import {
  MAX_COMPARE_HOTELS,
  MEAL_PLAN_LABELS,
  PROPERTY_TYPE_LABELS,
  type HotelCardDto,
  type ImageDto,
} from '@stayscape/shared';
import { useAppDispatch, useAppSelector } from '@/app/store';
import { Badge, PriceDisplay, RatingDisplay, Skeleton, useToast } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useWishlist } from '../api';
import { toggleCompare } from '../compare-slice';
import { tr, trf } from '@/lib/tr';

/** Responsive, lazily-loaded image with AVIF + WebP sources and a dominant-colour placeholder. */
export function ResponsiveImage({
  image,
  sizes,
  className,
  eager,
}: {
  image: ImageDto | null;
  sizes: string;
  className?: string;
  eager?: boolean;
}) {
  if (!image) return <div className={cn('bg-surface-sunken', className)} aria-hidden="true" />;
  return (
    <picture>
      {image.variants.avif && (
        <source type="image/avif" srcSet={`${image.variants.avif} 1024w`} sizes={sizes} />
      )}
      <source
        type="image/webp"
        srcSet={`${image.variants.sm} 480w, ${image.variants.md} 1024w, ${image.variants.lg} 1920w`}
        sizes={sizes}
      />
      <img
        src={image.variants.md}
        alt={image.alt}
        width={image.width || undefined}
        height={image.height || undefined}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        style={{ backgroundColor: image.dominantColor ?? undefined }}
        className={cn('object-cover', className)}
      />
    </picture>
  );
}

export function RatingBadge({ rating }: { rating: HotelCardDto['ratingSummary'] }) {
  if (rating.count === 0)
    return <span className="text-xs text-fg-subtle">{tr('New — no ratings yet')}</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <RatingDisplay value={rating.average} count={rating.count} size="sm" />
      {rating.source === 'DEVELOPMENT_SEED' && (
        <Badge
          tone="outline"
          className="text-[10px]"
          title={tr('Sample rating generated for development — not real guest reviews')}
        >
          {tr('Sample data')}
        </Badge>
      )}
    </span>
  );
}

export function HotelCard({
  hotel,
  href,
  highlighted,
  onHover,
  layout = 'grid',
}: {
  hotel: HotelCardDto;
  href: string;
  highlighted?: boolean;
  onHover?: (id: string | null) => void;
  layout?: 'grid' | 'list';
}) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { toast } = useToast();
  const compare = useAppSelector((s) => s.compare.items);
  const inCompare = compare.some((c) => c.id === hotel.id);
  const { isAuthenticated, ids, toggle } = useWishlist();
  const saved = ids.has(hotel.id);

  const onSave = () => {
    if (!isAuthenticated) {
      toast({
        title: tr('Sign in to save stays'),
        description: tr('Saved stays sync across your devices.'),
      });
      navigate(
        `/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`,
      );
      return;
    }
    toggle.mutate({ id: hotel.id, saved });
  };
  const onCompare = () => {
    if (!inCompare && compare.length >= MAX_COMPARE_HOTELS) {
      toast({
        title: trf('Compare up to {0} stays', [MAX_COMPARE_HOTELS]),
        description: tr('Remove one to add another.'),
        variant: 'warning',
      });
      return;
    }
    dispatch(toggleCompare({ id: hotel.id, name: hotel.name }));
  };

  return (
    <article
      className={cn(
        'group relative flex overflow-hidden rounded-2xl border bg-surface transition-[box-shadow,border-color] duration-300 hover:shadow-md',
        highlighted ? 'border-primary ring-2 ring-primary/30' : 'border-border',
        layout === 'grid' ? 'flex-col' : 'flex-col sm:flex-row',
      )}
      onMouseEnter={() => onHover?.(hotel.id)}
      onMouseLeave={() => onHover?.(null)}
      aria-labelledby={`hotel-${hotel.id}`}
    >
      <div
        className={cn(
          'relative shrink-0 overflow-hidden',
          layout === 'grid' ? 'aspect-[4/3]' : 'aspect-[4/3] sm:aspect-auto sm:w-64 lg:w-36',
        )}
      >
        <ResponsiveImage
          image={hotel.coverImage}
          sizes="(min-width: 1024px) 33vw, 100vw"
          className="size-full transition-transform duration-500 group-hover:scale-[1.03]"
        />
        {hotel.featured && (
          <Badge tone="accent" className="absolute top-3 left-3 shadow-sm">
            {tr('Featured')}
          </Badge>
        )}
        <div className="absolute top-3 right-3 flex gap-2">
          <button
            type="button"
            onClick={onSave}
            aria-pressed={saved}
            aria-label={
              saved
                ? trf('Remove {0} from saved stays', [hotel.name])
                : trf('Save {0}', [hotel.name])
            }
            className="inline-flex size-9 items-center justify-center rounded-full bg-surface/90 text-fg shadow-sm backdrop-blur hover:bg-surface"
          >
            <Heart
              className={cn('size-4', saved && 'fill-danger text-danger')}
              aria-hidden="true"
            />
          </button>
        </div>
      </div>
      {/* min-w-0 lets long names wrap instead of overflowing the narrow map-view column. */}
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-4">
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-fg-subtle">
          <span>{tr(PROPERTY_TYPE_LABELS[hotel.propertyType])}</span>
          {hotel.starCategory > 0 && (
            <span aria-label={trf('{0}-star property', [hotel.starCategory])}>
              · {'★'.repeat(hotel.starCategory)}
            </span>
          )}
          {hotel.instantConfirmation && (
            <span className="inline-flex items-center gap-0.5 text-success">
              · <Zap className="size-3" aria-hidden="true" /> {tr('Instant')}
            </span>
          )}
        </div>
        <h3 id={`hotel-${hotel.id}`} className="font-display text-lg leading-snug font-semibold">
          <Link
            to={href}
            className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
          >
            {hotel.name}
          </Link>
        </h3>
        <p className="flex items-center gap-1 text-sm text-fg-muted">
          <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
          {hotel.city}, {hotel.state}
          {hotel.distanceKm !== null && (
            <span className="text-fg-subtle">
              {' '}
              · {hotel.distanceKm} {tr('km')}
            </span>
          )}
        </p>
        <RatingBadge rating={hotel.ratingSummary} />
        <div className="mt-auto flex flex-wrap items-end justify-between gap-3 pt-2">
          {hotel.price ? (
            <div className="flex flex-col">
              <PriceDisplay
                amountMinor={hotel.price.nightlyAverageMinor}
                currency={hotel.price.currency}
                period="/ night"
                size="md"
              />
              <span className="text-xs text-fg-subtle">
                {hotel.price.nights} {tr('night')}
                {hotel.price.nights === 1 ? '' : 's'} {tr('total incl. taxes:')}{' '}
                <PriceDisplay
                  amountMinor={hotel.price.totalMinor}
                  currency={hotel.price.currency}
                  size="sm"
                  className="inline-flex"
                />
              </span>
              <span className="text-xs text-fg-subtle">
                {tr(MEAL_PLAN_LABELS[hotel.price.mealPlan])}
                {hotel.price.freeCancellation && (
                  <span className="text-success"> {tr('· Free cancellation')}</span>
                )}
                {hotel.price.roomsLeft <= 3 && (
                  <span className="text-warning">
                    {' '}
                    · {hotel.price.roomsLeft} {tr('left')}
                  </span>
                )}
              </span>
            </div>
          ) : (
            <span className="text-xs text-fg-subtle">{tr('Add dates to see prices')}</span>
          )}
          <button
            type="button"
            onClick={onCompare}
            aria-pressed={inCompare}
            className={cn(
              'relative z-10 inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium',
              inCompare
                ? 'border-primary bg-primary-soft text-primary'
                : 'border-border-strong text-fg-muted hover:text-fg',
            )}
          >
            <GitCompareArrows className="size-3.5" aria-hidden="true" />
            {inCompare ? tr('Comparing') : tr('Compare')}
          </button>
        </div>
      </div>
    </article>
  );
}

export function HotelCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface" aria-hidden="true">
      <Skeleton className="aspect-[4/3] rounded-none" />
      <div className="flex flex-col gap-2.5 p-4">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-3.5 w-1/2" />
        <Skeleton className="mt-3 h-5 w-28" />
      </div>
    </div>
  );
}
