import mongoose, { Schema, model, type Types } from 'mongoose';

export interface DailyInventoryAttrs {
  hotelId: Types.ObjectId;
  roomTypeId: Types.ObjectId;
  /** Property-local calendar date, "YYYY-MM-DD". Never interpreted in the server's time zone. */
  localDate: string;
  totalRooms: number;
  blockedRooms: number;
  heldRooms: number;
  bookedRooms: number;
  closedToArrival: boolean;
  closedToDeparture: boolean;
  minimumStay: number | null;
  maximumStay: number | null;
  updatedAt: Date;
}
export type DailyInventoryRecord = DailyInventoryAttrs & { _id: Types.ObjectId };

const nonNegativeInt = {
  type: Number,
  required: true,
  min: 0,
  validate: { validator: Number.isInteger, message: 'Must be an integer' },
};

const dailyInventorySchema = new Schema<DailyInventoryAttrs>(
  {
    hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    roomTypeId: { type: Schema.Types.ObjectId, ref: 'RoomType', required: true },
    localDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    totalRooms: nonNegativeInt,
    blockedRooms: { ...nonNegativeInt, default: 0 },
    heldRooms: { ...nonNegativeInt, default: 0 },
    bookedRooms: { ...nonNegativeInt, default: 0 },
    closedToArrival: { type: Boolean, default: false },
    closedToDeparture: { type: Boolean, default: false },
    minimumStay: { type: Number, default: null },
    maximumStay: { type: Number, default: null },
  },
  { timestamps: { createdAt: false, updatedAt: true }, versionKey: false },
);
dailyInventorySchema.index(
  { roomTypeId: 1, localDate: 1 },
  { unique: true, name: 'uniq_roomtype_date' },
);
dailyInventorySchema.index({ hotelId: 1, localDate: 1 }, { name: 'hotel_date' });
export const DailyInventoryModel = model<DailyInventoryAttrs>(
  'DailyInventory',
  dailyInventorySchema,
);

/** available = totalRooms − blockedRooms − heldRooms − bookedRooms, as an aggregation expression. */
export const AVAILABLE_EXPR = {
  $subtract: ['$totalRooms', { $add: ['$blockedRooms', '$heldRooms', '$bookedRooms'] }],
};

/**
 * Database-level invariant (defence in depth beyond the conditional updates in the service):
 * every counter is a non-negative integer and availability can never be negative.
 */
export const DAILY_INVENTORY_VALIDATOR = {
  $and: [
    { totalRooms: { $gte: 0 } },
    { blockedRooms: { $gte: 0 } },
    { heldRooms: { $gte: 0 } },
    { bookedRooms: { $gte: 0 } },
    { $expr: { $gte: [AVAILABLE_EXPR, 0] } },
  ],
};

export async function ensureInventoryValidator(): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB not connected');
  const name = DailyInventoryModel.collection.collectionName;
  const exists = (await db.listCollections({ name }).toArray()).length > 0;
  if (!exists) await db.createCollection(name);
  await db.command({
    collMod: name,
    validator: DAILY_INVENTORY_VALIDATOR,
    validationLevel: 'strict',
    validationAction: 'error',
  });
}

/** A temporary claim on inventory (used by Phase 3 checkout). Idempotent by `holdKey`. */
export interface InventoryHoldAttrs {
  holdKey: string;
  hotelId: Types.ObjectId;
  roomTypeId: Types.ObjectId;
  dates: string[];
  quantity: number;
  status: 'HELD' | 'RELEASED' | 'CONFIRMED' | 'EXPIRED';
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
export type InventoryHoldRecord = InventoryHoldAttrs & { _id: Types.ObjectId };

const inventoryHoldSchema = new Schema<InventoryHoldAttrs>(
  {
    holdKey: { type: String, required: true, maxlength: 120 },
    hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    roomTypeId: { type: Schema.Types.ObjectId, ref: 'RoomType', required: true },
    dates: { type: [String], required: true },
    quantity: { type: Number, required: true, min: 1 },
    status: { type: String, enum: ['HELD', 'RELEASED', 'CONFIRMED', 'EXPIRED'], default: 'HELD' },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, versionKey: false },
);
inventoryHoldSchema.index({ holdKey: 1 }, { unique: true, name: 'uniq_hold_key' });
inventoryHoldSchema.index({ status: 1, expiresAt: 1 }, { name: 'status_expiry' });
export const InventoryHoldModel = model<InventoryHoldAttrs>('InventoryHold', inventoryHoldSchema);
