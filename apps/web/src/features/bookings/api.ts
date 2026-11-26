import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BookingDetailDto,
  BookingSummaryDto,
  CancellationQuoteDto,
  CancellationResultDto,
  CheckoutConfigDto,
  CustomerOverviewDto,
  GuestDetailsInput,
  HoldDto,
  MyReviewDto,
  Paginated,
  PaymentDto,
  PaymentVerificationDto,
  PublicReviewDto,
  RefundDto,
  ReviewEligibilityDto,
  ReviewInput,
  ReviewSummaryDto,
  SandboxCompletionDto,
  SharedWishlistDto,
  TicketDto,
  WishlistDetailDto,
  WishlistSummaryDto,
  ImageDto,
  BookingStatus,
  OperationsOverviewDto,
  PartnerBookingDto,
  PartnerBookingDetailDto,
  PartnerReviewDto,
} from '@stayscape/shared';
import { API_BASE_URL, http, unwrap } from '@/lib/api/client';

/** A fresh key per user action; stored by callers when a retry must reuse it. */
export const newIdempotencyKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const withKey = (key: string) => ({ headers: { 'Idempotency-Key': key } });

/**
 * Remember an idempotency key per logical operation (e.g. "hold for this quote") in session
 * storage, so a page refresh or retry after a timeout replays the same request.
 */
export function stickyKey(scope: string): string {
  const name = `stayscape.idem.${scope}`;
  try {
    const existing = sessionStorage.getItem(name);
    if (existing) return existing;
    const key = newIdempotencyKey();
    sessionStorage.setItem(name, key);
    return key;
  } catch {
    return newIdempotencyKey();
  }
}

export interface HoldRequest {
  hotelId: string;
  checkIn: string;
  checkOut: string;
  items: Array<{
    roomTypeId: string;
    ratePlanId: string;
    rooms: number;
    adults: number;
    childrenAges: number[];
    extraBeds: number;
  }>;
}

export const bookingsApi = {
  createHold: (body: HoldRequest, key: string) =>
    unwrap<HoldDto>(http.post('/bookings/holds', body, withKey(key))),
  hold: (reference: string) => unwrap<HoldDto>(http.get(`/bookings/holds/${reference}`)),
  releaseHold: (reference: string) => unwrap<HoldDto>(http.delete(`/bookings/holds/${reference}`)),
  applyHoldCoupon: (reference: string, code: string) =>
    unwrap<HoldDto>(http.put(`/bookings/holds/${reference}/coupon`, { code })),
  removeHoldCoupon: (reference: string) =>
    unwrap<HoldDto>(http.delete(`/bookings/holds/${reference}/coupon`)),
  createBooking: (
    body: { holdReference: string; guestDetails: GuestDetailsInput; acceptTerms: true },
    key: string,
  ) => unwrap<BookingDetailDto>(http.post('/bookings', body, withKey(key))),
  list: (
    params: {
      page: number;
      view: string;
      status?: BookingStatus | undefined;
      q?: string | undefined;
    },
    signal?: AbortSignal,
  ) =>
    unwrap<Paginated<BookingSummaryDto>>(
      http.get('/bookings', { params: { ...params, limit: 10 }, signal }),
    ),
  detail: (reference: string, signal?: AbortSignal) =>
    unwrap<BookingDetailDto>(http.get(`/bookings/${reference}`, { signal })),
  cancellationQuote: (reference: string) =>
    unwrap<CancellationQuoteDto>(http.get(`/bookings/${reference}/cancellation`)),
  cancel: (reference: string, reason: string, key: string) =>
    unwrap<CancellationResultDto>(
      http.post(`/bookings/${reference}/cancel`, { reason }, withKey(key)),
    ),
  requestRefund: (reference: string, reason: string) =>
    unwrap<RefundDto>(http.post(`/bookings/${reference}/refund-requests`, { reason })),
  createOrder: (reference: string, key: string) =>
    unwrap<CheckoutConfigDto>(http.post(`/bookings/${reference}/payments`, {}, withKey(key))),
  verify: (
    reference: string,
    body: { providerOrderId: string; providerPaymentId: string; signature: string },
  ) => unwrap<PaymentVerificationDto>(http.post(`/bookings/${reference}/payments/verify`, body)),
  sandboxComplete: (reference: string, outcome: 'success' | 'failure') =>
    unwrap<SandboxCompletionDto>(
      http.post(`/bookings/${reference}/payments/sandbox-complete`, {
        outcome,
        deliverWebhook: true,
      }),
    ),
  overview: (signal?: AbortSignal) =>
    unwrap<CustomerOverviewDto>(http.get('/account/overview', { signal })),
  payments: (signal?: AbortSignal) =>
    unwrap<PaymentDto[]>(http.get('/account/payments', { signal })),
  refunds: (signal?: AbortSignal) => unwrap<RefundDto[]>(http.get('/account/refunds', { signal })),
  myReviews: (signal?: AbortSignal) =>
    unwrap<MyReviewDto[]>(http.get('/account/reviews', { signal })),
  eligibleReviews: (signal?: AbortSignal) =>
    unwrap<ReviewEligibilityDto[]>(http.get('/account/reviews/eligible', { signal })),
  createReview: (reference: string, body: ReviewInput) =>
    unwrap<MyReviewDto>(http.post(`/bookings/${reference}/review`, body)),
  updateReview: (id: string, body: ReviewInput) =>
    unwrap<MyReviewDto>(http.put(`/reviews/${id}`, body)),
  uploadReviewPhoto: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return unwrap<ImageDto>(http.post('/reviews/photos', form));
  },
  reportReview: (id: string, reason: string, details: string) =>
    unwrap<{ message: string }>(http.post(`/reviews/${id}/report`, { reason, details })),
  hotelReviews: (slug: string, page: number, sort: string, signal?: AbortSignal) =>
    unwrap<Paginated<PublicReviewDto> & { summary: ReviewSummaryDto }>(
      http.get(`/hotels/${encodeURIComponent(slug)}/reviews`, {
        params: { page, sort, limit: 5 },
        signal,
      }),
    ),
};

/** Download an authenticated file (PDF) and hand it to the browser. */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const response = await http.get<Blob>(path, { responseType: 'blob' });
  const disposition = String(response.headers?.['content-disposition'] ?? '');
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(response.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const documentUrl = (reference: string, kind: 'invoice' | 'confirmation') =>
  `${API_BASE_URL}/bookings/${reference}/documents/${kind}`;

export const useBookingDetail = (reference: string | null, options: { poll?: boolean } = {}) =>
  useQuery({
    queryKey: ['booking', reference],
    queryFn: ({ signal }) => bookingsApi.detail(reference!, signal),
    enabled: Boolean(reference),
    // While payment is being confirmed out of band (webhook), poll briefly.
    refetchInterval: (q) =>
      options.poll &&
      q.state.data &&
      ['PAYMENT_PROCESSING', 'PENDING_PAYMENT'].includes(q.state.data.status) &&
      q.state.data.paymentStatus !== 'FAILED'
        ? 2000
        : false,
  });

export const useBookings = (params: {
  page: number;
  view: string;
  status?: BookingStatus | undefined;
  q?: string | undefined;
}) =>
  useQuery({
    queryKey: ['bookings', params],
    queryFn: ({ signal }) => bookingsApi.list(params, signal),
    placeholderData: keepPreviousData,
  });

export const useOverview = () =>
  useQuery({
    queryKey: ['account', 'overview'],
    queryFn: ({ signal }) => bookingsApi.overview(signal),
  });
export const usePayments = () =>
  useQuery({
    queryKey: ['account', 'payments'],
    queryFn: ({ signal }) => bookingsApi.payments(signal),
  });
export const useRefunds = () =>
  useQuery({
    queryKey: ['account', 'refunds'],
    queryFn: ({ signal }) => bookingsApi.refunds(signal),
  });
export const useMyReviews = () =>
  useQuery({
    queryKey: ['account', 'reviews'],
    queryFn: ({ signal }) => bookingsApi.myReviews(signal),
  });
export const useEligibleReviews = () =>
  useQuery({
    queryKey: ['account', 'reviews', 'eligible'],
    queryFn: ({ signal }) => bookingsApi.eligibleReviews(signal),
  });
export const useHotelReviews = (slug: string, page: number, sort: string) =>
  useQuery({
    queryKey: ['hotel', slug, 'reviews', page, sort],
    queryFn: ({ signal }) => bookingsApi.hotelReviews(slug, page, sort, signal),
    placeholderData: keepPreviousData,
  });

export function useInvalidateBooking() {
  const qc = useQueryClient();
  return (reference: string) => {
    void qc.invalidateQueries({ queryKey: ['booking', reference] });
    void qc.invalidateQueries({ queryKey: ['bookings'] });
    void qc.invalidateQueries({ queryKey: ['account'] });
  };
}

// ---------------------------------------------------------------- wishlists
export const wishlistsApi = {
  list: (signal?: AbortSignal) => unwrap<WishlistSummaryDto[]>(http.get('/wishlists', { signal })),
  detail: (id: string, stay: { checkIn?: string; checkOut?: string }, signal?: AbortSignal) =>
    unwrap<WishlistDetailDto>(
      http.get(`/wishlists/${id}`, { params: stay.checkIn ? stay : {}, signal }),
    ),
  create: (name: string) => unwrap<WishlistSummaryDto>(http.post('/wishlists', { name })),
  rename: (id: string, name: string) =>
    unwrap<WishlistSummaryDto>(http.patch(`/wishlists/${id}`, { name })),
  remove: (id: string) => unwrap<{ message: string }>(http.delete(`/wishlists/${id}`)),
  saveItem: (id: string, hotelId: string, note: string) =>
    unwrap<{ message: string }>(http.put(`/wishlists/${id}/items/${hotelId}`, { note })),
  removeItem: (id: string, hotelId: string) =>
    unwrap<{ message: string }>(http.delete(`/wishlists/${id}/items/${hotelId}`)),
  share: (id: string) => unwrap<{ shareUrl: string }>(http.post(`/wishlists/${id}/share`, {})),
  unshare: (id: string) => unwrap<{ message: string }>(http.delete(`/wishlists/${id}/share`)),
  shared: (token: string, signal?: AbortSignal) =>
    unwrap<SharedWishlistDto>(http.get(`/wishlists/shared/${token}`, { signal })),
};

export function useWishlistMutation<T>(fn: (arg: T) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['wishlists'] });
      void qc.invalidateQueries({ queryKey: ['wishlist'] });
    },
  });
}

// ---------------------------------------------------------------- support
export const supportApi = {
  list: (signal?: AbortSignal) => unwrap<TicketDto[]>(http.get('/support/tickets', { signal })),
  detail: (id: string, signal?: AbortSignal) =>
    unwrap<TicketDto>(http.get(`/support/tickets/${id}`, { signal })),
  create: (form: FormData) => unwrap<TicketDto>(http.post('/support/tickets', form)),
  reply: (id: string, form: FormData) =>
    unwrap<TicketDto>(http.post(`/support/tickets/${id}/messages`, form)),
  close: (id: string) => unwrap<TicketDto>(http.post(`/support/tickets/${id}/close`, {})),
};

// ---------------------------------------------------------------- partner & admin
export const partnerBookingsApi = {
  list: (
    hotelId: string,
    view: string,
    page: number,
    signal?: AbortSignal,
    filters: { q?: string; status?: string; from?: string; to?: string } = {},
  ) =>
    unwrap<Paginated<PartnerBookingDto>>(
      http.get(`/partner/hotels/${hotelId}/bookings`, {
        params: Object.fromEntries(
          Object.entries({ view, page, ...filters }).filter(([, v]) => v !== undefined && v !== ''),
        ),
        signal,
      }),
    ),
  detail: (hotelId: string, reference: string, signal?: AbortSignal) =>
    unwrap<PartnerBookingDetailDto>(
      http.get(`/partner/hotels/${hotelId}/bookings/${reference}`, { signal }),
    ),
  addNote: (hotelId: string, reference: string, body: string) =>
    unwrap<unknown>(http.post(`/partner/hotels/${hotelId}/bookings/${reference}/notes`, { body })),
  assignRooms: (
    hotelId: string,
    reference: string,
    assignments: Array<{ roomTypeId: string; roomNumbers: string[] }>,
  ) =>
    unwrap<unknown>(
      http.put(`/partner/hotels/${hotelId}/bookings/${reference}/rooms`, { assignments }),
    ),
  act: (
    hotelId: string,
    reference: string,
    action: 'check-in' | 'check-out' | 'no-show' | 'reject',
    body: object = {},
  ) =>
    unwrap<PartnerBookingDto>(
      http.post(`/partner/hotels/${hotelId}/bookings/${reference}/${action}`, body),
    ),
  reviews: (hotelId: string, signal?: AbortSignal) =>
    unwrap<PartnerReviewDto[]>(http.get(`/partner/hotels/${hotelId}/reviews`, { signal })),
  respond: (hotelId: string, reviewId: string, body: string) =>
    unwrap<{ message: string }>(
      http.put(`/partner/hotels/${hotelId}/reviews/${reviewId}/response`, { body }),
    ),
};

export const operationsApi = {
  overview: (signal?: AbortSignal) =>
    unwrap<OperationsOverviewDto>(http.get('/admin/operations', { signal })),
  retryRefund: (id: string) => unwrap<RefundDto>(http.post(`/admin/refunds/${id}/retry`, {})),
  decideRefund: (
    id: string,
    body: { decision: 'APPROVE'; amountMinor: number } | { decision: 'REJECT'; reason: string },
  ) => unwrap<RefundDto>(http.post(`/admin/refunds/${id}/decision`, body)),
  retryDelivery: (id: string) =>
    unwrap<{ message: string }>(http.post(`/admin/notifications/deliveries/${id}/retry`, {})),
  moderate: (id: string, decision: 'REMOVE' | 'RESTORE' | 'DISMISS_REPORTS', reason: string) =>
    unwrap<{ message: string }>(http.post(`/admin/reviews/${id}/moderation`, { decision, reason })),
};
