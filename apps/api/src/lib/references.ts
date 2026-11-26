import { randomInt } from 'node:crypto';
import { Schema, model, type ClientSession } from 'mongoose';

/** Crockford-style alphabet without look-alikes (no I, L, O, U, 0, 1). */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

export function randomCode(length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/** Guest-facing booking reference, e.g. SS-7KQ2M9XA (uniqueness enforced by an index). */
export const newBookingReference = () => `SS-${randomCode(8)}`;
export const newHoldReference = () => `HLD-${randomCode(10)}`;

interface CounterAttrs {
  _id: string;
  seq: number;
}
const counterSchema = new Schema<CounterAttrs>(
  { _id: { type: String, required: true }, seq: { type: Number, required: true } },
  { versionKey: false },
);
export const CounterModel = model<CounterAttrs>('Counter', counterSchema);

/** Gap-tolerant, strictly increasing sequence (atomic $inc), e.g. for invoice numbers. */
export async function nextSequence(name: string, session?: ClientSession): Promise<number> {
  const doc = await CounterModel.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, ...(session ? { session } : {}) },
  ).lean<CounterAttrs>();
  return doc!.seq;
}
