import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AmenityDto,
  DestinationDto,
  HotelCardDto,
  HotelDetailDto,
  QuoteDto,
  QuoteRequest,
  QuoteRevalidationDto,
  RoomOfferDto,
  SearchResultDto,
  SuggestionDto,
} from '@stayscape/shared';
import { useAuth } from '@/features/auth/use-auth';
import { http, unwrap } from '@/lib/api/client';
import { toQueryString, type SearchState } from './search-state';

export type CompareHotelDto = HotelCardDto & {
  breakfastAvailable: boolean;
  parking: boolean;
  pool: boolean;
  freeCancellationAvailable: boolean;
  cancellationTypes: string[];
  roomCategories: number;
  totalRooms: number;
  checkInTime: string;
  checkOutTime: string;
  policies: { petsAllowed: boolean; smokingAllowed: boolean; minimumCheckInAge: number };
  availableForDates: boolean | null;
};

export interface StayParams {
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  childrenAges: number[];
  rooms: number;
}

const stayQuery = (s: StayParams) =>
  new URLSearchParams({
    checkIn: s.checkIn,
    checkOut: s.checkOut,
    adults: String(s.adults),
    children: String(s.children),
    childrenAges: s.childrenAges.join(','),
    rooms: String(s.rooms),
  }).toString();

export const marketplaceApi = {
  search: (state: Partial<SearchState>, signal?: AbortSignal) =>
    unwrap<SearchResultDto>(http.get(`/hotels?${toQueryString(state)}`, { signal })),
  featured: (limit: number, signal?: AbortSignal) =>
    unwrap<HotelCardDto[]>(http.get('/hotels/featured', { params: { limit }, signal })),
  trending: (limit: number, signal?: AbortSignal) =>
    unwrap<HotelCardDto[]>(http.get('/hotels/trending', { params: { limit }, signal })),
  detail: (slug: string, signal?: AbortSignal) =>
    unwrap<HotelDetailDto>(http.get(`/hotels/${encodeURIComponent(slug)}`, { signal })),
  offers: (slug: string, stay: StayParams, signal?: AbortSignal) =>
    unwrap<RoomOfferDto[]>(
      http.get(`/hotels/${encodeURIComponent(slug)}/offers?${stayQuery(stay)}`, { signal }),
    ),
  similar: (slug: string, signal?: AbortSignal) =>
    unwrap<HotelCardDto[]>(http.get(`/hotels/${encodeURIComponent(slug)}/similar`, { signal })),
  compare: (ids: string[], stay: Partial<StayParams>, signal?: AbortSignal) =>
    unwrap<CompareHotelDto[]>(
      http.get('/hotels/compare', {
        params: {
          ids: ids.join(','),
          ...(stay.checkIn
            ? {
                checkIn: stay.checkIn,
                checkOut: stay.checkOut,
                adults: stay.adults,
                rooms: stay.rooms,
              }
            : {}),
        },
        signal,
      }),
    ),
  destinations: (signal?: AbortSignal) =>
    unwrap<DestinationDto[]>(http.get('/destinations', { signal })),
  suggestions: (q: string, signal?: AbortSignal) =>
    unwrap<SuggestionDto[]>(http.get('/destinations/suggestions', { params: { q }, signal })),
  amenities: (signal?: AbortSignal) => unwrap<AmenityDto[]>(http.get('/amenities', { signal })),
  quote: (input: QuoteRequest) => unwrap<QuoteDto>(http.post('/availability/quote', input)),
  revalidate: (quoteToken: string) =>
    unwrap<QuoteRevalidationDto>(http.post('/availability/quote/revalidate', { quoteToken })),
  wishlist: (signal?: AbortSignal) => unwrap<HotelCardDto[]>(http.get('/wishlist', { signal })),
  wishlistIds: (signal?: AbortSignal) => unwrap<string[]>(http.get('/wishlist/ids', { signal })),
  save: (id: string) => unwrap(http.put(`/wishlist/${id}`)),
  unsave: (id: string) => unwrap(http.delete(`/wishlist/${id}`)),
};

export function useHotelSearch(state: Partial<SearchState>, enabled = true) {
  return useQuery({
    queryKey: ['hotels', 'search', toQueryString(state)],
    queryFn: ({ signal }) => marketplaceApi.search(state, signal),
    placeholderData: keepPreviousData,
    enabled,
    staleTime: 15_000,
  });
}

export const useFeatured = (limit = 8) =>
  useQuery({
    queryKey: ['hotels', 'featured', limit],
    queryFn: ({ signal }) => marketplaceApi.featured(limit, signal),
    staleTime: 60_000,
  });
export const useTrending = (limit = 8) =>
  useQuery({
    queryKey: ['hotels', 'trending', limit],
    queryFn: ({ signal }) => marketplaceApi.trending(limit, signal),
    staleTime: 60_000,
  });
export const useDestinations = () =>
  useQuery({
    queryKey: ['destinations'],
    queryFn: ({ signal }) => marketplaceApi.destinations(signal),
    staleTime: 300_000,
  });
export const useAmenities = () =>
  useQuery({
    queryKey: ['amenities'],
    queryFn: ({ signal }) => marketplaceApi.amenities(signal),
    staleTime: Infinity,
  });
export const useHotelDetail = (slug: string) =>
  useQuery({
    queryKey: ['hotel', slug],
    queryFn: ({ signal }) => marketplaceApi.detail(slug, signal),
  });
export const useSimilar = (slug: string) =>
  useQuery({
    queryKey: ['hotel', slug, 'similar'],
    queryFn: ({ signal }) => marketplaceApi.similar(slug, signal),
  });
export function useRoomOffers(slug: string, stay: StayParams | null) {
  return useQuery({
    queryKey: ['hotel', slug, 'offers', stay ? stayQuery(stay) : null],
    queryFn: ({ signal }) => marketplaceApi.offers(slug, stay!, signal),
    enabled: Boolean(stay),
    staleTime: 0,
  });
}
export function useSuggestions(q: string) {
  return useQuery({
    queryKey: ['suggestions', q],
    queryFn: ({ signal }) => marketplaceApi.suggestions(q, signal),
    enabled: q.trim().length >= 2,
    staleTime: 60_000,
  });
}
export function useCompare(ids: string[], stay: Partial<StayParams>) {
  return useQuery({
    queryKey: ['compare', ids.join(','), stay.checkIn, stay.checkOut, stay.adults, stay.rooms],
    queryFn: ({ signal }) => marketplaceApi.compare(ids, stay, signal),
    enabled: ids.length > 0,
  });
}

/** Saved stays for signed-in users; anonymous users are prompted to sign in. */
export function useWishlist() {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const ids = useQuery({
    queryKey: ['wishlist', 'ids'],
    queryFn: ({ signal }) => marketplaceApi.wishlistIds(signal),
    enabled: isAuthenticated,
  });
  const toggle = useMutation({
    mutationFn: async ({ id, saved }: { id: string; saved: boolean }) =>
      saved ? marketplaceApi.unsave(id) : marketplaceApi.save(id),
    onMutate: async ({ id, saved }) => {
      await queryClient.cancelQueries({ queryKey: ['wishlist', 'ids'] });
      const previous = queryClient.getQueryData<string[]>(['wishlist', 'ids']) ?? [];
      queryClient.setQueryData(
        ['wishlist', 'ids'],
        saved ? previous.filter((x) => x !== id) : [...previous, id],
      );
      return { previous };
    },
    onError: (_e, _v, context) =>
      queryClient.setQueryData(['wishlist', 'ids'], context?.previous ?? []),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['wishlist'] }),
  });
  return { isAuthenticated, ids: new Set(ids.data ?? []), toggle };
}
