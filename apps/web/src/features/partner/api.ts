import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  HotelContentInput,
  ImageDto,
  InventoryDayDto,
  InventoryUpdateInput,
  PartnerApplicationDto,
  PartnerDocumentType,
  PartnerDraftInput,
  PartnerHotelDto,
  PartnerHotelSummaryDto,
  PartnerRoomTypeDto,
  PricingRuleDto,
  PricingRuleInput,
  QuoteDto,
  QuoteRequest,
  RatePlanDto,
  RatePlanInput,
  RoomTypeInput,
} from '@stayscape/shared';
import { http, unwrap } from '@/lib/api/client';

const base = (hotelId: string) => `/partner/hotels/${hotelId}`;

export const partnerApi = {
  application: (signal?: AbortSignal) =>
    unwrap<PartnerApplicationDto | null>(http.get('/partner/application', { signal })),
  saveDraft: (input: PartnerDraftInput) =>
    unwrap<PartnerApplicationDto>(http.put('/partner/application', input)),
  uploadDocument: (type: PartnerDocumentType, file: File) => {
    const form = new FormData();
    form.append('type', type);
    form.append('file', file);
    return unwrap<PartnerApplicationDto>(
      http.post('/partner/application/documents', form, { timeout: 60_000 }),
    );
  },
  removeDocument: (id: string) =>
    unwrap<PartnerApplicationDto>(http.delete(`/partner/application/documents/${id}`)),
  downloadDocument: (id: string) =>
    http.get<Blob>(`/partner/application/documents/${id}`, { responseType: 'blob' }),
  submit: () => unwrap<PartnerApplicationDto>(http.post('/partner/application/submit')),
  hotels: (signal?: AbortSignal) =>
    unwrap<PartnerHotelSummaryDto[]>(http.get('/partner/hotels', { signal })),
  hotel: (id: string, signal?: AbortSignal) =>
    unwrap<PartnerHotelDto>(http.get(base(id), { signal })),
  createHotel: (input: Partial<HotelContentInput>) =>
    unwrap<PartnerHotelDto>(http.post('/partner/hotels', input)),
  updateHotel: (id: string, input: Partial<HotelContentInput>) =>
    unwrap<PartnerHotelDto>(http.patch(base(id), input)),
  action: (id: string, action: 'submit' | 'publish' | 'unpublish' | 'archive') =>
    unwrap<PartnerHotelDto>(http.post(`${base(id)}/${action}`)),
  uploadImage: (id: string, file: File, purpose: 'HOTEL_IMAGE' | 'ROOM_IMAGE' = 'HOTEL_IMAGE') => {
    const form = new FormData();
    form.append('purpose', purpose);
    form.append('file', file);
    return unwrap<ImageDto>(http.post(`${base(id)}/media`, form, { timeout: 120_000 }));
  },
  deleteImage: (id: string, mediaId: string) => unwrap(http.delete(`${base(id)}/media/${mediaId}`)),
  roomTypes: (id: string, signal?: AbortSignal) =>
    unwrap<PartnerRoomTypeDto[]>(http.get(`${base(id)}/room-types`, { signal })),
  roomType: (id: string, roomId: string, signal?: AbortSignal) =>
    unwrap<PartnerRoomTypeDto>(http.get(`${base(id)}/room-types/${roomId}`, { signal })),
  saveRoomType: (id: string, roomId: string | null, input: RoomTypeInput) =>
    unwrap<PartnerRoomTypeDto>(
      roomId
        ? http.put(`${base(id)}/room-types/${roomId}`, input)
        : http.post(`${base(id)}/room-types`, input),
    ),
  deleteRoomType: (id: string, roomId: string) =>
    unwrap<{ archived: boolean }>(http.delete(`${base(id)}/room-types/${roomId}`)),
  ratePlans: (id: string, signal?: AbortSignal) =>
    unwrap<RatePlanDto[]>(http.get(`${base(id)}/rate-plans`, { signal })),
  saveRatePlan: (id: string, planId: string | null, input: RatePlanInput) =>
    unwrap<RatePlanDto>(
      planId
        ? http.put(`${base(id)}/rate-plans/${planId}`, input)
        : http.post(`${base(id)}/rate-plans`, input),
    ),
  deleteRatePlan: (id: string, planId: string) =>
    unwrap(http.delete(`${base(id)}/rate-plans/${planId}`)),
  rules: (id: string, signal?: AbortSignal) =>
    unwrap<PricingRuleDto[]>(http.get(`${base(id)}/pricing-rules`, { signal })),
  saveRule: (id: string, ruleId: string | null, input: PricingRuleInput) =>
    unwrap<PricingRuleDto>(
      ruleId
        ? http.put(`${base(id)}/pricing-rules/${ruleId}`, input)
        : http.post(`${base(id)}/pricing-rules`, input),
    ),
  deleteRule: (id: string, ruleId: string) =>
    unwrap(http.delete(`${base(id)}/pricing-rules/${ruleId}`)),
  inventory: (
    id: string,
    q: { roomTypeId: string; from: string; to: string },
    signal?: AbortSignal,
  ) => unwrap<InventoryDayDto[]>(http.get(`${base(id)}/inventory`, { params: q, signal })),
  updateInventory: (id: string, input: InventoryUpdateInput) =>
    unwrap<InventoryDayDto[]>(http.patch(`${base(id)}/inventory`, input)),
  quotePreview: (id: string, input: Omit<QuoteRequest, 'hotelId'>) =>
    unwrap<QuoteDto>(http.post(`${base(id)}/quote-preview`, input)),
};

export const partnerKeys = {
  application: ['partner', 'application'] as const,
  hotels: ['partner', 'hotels'] as const,
  hotel: (id: string) => ['partner', 'hotel', id] as const,
  rooms: (id: string) => ['partner', 'hotel', id, 'rooms'] as const,
  rates: (id: string) => ['partner', 'hotel', id, 'rates'] as const,
  rules: (id: string) => ['partner', 'hotel', id, 'rules'] as const,
};

export const useApplication = () =>
  useQuery({
    queryKey: partnerKeys.application,
    queryFn: ({ signal }) => partnerApi.application(signal),
  });
export const usePartnerHotels = (enabled = true) =>
  useQuery({
    queryKey: partnerKeys.hotels,
    queryFn: ({ signal }) => partnerApi.hotels(signal),
    enabled,
  });
export const usePartnerHotel = (id: string) =>
  useQuery({
    queryKey: partnerKeys.hotel(id),
    queryFn: ({ signal }) => partnerApi.hotel(id, signal),
    enabled: Boolean(id),
  });
export const useRoomTypes = (id: string) =>
  useQuery({
    queryKey: partnerKeys.rooms(id),
    queryFn: ({ signal }) => partnerApi.roomTypes(id, signal),
    enabled: Boolean(id),
  });
export const useRatePlans = (id: string) =>
  useQuery({
    queryKey: partnerKeys.rates(id),
    queryFn: ({ signal }) => partnerApi.ratePlans(id, signal),
    enabled: Boolean(id),
  });
export const usePricingRules = (id: string) =>
  useQuery({
    queryKey: partnerKeys.rules(id),
    queryFn: ({ signal }) => partnerApi.rules(id, signal),
    enabled: Boolean(id),
  });

export function useApplicationMutation<T>(fn: (input: T) => Promise<PartnerApplicationDto>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data) => qc.setQueryData(partnerKeys.application, data),
  });
}

export function useHotelMutation<T>(hotelId: string, fn: (input: T) => Promise<PartnerHotelDto>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data) => {
      qc.setQueryData(partnerKeys.hotel(hotelId), data);
      void qc.invalidateQueries({ queryKey: partnerKeys.hotels });
    },
  });
}

export function useInvalidateHotel(hotelId: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['partner', 'hotel', hotelId] });
}
