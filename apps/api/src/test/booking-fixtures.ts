import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import type { BookingDetailDto, CheckoutConfigDto, HoldDto } from '@stayscape/shared';
import type { SandboxPaymentProvider } from '@/modules/payments/providers/sandbox.provider';
import {
  bearer,
  createTestContext,
  registerUser,
  type SignedInUser,
  type TestContext,
} from './helpers';
import {
  createAdmin,
  createApprovedPartner,
  createPublishedHotel,
  daysFromToday,
  type PublishedHotel,
} from './marketplace-fixtures';

export const idem = (key = `test-${randomUUID()}`) => ({ 'Idempotency-Key': key });

export interface BookingWorld extends TestContext {
  admin: SignedInUser;
  owner: SignedInUser & { partnerId: string };
  hotel: PublishedHotel;
  customer: SignedInUser;
  sandbox: SandboxPaymentProvider;
}

/** A published hotel (5 rooms, ₹5,000/night, no taxes unless overridden) and a signed-in customer. */
export async function bookingWorld(
  overrides: {
    room?: Record<string, unknown>;
    rate?: Record<string, unknown>;
    content?: Record<string, unknown>;
  } = {},
): Promise<BookingWorld> {
  const ctx = createTestContext();
  const admin = await createAdmin(ctx.app);
  const owner = await createApprovedPartner(ctx.app, admin);
  const hotel = await createPublishedHotel(ctx.app, owner, admin, overrides);
  const customer = await registerUser(ctx.app);
  return {
    ...ctx,
    admin,
    owner,
    hotel,
    customer,
    sandbox: ctx.container.services.paymentProvider as SandboxPaymentProvider,
  };
}

export function holdBody(
  hotel: PublishedHotel,
  checkIn: string,
  checkOut: string,
  item: Record<string, unknown> = {},
) {
  return {
    hotelId: hotel.hotelId,
    checkIn,
    checkOut,
    items: [
      {
        roomTypeId: hotel.roomTypeId,
        ratePlanId: hotel.ratePlanId,
        rooms: 1,
        adults: 2,
        childrenAges: [],
        extraBeds: 0,
        ...item,
      },
    ],
  };
}

export const guestDetails = {
  primaryGuest: {
    firstName: 'Meera',
    lastName: 'Iyer',
    email: 'meera@example.com',
    phone: '+919811111111',
  },
  additionalGuests: [{ firstName: 'Arjun', lastName: 'Iyer' }],
  specialRequests: 'Late arrival, around 22:00',
  estimatedArrivalTime: '22:00',
};

export async function createHold(app: Express, user: SignedInUser, body: object, key?: string) {
  return request(app)
    .post('/api/v1/bookings/holds')
    .set(bearer(user.accessToken))
    .set(idem(key))
    .send(body);
}

export async function holdAndBook(
  app: Express,
  user: SignedInUser,
  hotel: PublishedHotel,
  nights: [number, number] = [10, 12],
  item: Record<string, unknown> = {},
): Promise<{ hold: HoldDto; booking: BookingDetailDto }> {
  const held = await createHold(
    app,
    user,
    holdBody(hotel, daysFromToday(nights[0]), daysFromToday(nights[1]), item),
  );
  if (held.status !== 201)
    throw new Error(`hold failed: ${held.status} ${JSON.stringify(held.body)}`);
  const booked = await request(app)
    .post('/api/v1/bookings')
    .set(bearer(user.accessToken))
    .set(idem())
    .send({ holdReference: held.body.data.reference, guestDetails, acceptTerms: true })
    .expect(201);
  return { hold: held.body.data as HoldDto, booking: booked.body.data as BookingDetailDto };
}

export async function startPayment(
  app: Express,
  user: SignedInUser,
  reference: string,
): Promise<CheckoutConfigDto> {
  const res = await request(app)
    .post(`/api/v1/bookings/${reference}/payments`)
    .set(bearer(user.accessToken))
    .set(idem());
  if (res.status !== 201)
    throw new Error(`order failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data as CheckoutConfigDto;
}

/** The guest completes the (sandbox) hosted checkout; no webhook unless asked. */
export async function sandboxPay(
  app: Express,
  user: SignedInUser,
  reference: string,
  outcome: 'success' | 'failure' = 'success',
) {
  const res = await request(app)
    .post(`/api/v1/bookings/${reference}/payments/sandbox-complete`)
    .set(bearer(user.accessToken))
    .send({ outcome, deliverWebhook: false })
    .expect(200);
  return res.body.data as { providerOrderId: string; providerPaymentId: string; signature: string };
}

export function verify(
  app: Express,
  user: SignedInUser,
  reference: string,
  payload: { providerOrderId: string; providerPaymentId: string; signature: string },
) {
  return request(app)
    .post(`/api/v1/bookings/${reference}/payments/verify`)
    .set(bearer(user.accessToken))
    .send(payload);
}

/** Full happy path: order → sandbox checkout → signature verification. */
export async function payInFull(
  app: Express,
  user: SignedInUser,
  reference: string,
): Promise<BookingDetailDto> {
  await startPayment(app, user, reference);
  const completion = await sandboxPay(app, user, reference);
  const res = await verify(app, user, reference, completion).expect(200);
  return res.body.data.booking as BookingDetailDto;
}

export function deliverWebhook(
  app: Express,
  sandbox: SandboxPaymentProvider,
  event: string,
  entity: Parameters<SandboxPaymentProvider['buildWebhook']>[1],
  eventId?: string,
) {
  const hook = sandbox.buildWebhook(event, entity, eventId);
  return request(app)
    .post('/api/v1/payments/webhooks/razorpay')
    .set('Content-Type', 'application/json')
    .set('X-Razorpay-Signature', hook.signature)
    .set('X-Razorpay-Event-Id', hook.eventId)
    .send(hook.body.toString('utf8'));
}

export async function getBooking(
  app: Express,
  user: SignedInUser,
  reference: string,
): Promise<BookingDetailDto> {
  return (
    await request(app)
      .get(`/api/v1/bookings/${reference}`)
      .set(bearer(user.accessToken))
      .expect(200)
  ).body.data as BookingDetailDto;
}
