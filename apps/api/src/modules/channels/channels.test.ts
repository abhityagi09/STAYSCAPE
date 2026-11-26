import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { bearer } from '@/test/helpers';
import { daysFromToday } from '@/test/marketplace-fixtures';
import { bookingWorld, createHold, holdBody } from '@/test/booking-fixtures';
import {
  ChannelSimulatorInboxModel,
  LocalSimulatorAdapter,
  SIGNATURE_HEADER,
  signSimulatorPayload,
  type ChannelAdapter,
} from './channel.adapter';
import { ChannelEventModel } from './channels.service';

/** Contract every adapter must satisfy. A real provider's adapter gets the same suite plus its own fixtures. */
function adapterContract(
  name: string,
  adapter: ChannelAdapter,
  sign: (raw: Buffer, secret: string, now?: Date) => Record<string, string>,
  sample: Buffer,
) {
  describe(`${name} adapter contract`, () => {
    it('accepts only correctly signed, fresh payloads', () => {
      expect(adapter.verifySignature(sample, sign(sample, 's3cret'), 's3cret')).toBe(true);
      expect(adapter.verifySignature(sample, sign(sample, 'other'), 's3cret')).toBe(false);
      expect(
        adapter.verifySignature(
          Buffer.from(sample.toString() + ' '),
          sign(sample, 's3cret'),
          's3cret',
        ),
      ).toBe(false);
      expect(
        adapter.verifySignature(
          sample,
          sign(sample, 's3cret', new Date(Date.now() - 3_600_000)),
          's3cret',
        ),
      ).toBe(false);
      expect(adapter.verifySignature(sample, {}, 's3cret')).toBe(false);
    });
    it('normalises events and rejects malformed payloads', () => {
      const events = adapter.parse(sample);
      expect(events.length).toBeGreaterThan(0);
      for (const e of events)
        expect(e).toEqual(
          expect.objectContaining({
            externalEventId: expect.any(String),
            type: expect.stringMatching(/^RESERVATION_(CREATED|CANCELLED)$/),
            rooms: expect.any(Number),
          }),
        );
      expect(() => adapter.parse(Buffer.from('not json'))).toThrow();
      expect(() => adapter.parse(Buffer.from('{"events":[]}'))).toThrow();
    });
  });
}

const simulatorEvent = (
  id: string,
  type: 'reservation.created' | 'reservation.cancelled',
  ref: string,
  checkIn: string,
  checkOut: string,
  rooms = 1,
  roomCode = 'DLX',
) => ({ id, type, reservationId: ref, roomCode, checkIn, checkOut, rooms });
adapterContract(
  'Local simulator',
  new LocalSimulatorAdapter(),
  (raw, secret, now) => ({ [SIGNATURE_HEADER]: signSimulatorPayload(raw, secret, now) }),
  Buffer.from(
    JSON.stringify({
      events: [simulatorEvent('e1', 'reservation.created', 'R1', '2030-01-01', '2030-01-03')],
    }),
  ),
);

describe('channel manager integration', () => {
  it('applies signed, idempotent external reservations, detects overbooking, logs errors and syncs availability', async () => {
    const { app, owner, hotel, customer, container } = await bookingWorld(); // 5 rooms
    const base = `/api/v1/partner/hotels/${hotel.hotelId}/channels`;
    const conn = (
      await request(app)
        .post(base)
        .set(bearer(owner.accessToken))
        .send({ provider: 'LOCAL_SIMULATOR', name: 'Local test channel' })
        .expect(201)
    ).body.data;
    expect(conn).toMatchObject({ verifiedIntegration: false, webhookSecret: expect.any(String) });
    expect(
      (await request(app).get(base).set(bearer(owner.accessToken)).expect(200)).body.data[0],
    ).not.toHaveProperty('webhookSecret');
    await request(app)
      .post(base)
      .set(bearer(owner.accessToken))
      .send({ provider: 'LOCAL_SIMULATOR', name: 'again' })
      .expect(409);
    await request(app)
      .post(base)
      .set(bearer(owner.accessToken))
      .send({ provider: 'SITEMINDER', name: 'x' })
      .expect(422);

    const hook = (events: unknown[], secret = conn.webhookSecret as string) => {
      const raw = JSON.stringify({ events });
      return request(app)
        .post(conn.webhookPath)
        .set('Content-Type', 'application/json')
        .set(SIGNATURE_HEADER, signSimulatorPayload(raw, secret))
        .send(raw);
    };
    const [d1, d3] = [daysFromToday(20), daysFromToday(22)];
    // Unmapped room code → logged as FAILED (retryable), nothing applied.
    expect(
      (await hook([simulatorEvent('ev-1', 'reservation.created', 'OTA-1', d1, d3, 2)]).expect(200))
        .body.data,
    ).toEqual({ accepted: 1, duplicates: 0 });
    expect(await ChannelEventModel.findOne({ externalEventId: 'ev-1' }).lean()).toMatchObject({
      status: 'FAILED',
      error: expect.stringMatching(/not mapped/),
    });

    await request(app)
      .patch(`${base}/${conn.id}`)
      .set(bearer(owner.accessToken))
      .send({ mappings: [{ roomTypeId: hotel.roomTypeId, externalRoomCode: 'DLX' }] })
      .expect(200);
    const failed = (await ChannelEventModel.findOne({ externalEventId: 'ev-1' }).lean())!;
    expect(
      (
        await request(app)
          .post(`${base}/${conn.id}/events/${failed._id.toString()}/retry`)
          .set(bearer(owner.accessToken))
          .expect(200)
      ).body.data.status,
    ).toBe('PROCESSED');
    const cal = async () =>
      (
        await request(app)
          .get(
            `/api/v1/partner/hotels/${hotel.hotelId}/inventory?roomTypeId=${hotel.roomTypeId}&from=${d1}&to=${d1}`,
          )
          .set(bearer(owner.accessToken))
          .expect(200)
      ).body.data[0];
    expect(await cal()).toMatchObject({ available: 3 });

    // Replays and forged requests change nothing.
    expect(
      (await hook([simulatorEvent('ev-1', 'reservation.created', 'OTA-1', d1, d3, 2)]).expect(200))
        .body.data,
    ).toEqual({ accepted: 0, duplicates: 1 });
    await hook(
      [simulatorEvent('ev-x', 'reservation.created', 'OTA-X', d1, d3, 1)],
      'wrong-secret',
    ).expect(401);
    expect(await cal()).toMatchObject({ available: 3 });

    // A Stayscape hold takes 1 more room; the channel then sells 3 → conflict, nothing applied.
    expect(
      (await createHold(app, customer, holdBody(hotel, d1, d3, { rooms: 2, adults: 2 }))).status,
    ).toBe(201);
    await hook([simulatorEvent('ev-2', 'reservation.created', 'OTA-2', d1, d3, 3)]).expect(200);
    expect(await ChannelEventModel.findOne({ externalEventId: 'ev-2' }).lean()).toMatchObject({
      status: 'CONFLICT',
      conflictDates: [d1, daysFromToday(21)],
    });
    expect(await cal()).toMatchObject({ available: 1 });

    // Cancellation on the channel returns the rooms (and is idempotent).
    await hook([simulatorEvent('ev-3', 'reservation.cancelled', 'OTA-1', d1, d3, 2)]).expect(200);
    await hook([simulatorEvent('ev-4', 'reservation.cancelled', 'OTA-1', d1, d3, 2)]).expect(200);
    expect(await cal()).toMatchObject({ available: 3 });
    const log = (
      await request(app).get(`${base}/${conn.id}/events`).set(bearer(owner.accessToken)).expect(200)
    ).body.data.items;
    expect(log.map((e: { status: string }) => e.status).sort()).toEqual([
      'CONFLICT',
      'PROCESSED',
      'PROCESSED',
      'PROCESSED',
    ]);

    // Outbound sync: failures are recorded and retried with backoff; success records what was sent.
    const adapter = (
      container.services.channels as unknown as { adapters: Map<string, LocalSimulatorAdapter> }
    ).adapters.get('LOCAL_SIMULATOR')!;
    adapter.failNextPushes = 1;
    expect(
      (
        await request(app)
          .post(`${base}/${conn.id}/sync`)
          .set(bearer(owner.accessToken))
          .expect(200)
      ).body.data,
    ).toMatchObject({ syncStatus: 'ERROR', lastError: 'Simulated delivery failure' });
    expect(
      (
        await request(app)
          .post(`${base}/${conn.id}/sync`)
          .set(bearer(owner.accessToken))
          .expect(200)
      ).body.data,
    ).toMatchObject({ syncStatus: 'OK', lastError: null });
    const pushed = (await ChannelSimulatorInboxModel.findOne().lean())!;
    expect(pushed.days).toHaveLength(30);
    expect(pushed.days.find((d) => d.date === d1)).toMatchObject({
      externalRoomCode: 'DLX',
      available: 3,
    });

    // Secret rotation invalidates the old secret.
    const { webhookSecret } = (
      await request(app)
        .post(`${base}/${conn.id}/rotate-secret`)
        .set(bearer(owner.accessToken))
        .expect(200)
    ).body.data;
    await hook([simulatorEvent('ev-5', 'reservation.created', 'OTA-5', d1, d3, 1)]).expect(401);
    await hook(
      [simulatorEvent('ev-5', 'reservation.created', 'OTA-5', d1, d3, 1)],
      webhookSecret,
    ).expect(200);
  });
});
