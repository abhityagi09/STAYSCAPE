import { useMemo, useState } from 'react';
import { useDocumentTitle } from '@/lib/use-document-title';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import {
  GitCompareArrows,
  List,
  Map as MapIcon,
  SearchX,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import {
  PROPERTY_TYPES,
  PROPERTY_TYPE_LABELS,
  SEARCH_SORT_LABELS,
  SEARCH_SORTS,
  formatMinorUnits,
  type SearchSort,
  ACCESSIBILITY_FEATURES,
  ACCESSIBILITY_FEATURE_LABELS,
} from '@stayscape/shared';
import { useAppDispatch, useAppSelector } from '@/app/store';
import {
  Badge,
  Button,
  ButtonLink,
  Checkbox,
  Drawer,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Pagination,
  Select,
} from '@/components/ui';
import { MapView } from '@/components/map/MapView';
import { normalizeApiError } from '@/lib/api/errors';
import { cn } from '@/lib/cn';
import { useAmenities, useHotelSearch } from '../api';
import { clearCompare, removeCompare } from '../compare-slice';
import { HotelCard, HotelCardSkeleton } from '../components/HotelCard';
import { StaySearchBar } from '../components/StaySearchBar';
import {
  FLAG_LABELS,
  activeFilterCount,
  clearFilters,
  parseSearch,
  toSearchParams,
  type FlagKey,
  type SearchState,
} from '../search-state';
import { tr, trf } from '@/lib/tr';

function FiltersPanel({
  state,
  update,
}: {
  state: SearchState;
  update: (patch: Partial<SearchState>) => void;
}) {
  const amenities = useAmenities();
  const datesSet = Boolean(state.checkIn);
  const [minPrice, setMinPrice] = useState(
    state.minPrice !== null ? String(state.minPrice / 100) : '',
  );
  const [maxPrice, setMaxPrice] = useState(
    state.maxPrice !== null ? String(state.maxPrice / 100) : '',
  );
  const toggle = <T,>(list: T[], value: T) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  const toMinor = (v: string) => (/^\d{1,9}$/.test(v) ? Number(v) * 100 : null);

  return (
    <div className="flex flex-col gap-7">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-semibold">
          {tr('Price per night (incl. taxes)')}
        </legend>
        {!datesSet && (
          <p className="text-xs text-fg-subtle">{tr('Add dates to filter by real prices.')}</p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Input
            label={tr('Min (₹)')}
            inputMode="numeric"
            value={minPrice}
            disabled={!datesSet}
            onChange={(e) => setMinPrice(e.target.value)}
          />
          <Input
            label={tr('Max (₹)')}
            inputMode="numeric"
            value={maxPrice}
            disabled={!datesSet}
            onChange={(e) => setMaxPrice(e.target.value)}
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={!datesSet}
          onClick={() => update({ minPrice: toMinor(minPrice), maxPrice: toMinor(maxPrice) })}
        >
          {tr('Apply price')}
        </Button>
      </fieldset>
      <fieldset className="flex flex-col gap-2.5">
        <legend className="mb-2 text-sm font-semibold">{tr('Popular filters')}</legend>
        {(Object.keys(FLAG_LABELS) as FlagKey[]).map((flag) => (
          <Checkbox
            key={flag}
            label={tr(FLAG_LABELS[flag])}
            checked={state[flag]}
            onChange={() => update({ [flag]: !state[flag] })}
          />
        ))}
      </fieldset>
      <fieldset className="flex flex-col gap-2.5">
        <legend className="mb-2 text-sm font-semibold">{tr('Accessibility')}</legend>
        {ACCESSIBILITY_FEATURES.map((f) => (
          <Checkbox
            key={f}
            label={tr(ACCESSIBILITY_FEATURE_LABELS[f])}
            checked={state.accessibilityFeatures.includes(f)}
            onChange={() =>
              update({
                accessibilityFeatures: state.accessibilityFeatures.includes(f)
                  ? state.accessibilityFeatures.filter((x) => x !== f)
                  : [...state.accessibilityFeatures, f],
              })
            }
          />
        ))}
      </fieldset>
      <fieldset className="flex flex-col gap-2.5">
        <legend className="mb-2 text-sm font-semibold">{tr('Property type')}</legend>
        {PROPERTY_TYPES.map((type) => (
          <Checkbox
            key={type}
            label={tr(PROPERTY_TYPE_LABELS[type])}
            checked={state.propertyTypes.includes(type)}
            onChange={() => update({ propertyTypes: toggle(state.propertyTypes, type) })}
          />
        ))}
      </fieldset>
      <fieldset className="flex flex-col gap-2.5">
        <legend className="mb-2 text-sm font-semibold">{tr('Star rating')}</legend>
        {[5, 4, 3, 2, 1].map((stars) => (
          <Checkbox
            key={stars}
            label={trf('{0} {1} star{2}', ['★'.repeat(stars), stars, stars === 1 ? '' : 's'])}
            checked={state.stars.includes(stars)}
            onChange={() => update({ stars: toggle(state.stars, stars) })}
          />
        ))}
      </fieldset>
      <Select
        label={tr('Guest rating')}
        value={state.minRating === null ? '' : String(state.minRating)}
        onChange={(e) => update({ minRating: e.target.value ? Number(e.target.value) : null })}
        placeholder={tr('Any rating')}
        options={[
          { value: '4.5', label: tr('4.5+ Exceptional') },
          { value: '4', label: tr('4.0+ Very good') },
          { value: '3.5', label: tr('3.5+ Good') },
        ]}
      />
      <fieldset className="flex flex-col gap-2.5">
        <legend className="mb-2 text-sm font-semibold">{tr('Amenities')}</legend>
        {(amenities.data ?? [])
          .filter(
            (a) =>
              ![
                'wifi',
                'parking',
                'pool',
                'breakfast',
                'pet-friendly',
                'wheelchair-accessible',
              ].includes(a.code),
          )
          .slice(0, 14)
          .map((a) => (
            <Checkbox
              key={a.code}
              label={a.name}
              checked={state.amenities.includes(a.code)}
              onChange={() => update({ amenities: toggle(state.amenities, a.code) })}
            />
          ))}
      </fieldset>
    </div>
  );
}

function CompareTray() {
  const items = useAppSelector((s) => s.compare.items);
  const dispatch = useAppDispatch();
  const location = useLocation();
  if (items.length === 0) return null;
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 shadow-xl backdrop-blur"
      role="region"
      aria-label={tr('Comparison tray')}
    >
      <div className="container-page flex flex-wrap items-center gap-3 py-3">
        <GitCompareArrows className="size-5 text-primary" aria-hidden="true" />
        <ul className="flex flex-1 flex-wrap gap-2">
          {items.map((item) => (
            <li key={item.id}>
              <Badge tone="primary" className="py-1 pr-1 text-sm">
                {item.name}
                <button
                  type="button"
                  onClick={() => dispatch(removeCompare(item.id))}
                  aria-label={trf('Remove {0} from comparison', [item.name])}
                  className="rounded-full p-0.5 hover:bg-primary/10"
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
        <Button variant="ghost" size="sm" onClick={() => dispatch(clearCompare())}>
          {tr('Clear')}
        </Button>
        <ButtonLink
          to={`/compare${location.search}`}
          size="sm"
          aria-disabled={items.length < 2 || undefined}
        >
          {tr('Compare')} {items.length}
        </ButtonLink>
      </div>
    </div>
  );
}

export default function SearchResultsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const state = useMemo(() => parseSearch(params), [params]);
  const [view, setView] = useState<'list' | 'map'>(params.get('view') === 'map' ? 'map' : 'list');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [searchOnMove, setSearchOnMove] = useState(true);
  const query = useHotelSearch(state);
  useDocumentTitle(state.destination ? `Stays in ${state.destination}` : 'Hotels and stays');
  const results = query.data;
  const filterCount = activeFilterCount(state);
  const detailSuffix = useMemo(() => {
    const keep = new URLSearchParams();
    for (const k of ['checkIn', 'checkOut', 'adults', 'children', 'childrenAges', 'rooms'])
      if (params.get(k)) keep.set(k, params.get(k)!);
    const s = keep.toString();
    return s ? `?${s}` : '';
  }, [params]);

  const update = (patch: Partial<SearchState>, resetPage = true) => {
    const next = toSearchParams({
      ...state,
      ...patch,
      ...(resetPage ? { page: patch.page ?? 1 } : {}),
    });
    if (view === 'map') next.set('view', 'map');
    setParams(next);
  };

  const markers = useMemo(
    () =>
      (results?.items ?? []).map((h) => ({
        id: h.id,
        lat: h.location.lat,
        lng: h.location.lng,
        title: h.name,
        subtitle: [
          PROPERTY_TYPE_LABELS[h.propertyType],
          h.ratingSummary.count > 0 ? `★ ${h.ratingSummary.average.toFixed(1)}` : null,
        ]
          .filter(Boolean)
          .join(' · '),
        href: `/hotels/${h.slug}${detailSuffix}`,
        label: h.price
          ? formatMinorUnits(h.price.nightlyAverageMinor, h.price.currency, 'en-IN', {
              maximumFractionDigits: 0,
            })
          : '★',
      })),
    [results, detailSuffix],
  );

  // Distance needs a reference point: a destination's centre or the visible map area.
  const hasCenter = Boolean(state.destination || state.bbox);
  const sortOptions = SEARCH_SORTS.filter(
    (s) => (s !== 'distance' || hasCenter) && (state.checkIn || !s.startsWith('price')),
  ).map((s) => ({ value: s, label: tr(SEARCH_SORT_LABELS[s]) }));
  const heading = state.destination
    ? `Stays in ${state.destination}`
    : state.bbox
      ? 'Stays in this map area'
      : 'All stays';
  const err = query.error ? normalizeApiError(query.error) : null;

  const list = (
    <section aria-labelledby="results-heading" aria-busy={query.isFetching}>
      <h2 id="results-heading" className="sr-only">
        {tr('Results')}
      </h2>
      {query.isPending ? (
        <div
          className={cn(
            'grid gap-5',
            view === 'map' ? 'grid-cols-1' : 'sm:grid-cols-2 xl:grid-cols-3',
          )}
        >
          {Array.from({ length: 6 }, (_, i) => (
            <HotelCardSkeleton key={i} />
          ))}
        </div>
      ) : err ? (
        <ErrorState
          description={err.message}
          requestId={err.requestId}
          onRetry={() => void query.refetch()}
        />
      ) : results && results.items.length === 0 ? (
        <EmptyState
          icon={<SearchX />}
          title={tr('No stays match your search')}
          description={
            state.checkIn
              ? tr(
                  'Nothing is available for every night of these dates with these filters. Try other dates or remove some filters.',
                )
              : tr('Try a different destination or remove some filters.')
          }
          action={
            filterCount > 0 ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setParams(toSearchParams(clearFilters(state)))}
              >
                {tr('Clear filters')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul
          className={cn(
            'grid gap-5',
            view === 'map' ? 'grid-cols-1' : 'sm:grid-cols-2 xl:grid-cols-3',
            query.isFetching && 'opacity-70 transition-opacity',
          )}
        >
          {results?.items.map((hotel) => (
            <li key={hotel.id}>
              <HotelCard
                hotel={hotel}
                href={`/hotels/${hotel.slug}${detailSuffix}`}
                highlighted={highlighted === hotel.id}
                onHover={setHighlighted}
                layout={view === 'map' ? 'list' : 'grid'}
              />
            </li>
          ))}
        </ul>
      )}
      {results && (
        <Pagination
          className="mt-8"
          page={state.page}
          totalPages={results.pagination.totalPages}
          onPageChange={(page) => update({ page }, false)}
        />
      )}
    </section>
  );

  return (
    <div className="container-page pt-8 pb-32">
      <StaySearchBar
        variant="compact"
        initial={state}
        onSearch={(values) => update({ ...values, bbox: null })}
        onOpenHotel={(slug) => navigate(`/hotels/${slug}${detailSuffix}`)}
      />
      <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <PageHeader
          className="pb-0"
          title={heading}
          description={
            results
              ? `${results.pagination.total} ${results.pagination.total === 1 ? 'property' : 'properties'}${results.availabilityChecked ? ` available for ${results.nights} night${results.nights === 1 ? '' : 's'} — prices include taxes and fees` : ' — add dates to check availability and prices'}`
              : tr('Searching…')
          }
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="lg:hidden"
            leftIcon={<SlidersHorizontal className="size-4" aria-hidden="true" />}
            onClick={() => setFiltersOpen(true)}
          >
            {tr('Filters')}
            {filterCount ? ` (${filterCount})` : ''}
          </Button>
          <Select
            label={tr('Sort by')}
            hideLabel
            value={state.sort}
            onChange={(e) => update({ sort: e.target.value as SearchSort })}
            options={sortOptions}
            containerClassName="w-52"
          />
          <div
            className="inline-flex rounded-full border border-border-strong p-0.5"
            role="group"
            aria-label={tr('Result view')}
          >
            {(['list', 'map'] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => {
                  setView(v);
                  const next = new URLSearchParams(params);
                  if (v === 'map') next.set('view', 'map');
                  else next.delete('view');
                  setParams(next, { replace: true });
                }}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm',
                  view === v ? 'bg-primary text-primary-fg' : 'text-fg-muted',
                )}
              >
                {v === 'list' ? (
                  <List className="size-4" aria-hidden="true" />
                ) : (
                  <MapIcon className="size-4" aria-hidden="true" />
                )}
                {v === 'list' ? tr('List') : tr('Map')}
              </button>
            ))}
          </div>
        </div>
      </div>
      {filterCount > 0 && (
        <div className="mt-3 flex items-center gap-2 text-sm">
          <span className="text-fg-muted">
            {filterCount} {tr('filter')}
            {filterCount === 1 ? '' : 's'} {tr('applied')}
          </span>
          <Button
            variant="link"
            size="sm"
            onClick={() => setParams(toSearchParams(clearFilters(state)))}
          >
            {tr('Clear filters')}
          </Button>
        </div>
      )}
      {state.bbox && (
        <div className="mt-3 flex items-center gap-2 text-sm">
          <Badge tone="info">{tr('Showing the visible map area')}</Badge>
          <Button variant="link" size="sm" onClick={() => update({ bbox: null })}>
            {tr('Remove map area')}
          </Button>
        </div>
      )}

      <div
        className={cn(
          'mt-6 grid gap-8',
          view === 'map'
            ? 'lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]'
            : 'lg:grid-cols-[16rem_minmax(0,1fr)]',
        )}
      >
        {view === 'list' && (
          <aside className="hidden lg:block" aria-label={tr('Filters')}>
            <FiltersPanel state={state} update={update} />
          </aside>
        )}
        {view === 'map' ? (
          <>
            <div className="order-2 lg:order-1 lg:max-h-[calc(100dvh-10rem)] lg:overflow-y-auto lg:pr-2">
              {list}
            </div>
            <div className="order-1 flex flex-col gap-2 lg:order-2">
              <Checkbox
                label={tr('Search as I move the map')}
                checked={searchOnMove}
                onChange={() => setSearchOnMove((v) => !v)}
              />
              <MapView
                label={tr('Map of search results. Use the list for keyboard access.')}
                className="h-[60vh] lg:sticky lg:top-24 lg:h-[calc(100dvh-12rem)]"
                markers={markers}
                selectedId={highlighted}
                onSelect={(id) => {
                  setHighlighted(id);
                  document
                    .getElementById(`hotel-${id}`)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }}
                onBoundsChange={(bbox) => searchOnMove && update({ bbox, destination: '' })}
                onOpen={(_id, href) => navigate(href)}
              />
            </div>
          </>
        ) : (
          list
        )}
      </div>

      <Drawer
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title={tr('Filters')}
        side="left"
        footer={
          <Button fullWidth onClick={() => setFiltersOpen(false)}>
            {tr('Show')} {results?.pagination.total ?? ''} {tr('results')}
          </Button>
        }
      >
        <FiltersPanel state={state} update={update} />
      </Drawer>
      <p className="mt-10 text-xs text-fg-subtle">
        {tr('Prices are live quotes for your dates and guests, including taxes and fees.')}{' '}
        <Link to="/terms" className="underline">
          {tr('How we rank results')}
        </Link>
        {tr(': featured placement, guest rating and popularity.')}
      </p>
      <CompareTray />
    </div>
  );
}
