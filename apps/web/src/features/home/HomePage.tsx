import { CmsBanners } from '@/features/ops/ContentPages';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  ArrowRight,
  BadgeCheck,
  Building,
  Building2,
  Hotel,
  House,
  Leaf,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  TreePalm,
} from 'lucide-react';
import type { HotelCardDto, PropertyType } from '@stayscape/shared';
import { ButtonLink, EmptyState, ErrorState } from '@/components/ui';
import { DEFAULT_SEARCH, nextWeekend, toSearchParams } from '@/features/marketplace/search-state';
import {
  useDestinations,
  useFeatured,
  useHotelSearch,
  useTrending,
} from '@/features/marketplace/api';
import { HotelCard, HotelCardSkeleton } from '@/features/marketplace/components/HotelCard';
import { StaySearchBar } from '@/features/marketplace/components/StaySearchBar';
import { errorMessage } from '@/lib/api/errors';
import { todayIsoDate } from '@/components/ui';
import { TRAVEL_NOTES } from './sections/content';
import { Newsletter } from './sections/Newsletter';
import { tr, trf } from '@/lib/tr';

const CATEGORIES: Array<{ type: PropertyType; label: string; blurb: string; icon: typeof Hotel }> =
  [
    {
      type: 'HOTEL',
      get label() {
        return tr('Hotels');
      },
      blurb: 'City stays with service you can count on',
      icon: Hotel,
    },
    {
      type: 'RESORT',
      get label() {
        return tr('Resorts');
      },
      blurb: 'Pools, spas and long, slow mornings',
      icon: TreePalm,
    },
    {
      type: 'VILLA',
      get label() {
        return tr('Villas');
      },
      blurb: 'Private space for families and friends',
      icon: House,
    },
    {
      type: 'BOUTIQUE',
      get label() {
        return tr('Boutique');
      },
      blurb: 'Small, characterful, design-led',
      icon: Sparkles,
    },
    {
      type: 'HOMESTAY',
      get label() {
        return tr('Homestays');
      },
      blurb: 'Local hosts and home-cooked meals',
      icon: Leaf,
    },
    {
      type: 'APARTMENT',
      get label() {
        return tr('Apartments');
      },
      blurb: 'Room to live for longer trips',
      icon: Building,
    },
  ];

function SectionHeading({
  id,
  eyebrow,
  title,
  description,
  action,
}: {
  id: string;
  eyebrow: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        <p className="eyebrow">{eyebrow}</p>
        <h2 id={id} className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          {title}
        </h2>
        {description && <p className="mt-3 text-fg-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/** A row of real listings with loading, empty and error states. */
function HotelRail({
  id,
  eyebrow,
  title,
  description,
  query,
  href,
  viewAll,
}: {
  id: string;
  eyebrow: string;
  title: string;
  description?: string;
  query: {
    data?: HotelCardDto[] | undefined;
    isPending: boolean;
    error: unknown;
    refetch: () => unknown;
  };
  href: (h: HotelCardDto) => string;
  viewAll: string;
}) {
  return (
    <section aria-labelledby={id} className="container-page mt-20">
      <SectionHeading
        id={id}
        eyebrow={eyebrow}
        title={title}
        description={description}
        action={
          <Link
            to={viewAll}
            className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
          >
            {tr('View all')} <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        }
      />
      {query.isPending ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <HotelCardSkeleton key={i} />
          ))}
        </div>
      ) : query.error ? (
        <ErrorState description={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : !query.data?.length ? (
        <EmptyState
          compact
          icon={<Building2 />}
          title={tr('Nothing to show yet')}
          description={tr('Listings appear here as verified properties go live.')}
        />
      ) : (
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {query.data.slice(0, 4).map((h) => (
            <li key={h.id}>
              <HotelCard hotel={h} href={href(h)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function HomePage() {
  const navigate = useNavigate();
  const weekend = nextWeekend(todayIsoDate());
  const weekendQs = toSearchParams({ ...weekend }).toString();
  const destinations = useDestinations();
  const featured = useFeatured(8);
  const trending = useTrending(8);
  const topRated = useHotelSearch({ sort: 'rating_desc', page: 1 });
  const luxury = useHotelSearch({ stars: [5], sort: 'rating_desc' });
  const budget = useHotelSearch({ ...weekend, sort: 'price_asc' });
  const weekendEscapes = useHotelSearch({
    ...weekend,
    propertyTypes: ['RESORT', 'VILLA', 'HOMESTAY'],
    sort: 'recommended',
  });
  const pick = (q: ReturnType<typeof useHotelSearch>) => ({
    data: q.data?.items,
    isPending: q.isPending,
    error: q.error,
    refetch: q.refetch,
  });
  const fmt = new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  const weekendLabel = `${fmt.format(new Date(`${weekend.checkIn}T00:00:00Z`))} – ${fmt.format(new Date(`${weekend.checkOut}T00:00:00Z`))}`;

  return (
    <>
      <section
        aria-labelledby="hero-title"
        className="hero-texture relative overflow-hidden pt-[72px] text-ivory"
      >
        <svg
          className="pointer-events-none absolute top-24 -right-40 size-[640px] text-gold-500/10"
          viewBox="0 0 200 200"
          aria-hidden="true"
        >
          {[96, 76, 56, 36].map((r) => (
            <circle
              key={r}
              cx="100"
              cy="100"
              r={r}
              fill="none"
              stroke="currentColor"
              strokeWidth="0.6"
            />
          ))}
        </svg>
        <div className="container-page relative pt-20 pb-40 sm:pt-28 lg:pb-48">
          <p className="eyebrow animate-rise-in !text-gold-300">
            {tr('Verified stays · Honest prices')}
          </p>
          <h1
            id="hero-title"
            className="mt-5 max-w-3xl animate-rise-in font-display text-display-sm font-semibold tracking-tight [animation-delay:60ms] sm:text-display-md lg:text-display-lg"
          >
            {tr('Stays worth the journey.')}
          </h1>
          <p className="mt-6 max-w-xl animate-rise-in text-lg text-ivory/75 [animation-delay:120ms]">
            {tr(
              'Discover hotels, resorts and boutique stays across India — each one reviewed before it can take a booking, with every fee shown upfront.',
            )}
          </p>
        </div>
      </section>
      <div className="container-page relative z-10 -mt-28 lg:-mt-32">
        <StaySearchBar
          className="animate-rise-in [animation-delay:180ms]"
          initial={{ ...DEFAULT_SEARCH }}
          onSearch={(values) => navigate(`/hotels?${toSearchParams(values).toString()}`)}
          onOpenHotel={(slug) => navigate(`/hotels/${slug}`)}
        />
      </div>

      <section
        aria-label={tr('Why STAYSCAPE')}
        className="container-page mt-12 grid gap-6 sm:grid-cols-3"
      >
        {[
          {
            icon: BadgeCheck,
            title: tr('Every partner verified'),
            body: tr('Business and property checks before listings go live.'),
          },
          {
            icon: ReceiptText,
            title: tr('All-in pricing'),
            body: tr('Taxes and fees itemised before you pay.'),
          },
          {
            icon: ShieldCheck,
            title: tr('Your account, protected'),
            body: tr('Device sessions you can see and revoke.'),
          },
        ].map(({ icon: Icon, title, body }) => (
          <div key={title} className="flex items-start gap-3">
            <Icon
              className="mt-0.5 size-5 shrink-0 text-gold-600 dark:text-gold-400"
              aria-hidden="true"
            />
            <p className="text-sm">
              <span className="font-semibold text-fg">{title}.</span>{' '}
              <span className="text-fg-muted">{body}</span>
            </p>
          </div>
        ))}
      </section>

      <section
        id="destinations"
        aria-labelledby="destinations-title"
        className="container-page mt-20 scroll-mt-24"
      >
        <SectionHeading
          id="destinations-title"
          eyebrow={tr('Destinations')}
          title={tr('Where travellers are heading')}
        />
        {destinations.isPending ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="h-48 animate-pulse rounded-3xl bg-surface-sunken" />
            ))}
          </div>
        ) : destinations.isError ? (
          <ErrorState
            description={errorMessage(destinations.error)}
            onRetry={() => void destinations.refetch()}
          />
        ) : destinations.data.length === 0 ? (
          <EmptyState compact title={tr('Destinations coming soon')} />
        ) : (
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {destinations.data.slice(0, 8).map((d, i) => (
              <li key={d.id}>
                <Link
                  to={`/hotels?destination=${encodeURIComponent(d.slug)}`}
                  className="group relative flex min-h-48 flex-col justify-end overflow-hidden rounded-3xl p-5 text-ivory shadow-md transition-transform duration-500 hover:-translate-y-1"
                  style={{
                    background: `linear-gradient(150deg, hsl(${(i * 47) % 360} 40% 30%), hsl(${(i * 47 + 40) % 360} 45% 14%))`,
                  }}
                >
                  <p className="text-xs font-semibold tracking-[0.18em] text-gold-300 uppercase">
                    {d.region}
                  </p>
                  <h3 className="mt-1 font-display text-2xl font-semibold">{d.name}</h3>
                  <p className="mt-1 text-sm text-ivory/80">
                    {d.propertyCount} {d.propertyCount === 1 ? 'stay' : 'stays'}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <HotelRail
        id="trending"
        eyebrow={tr('Trending')}
        title={tr('Popular right now')}
        query={{
          data: trending.data,
          isPending: trending.isPending,
          error: trending.error,
          refetch: trending.refetch,
        }}
        href={(h) => `/hotels/${h.slug}`}
        viewAll="/hotels?sort=popularity"
      />
      <HotelRail
        id="featured"
        eyebrow={tr('Featured')}
        title={tr('Hand-picked stays')}
        query={{
          data: featured.data,
          isPending: featured.isPending,
          error: featured.error,
          refetch: featured.refetch,
        }}
        href={(h) => `/hotels/${h.slug}`}
        viewAll="/hotels"
      />
      <HotelRail
        id="top-rated"
        eyebrow={tr('Top rated')}
        title={tr("Guests' favourites")}
        query={pick(topRated)}
        href={(h) => `/hotels/${h.slug}`}
        viewAll="/hotels?sort=rating_desc"
      />
      <HotelRail
        id="budget"
        eyebrow={tr('Budget-friendly')}
        title={trf('Great value this weekend ({0})', [weekendLabel])}
        description={tr('Live prices for 2 guests, 1 room, including taxes.')}
        query={pick(budget)}
        href={(h) => `/hotels/${h.slug}?${weekendQs}`}
        viewAll={`/hotels?${weekendQs}&sort=price_asc`}
      />
      <HotelRail
        id="luxury"
        eyebrow={tr('Luxury')}
        title={tr('Five-star indulgence')}
        query={pick(luxury)}
        href={(h) => `/hotels/${h.slug}`}
        viewAll="/hotels?stars=5"
      />
      <HotelRail
        id="weekend"
        eyebrow={tr('Weekend escapes')}
        title={trf('Resorts, villas & homestays free {0}', [weekendLabel])}
        query={pick(weekendEscapes)}
        href={(h) => `/hotels/${h.slug}?${weekendQs}`}
        viewAll={`/hotels?${weekendQs}&propertyTypes=RESORT,VILLA,HOMESTAY`}
      />

      <section aria-labelledby="categories-title" className="container-page mt-20">
        <SectionHeading
          id="categories-title"
          eyebrow={tr('Browse by style')}
          title={tr('Find the stay that fits the trip')}
        />
        <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          {CATEGORIES.map(({ type, label, blurb, icon: Icon }) => (
            <li key={type}>
              <Link
                to={`/hotels?propertyTypes=${type}`}
                className="group flex h-full flex-col gap-3 rounded-2xl border border-border bg-surface p-5 transition-[box-shadow,transform] duration-300 hover:-translate-y-0.5 hover:shadow-md"
              >
                <span className="flex size-11 items-center justify-center rounded-xl bg-primary-soft text-primary transition-colors group-hover:bg-primary group-hover:text-primary-fg">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <span className="font-semibold text-fg">{label}</span>
                <span className="text-xs text-fg-muted">{blurb}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-label={tr('Get started')}
        className="container-page mt-20 grid gap-5 lg:grid-cols-[1.3fr_1fr]"
      >
        <div className="relative overflow-hidden rounded-3xl bg-forest-900 p-8 text-ivory sm:p-12">
          <p className="eyebrow !text-gold-300">{tr('For property owners')}</p>
          <h2 className="mt-3 max-w-md font-display text-3xl font-semibold">
            {tr('Bring your property to travellers who value it.')}
          </h2>
          <p className="mt-3 max-w-md text-ivory/75">
            {tr('Transparent onboarding, team permissions, real-time inventory and pricing tools.')}
          </p>
          <ButtonLink
            to="/partner/onboarding"
            variant="accent"
            className="mt-8"
            rightIcon={<ArrowRight className="size-4" aria-hidden="true" />}
          >
            {tr('Become a partner')}
          </ButtonLink>
          <Building2
            className="absolute -right-6 -bottom-6 size-48 text-white/5"
            aria-hidden="true"
          />
        </div>
        <div className="flex flex-col justify-between rounded-3xl border border-border bg-accent-soft p-8 sm:p-12">
          <div>
            <p className="eyebrow">{tr('For travellers')}</p>
            <h2 className="mt-3 font-display text-3xl font-semibold">
              {tr('Save stays, compare and plan')}
            </h2>
            <p className="mt-3 text-fg-muted">
              {tr(
                'Create a free account to save favourites and compare up to four properties side by side.',
              )}
            </p>
          </div>
          <ButtonLink to="/register" className="mt-8 w-fit">
            {tr('Create account')}
          </ButtonLink>
        </div>
      </section>

      <section
        id="inspiration"
        aria-labelledby="inspiration-title"
        className="container-page mt-20 scroll-mt-24"
      >
        <SectionHeading
          id="inspiration-title"
          eyebrow={tr('Travel notes')}
          title={tr('A little inspiration before you go')}
        />
        <ul className="grid gap-5 md:grid-cols-3">
          {TRAVEL_NOTES.map((note) => (
            <li
              key={note.title}
              className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-6"
            >
              <span className="w-fit rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-medium text-primary">
                {note.tag}
              </span>
              <h3 className="font-display text-xl font-semibold">{note.title}</h3>
              <p className="text-sm leading-relaxed text-fg-muted">{note.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <Newsletter />
      <CmsBanners />
    </>
  );
}
