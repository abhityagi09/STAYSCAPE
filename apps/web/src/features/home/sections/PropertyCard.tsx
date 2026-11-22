import { Link } from 'react-router';
import { MapPin } from 'lucide-react';
import type { CurrencyCode } from '@stayscape/shared';
import { Badge, Card, PriceDisplay, RatingDisplay, Skeleton } from '@/components/ui';

/**
 * Listing summary as it will be returned by the Phase 2 property search API.
 * Rendered only with real API data — never with placeholder listings.
 */
export interface PropertySummary {
  id: string;
  slug: string;
  name: string;
  city: string;
  region: string;
  coverImageUrl: string | null;
  category: string;
  rating: { average: number; count: number } | null;
  fromPrice: { amountMinor: number; currency: CurrencyCode } | null;
}

export function PropertyCard({ property }: { property: PropertySummary }) {
  return (
    <Card interactive className="overflow-hidden">
      <Link to={`/stays/${property.slug}`} className="block">
        <div className="aspect-[4/3] bg-surface-muted">
          {property.coverImageUrl && (
            <img
              src={property.coverImageUrl}
              alt=""
              loading="lazy"
              className="size-full object-cover"
            />
          )}
        </div>
        <div className="flex flex-col gap-2 p-5">
          <Badge tone="outline" className="w-fit">
            {property.category}
          </Badge>
          <h3 className="font-display text-lg font-semibold">{property.name}</h3>
          <p className="flex items-center gap-1 text-sm text-fg-muted">
            <MapPin className="size-3.5" aria-hidden="true" /> {property.city}, {property.region}
          </p>
          <div className="mt-1 flex items-center justify-between">
            {property.rating ? (
              <RatingDisplay
                value={property.rating.average}
                count={property.rating.count}
                size="sm"
              />
            ) : (
              <span className="text-xs text-fg-subtle">New on STAYSCAPE</span>
            )}
            {property.fromPrice && (
              <PriceDisplay
                amountMinor={property.fromPrice.amountMinor}
                currency={property.fromPrice.currency}
                period="/ night"
                size="sm"
              />
            )}
          </div>
        </div>
      </Link>
    </Card>
  );
}

export function PropertyCardSkeleton() {
  return (
    <Card className="overflow-hidden">
      <Skeleton className="aspect-[4/3] rounded-none" />
      <div className="flex flex-col gap-3 p-5">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </Card>
  );
}
