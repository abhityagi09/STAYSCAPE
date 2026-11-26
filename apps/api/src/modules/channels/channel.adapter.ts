import { createHmac, timingSafeEqual } from 'node:crypto';
import { Schema, model, type Types } from 'mongoose';
import { z } from 'zod';

/** A provider-independent inbound event. */
export interface NormalizedChannelEvent {
  externalEventId: string;
  type: 'RESERVATION_CREATED' | 'RESERVATION_CANCELLED';
  externalRef: string;
  externalRoomCode: string;
  checkIn: string;
  checkOut: string;
  rooms: number;
}
export interface AvailabilityPush {
  externalRoomCode: string;
  date: string;
  available: number;
  stopSell: boolean;
}

export class ChannelPayloadError extends Error {}
export class ChannelDeliveryError extends Error {}

/**
 * Contract every channel-manager adapter implements (see channel.contract.test.ts). A real
 * provider (SiteMinder, STAAH, Channex, …) needs its own adapter written against its documented
 * API and credentials; none is included because none has been integrated or verified.
 */
export interface ChannelAdapter {
  readonly provider: string;
  /** True only for adapters exercised against the provider's real API. */
  readonly verifiedAgainstProvider: boolean;
  verifySignature(raw: Buffer, headers: Record<string, string | undefined>, secret: string, now?: Date): boolean;
  parse(raw: Buffer): NormalizedChannelEvent[];
  pushAvailability(connectionId: string, secret: string, days: AvailabilityPush[]): Promise<void>;
}

// ------------------------------------------------------------------ local simulator (dev/test)
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const simulatorPayload = z.strictObject({
  events: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(100),
        type: z.enum(['reservation.created', 'reservation.cancelled']),
        reservationId: z.string().min(1).max(100),
        roomCode: z.string().min(1).max(60),
        checkIn: date,
        checkOut: date,
        rooms: z.number().int().min(1).max(50),
      }),
    )
    .min(1)
    .max(100),
});

/** Outbound pushes from the simulator are stored here so they can be inspected (no network). */
interface SimulatorInboxAttrs {
  connectionId: Types.ObjectId;
  days: AvailabilityPush[];
  receivedAt: Date;
}
const inboxSchema = new Schema<SimulatorInboxAttrs>({ connectionId: { type: Schema.Types.ObjectId, required: true }, days: { type: Schema.Types.Mixed, required: true }, receivedAt: { type: Date, default: () => new Date() } }, { versionKey: false });
inboxSchema.index({ receivedAt: 1 }, { expireAfterSeconds: 7 * 86_400, name: 'ttl' });
export const ChannelSimulatorInboxModel = model<SimulatorInboxAttrs>('ChannelSimulatorInbox', inboxSchema);

export const SIGNATURE_HEADER = 'x-stayscape-channel-signature';
const TOLERANCE_S = 300;
export function signSimulatorPayload(raw: Buffer | string, secret: string, now = new Date()) {
  const t = Math.floor(now.getTime() / 1000);
  const v1 = createHmac('sha256', secret).update(`${t}.`).update(raw).digest('hex');
  return `t=${t},v1=${v1}`;
}

/**
 * LOCAL SIMULATOR — a development/test stand-in for a channel manager. Webhooks are signed with
 * HMAC-SHA256 over "timestamp.body" (5-minute replay window); availability pushes are recorded
 * locally. It is refused in production.
 */
export class LocalSimulatorAdapter implements ChannelAdapter {
  readonly provider = 'LOCAL_SIMULATOR';
  readonly verifiedAgainstProvider = false;
  failNextPushes = 0;

  verifySignature(raw: Buffer, headers: Record<string, string | undefined>, secret: string, now = new Date()) {
    const header = headers[SIGNATURE_HEADER];
    const m = header ? /^t=(\d+),v1=([a-f0-9]{64})$/.exec(header) : null;
    if (!m) return false;
    const t = Number(m[1]);
    if (Math.abs(now.getTime() / 1000 - t) > TOLERANCE_S) return false;
    const expected = Buffer.from(createHmac('sha256', secret).update(`${t}.`).update(raw).digest('hex'), 'hex');
    const given = Buffer.from(m[2]!, 'hex');
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  parse(raw: Buffer): NormalizedChannelEvent[] {
    let json: unknown;
    try {
      json = JSON.parse(raw.toString('utf8'));
    } catch {
      throw new ChannelPayloadError('Body is not valid JSON');
    }
    const parsed = simulatorPayload.safeParse(json);
    if (!parsed.success) throw new ChannelPayloadError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    return parsed.data.events.map((e) => {
      if (e.checkOut <= e.checkIn) throw new ChannelPayloadError(`Event ${e.id}: check-out must be after check-in`);
      return { externalEventId: e.id, type: e.type === 'reservation.created' ? 'RESERVATION_CREATED' : 'RESERVATION_CANCELLED', externalRef: e.reservationId, externalRoomCode: e.roomCode, checkIn: e.checkIn, checkOut: e.checkOut, rooms: e.rooms };
    });
  }

  async pushAvailability(connectionId: string, _secret: string, days: AvailabilityPush[]) {
    if (this.failNextPushes > 0) {
      this.failNextPushes -= 1;
      throw new ChannelDeliveryError('Simulated delivery failure');
    }
    await ChannelSimulatorInboxModel.create({ connectionId, days });
  }
}
