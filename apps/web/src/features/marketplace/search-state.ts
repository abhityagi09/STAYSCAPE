import {
  ACCESSIBILITY_FEATURES,
  type AccessibilityFeature,
  PROPERTY_TYPES,
  SEARCH_SORTS,
  addDays,
  diffDays,
  type PropertyType,
  type SearchSort,
} from '@stayscape/shared';

/** All search criteria live in the URL so any filtered search can be shared or bookmarked. */
export interface SearchState {
  destination: string;
  q: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  childrenAges: number[];
  rooms: number;
  propertyTypes: PropertyType[];
  stars: number[];
  minRating: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  amenities: string[];
  breakfast: boolean;
  parking: boolean;
  pool: boolean;
  wifi: boolean;
  petFriendly: boolean;
  accessible: boolean;
  accessibilityFeatures: AccessibilityFeature[];
  accessibilityVerifiedOnly: boolean;
  freeCancellation: boolean;
  instantConfirmation: boolean;
  bbox: [number, number, number, number] | null;
  sort: SearchSort;
  page: number;
}

export const DEFAULT_SEARCH: SearchState = {
  destination: '',
  q: '',
  checkIn: '',
  checkOut: '',
  adults: 2,
  children: 0,
  childrenAges: [],
  rooms: 1,
  propertyTypes: [],
  stars: [],
  minRating: null,
  minPrice: null,
  maxPrice: null,
  amenities: [],
  breakfast: false,
  parking: false,
  pool: false,
  wifi: false,
  petFriendly: false,
  accessible: false,
  accessibilityFeatures: [],
  accessibilityVerifiedOnly: false,
  freeCancellation: false,
  instantConfirmation: false,
  bbox: null,
  sort: 'recommended',
  page: 1,
};

const FLAGS = [
  'breakfast',
  'parking',
  'pool',
  'wifi',
  'petFriendly',
  'accessible',
  'accessibilityVerifiedOnly',
  'freeCancellation',
  'instantConfirmation',
] as const;
export type FlagKey = (typeof FLAGS)[number];
export const FLAG_LABELS: Record<FlagKey, string> = {
  breakfast: 'Breakfast included',
  parking: 'Parking',
  pool: 'Pool',
  wifi: 'Free Wi-Fi',
  petFriendly: 'Pet-friendly',
  accessible: 'Wheelchair accessible',
  accessibilityVerifiedOnly: 'Accessibility checked by Stayscape',
  freeCancellation: 'Free cancellation',
  instantConfirmation: 'Instant confirmation',
};

const int = (v: string | null, fallback: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};
const list = (v: string | null) => (v ? v.split(',').filter(Boolean) : []);
const isDate = (v: string | null): v is string => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v));

export function parseSearch(params: URLSearchParams): SearchState {
  const checkIn = params.get('checkIn');
  const checkOut = params.get('checkOut');
  const validDates =
    isDate(checkIn) &&
    isDate(checkOut) &&
    diffDays(checkIn, checkOut) >= 1 &&
    diffDays(checkIn, checkOut) <= 30;
  const children = int(params.get('children'), 0, 0, 10);
  const ages = list(params.get('childrenAges'))
    .map(Number)
    .filter((a) => Number.isInteger(a) && a >= 0 && a <= 17);
  const bbox = list(params.get('bbox')).map(Number);
  const sort = params.get('sort') as SearchSort;
  const priceSort = sort === 'price_asc' || sort === 'price_desc';
  return {
    ...DEFAULT_SEARCH,
    destination: params.get('destination') ?? '',
    q: params.get('q') ?? '',
    checkIn: validDates ? checkIn : '',
    checkOut: validDates ? checkOut : '',
    adults: int(params.get('adults'), 2, 1, 30),
    children,
    childrenAges:
      ages.length === children ? ages : Array.from({ length: children }, (_, i) => ages[i] ?? 8),
    rooms: int(params.get('rooms'), 1, 1, 8),
    propertyTypes: list(params.get('propertyTypes')).filter((t): t is PropertyType =>
      (PROPERTY_TYPES as readonly string[]).includes(t),
    ),
    stars: list(params.get('stars'))
      .map(Number)
      .filter((s) => s >= 0 && s <= 5),
    minRating: params.get('minRating') ? Number(params.get('minRating')) : null,
    minPrice: validDates && params.get('minPrice') ? int(params.get('minPrice'), 0, 0, 1e9) : null,
    maxPrice: validDates && params.get('maxPrice') ? int(params.get('maxPrice'), 0, 0, 1e9) : null,
    amenities: list(params.get('amenities')),
    accessibilityFeatures: list(params.get('accessibilityFeatures')).filter((f): f is AccessibilityFeature => (ACCESSIBILITY_FEATURES as readonly string[]).includes(f)),
    ...Object.fromEntries(FLAGS.map((f) => [f, params.get(f) === 'true'])),
    bbox:
      bbox.length === 4 && bbox.every(Number.isFinite)
        ? (bbox as [number, number, number, number])
        : null,
    sort:
      (SEARCH_SORTS as readonly string[]).includes(sort) &&
      (!priceSort || validDates) &&
      sort !== 'distance'
        ? sort
        : 'recommended',
    page: int(params.get('page'), 1, 1, 500),
  };
}

/** Only non-default values are written, keeping shared URLs short. */
export function toSearchParams(state: Partial<SearchState>): URLSearchParams {
  const full = { ...DEFAULT_SEARCH, ...state };
  const out = new URLSearchParams();
  const set = (key: string, value: string) => value && out.set(key, value);
  set('destination', full.destination);
  set('q', full.q);
  if (full.checkIn && full.checkOut) {
    out.set('checkIn', full.checkIn);
    out.set('checkOut', full.checkOut);
  }
  if (full.adults !== 2) out.set('adults', String(full.adults));
  if (full.children) {
    out.set('children', String(full.children));
    out.set('childrenAges', full.childrenAges.join(','));
  }
  if (full.rooms !== 1) out.set('rooms', String(full.rooms));
  set('propertyTypes', full.propertyTypes.join(','));
  set('stars', full.stars.join(','));
  if (full.minRating !== null) out.set('minRating', String(full.minRating));
  if (full.minPrice !== null) out.set('minPrice', String(full.minPrice));
  if (full.maxPrice !== null) out.set('maxPrice', String(full.maxPrice));
  set('amenities', full.amenities.join(','));
  set('accessibilityFeatures', full.accessibilityFeatures.join(','));
  for (const flag of FLAGS) if (full[flag]) out.set(flag, 'true');
  if (full.bbox) out.set('bbox', full.bbox.map((n) => n.toFixed(4)).join(','));
  if (full.sort !== 'recommended') out.set('sort', full.sort);
  if (full.page > 1) out.set('page', String(full.page));
  return out;
}

export const toQueryString = (state: Partial<SearchState>) => toSearchParams(state).toString();

export function activeFilterCount(state: SearchState): number {
  return (
    state.propertyTypes.length +
    state.stars.length +
    state.amenities.length +
    state.accessibilityFeatures.length +
    (state.minRating !== null ? 1 : 0) +
    (state.minPrice !== null || state.maxPrice !== null ? 1 : 0) +
    FLAGS.filter((f) => state[f]).length
  );
}

export function clearFilters(state: SearchState): SearchState {
  return {
    ...DEFAULT_SEARCH,
    destination: state.destination,
    q: state.q,
    checkIn: state.checkIn,
    checkOut: state.checkOut,
    adults: state.adults,
    children: state.children,
    childrenAges: state.childrenAges,
    rooms: state.rooms,
    sort: state.sort,
  };
}

export function stayFrom(
  state: Pick<
    SearchState,
    'checkIn' | 'checkOut' | 'adults' | 'children' | 'childrenAges' | 'rooms'
  >,
) {
  if (!state.checkIn || !state.checkOut) return null;
  return {
    checkIn: state.checkIn,
    checkOut: state.checkOut,
    adults: state.adults,
    children: state.children,
    childrenAges: state.childrenAges,
    rooms: state.rooms,
  };
}

/** The upcoming Friday → Sunday, in the browser's calendar. */
export function nextWeekend(today: string): { checkIn: string; checkOut: string } {
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  const toFriday = (5 - dow + 7) % 7 || 7;
  const checkIn = addDays(today, toFriday);
  return { checkIn, checkOut: addDays(checkIn, 2) };
}
