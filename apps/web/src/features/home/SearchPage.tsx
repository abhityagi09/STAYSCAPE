import { useSearchParams } from 'react-router';
import { SearchX } from 'lucide-react';
import { Alert, Badge, ButtonLink, EmptyState, PageHeader } from '@/components/ui';
import { CATEGORIES } from './sections/content';
import { SearchForm } from './sections/SearchForm';
import { nightsBetween } from './search';

export default function SearchPage() {
  const [params] = useSearchParams();
  const destination = params.get('destination');
  const checkIn = params.get('checkIn');
  const checkOut = params.get('checkOut');
  const adults = Number(params.get('adults') ?? 0);
  const children = Number(params.get('children') ?? 0);
  const rooms = Number(params.get('rooms') ?? 0);
  const category = CATEGORIES.find((c) => c.slug === params.get('category'));
  const nights = checkIn && checkOut ? nightsBetween(checkIn, checkOut) : null;
  const date = new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

  const criteria = [
    destination && `Destination: ${destination}`,
    category && `Style: ${category.label}`,
    checkIn &&
      checkOut &&
      `${date.format(new Date(`${checkIn}T00:00:00Z`))} → ${date.format(new Date(`${checkOut}T00:00:00Z`))}${nights ? ` (${nights} night${nights === 1 ? '' : 's'})` : ''}`,
    adults > 0 &&
      `${adults + children} guest${adults + children === 1 ? '' : 's'}, ${rooms} room${rooms === 1 ? '' : 's'}`,
  ].filter(Boolean) as string[];

  return (
    <div className="container-page py-12">
      <PageHeader
        eyebrow="Search"
        title="Find a stay"
        description="Search verified properties by destination, dates and guests."
      />
      <SearchForm className="border-border bg-surface shadow-md" />
      <div className="mt-10 flex flex-col gap-6">
        {criteria.length > 0 && (
          <div className="flex flex-wrap gap-2" aria-label="Your search">
            {criteria.map((item) => (
              <Badge key={item} tone="outline" className="px-3 py-1 text-sm">
                {item}
              </Badge>
            ))}
          </div>
        )}
        <Alert
          tone="info"
          title="Live availability search launches with our first verified partners"
        >
          Property listings, real-time room inventory and prices arrive in the next release. We will
          not show results until they reflect stays you can actually book.
        </Alert>
        <EmptyState
          icon={<SearchX />}
          title="No bookable stays yet"
          description="Create an account and we'll be ready for you the moment properties in your destination go live."
          action={
            <ButtonLink to="/register" size="sm">
              Create a free account
            </ButtonLink>
          }
        />
      </div>
    </div>
  );
}
