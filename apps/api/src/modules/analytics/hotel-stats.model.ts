import { Schema, model, type Types } from 'mongoose';

/**
 * Anonymous daily counters per property (no user data): detail-page views, used for the
 * booking-conversion metric. Incremented with an upsert; one document per hotel per UTC day.
 */
export interface HotelDailyStatAttrs {
  hotelId: Types.ObjectId;
  date: string;
  views: number;
}
const schema = new Schema<HotelDailyStatAttrs>(
  {
    hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    views: { type: Number, default: 0, min: 0 },
  },
  { versionKey: false },
);
schema.index({ hotelId: 1, date: 1 }, { unique: true, name: 'uniq_hotel_date' });
export const HotelDailyStatModel = model<HotelDailyStatAttrs>('HotelDailyStat', schema);
