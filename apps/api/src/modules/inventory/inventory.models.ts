import mongoose, { Schema, model, type Types } from 'mongoose';

export interface DailyInventoryAttrs {
  hotelId: Types.ObjectId;
  roomTypeId: Types.ObjectId;
  /** Property-local calendar date, "YYYY-MM-DD". Never interpreted in the server's time zone. */
  localDate: string;
  totalRooms: number;
  /** Total rooms out of sale: manual blocks + maintenanceRooms. */
  blockedRooms: number;
  /** Portion of blockedRooms placed by maintenance/renovation blocks (see InventoryBlock). */
  maintenanceRooms: number;
  /** Closed for sale (stop-sell): no new holds or bookings, existing reservations unaffected. */
  stopSell: boolean;
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
    maintenanceRooms: { ...nonNegativeInt, default: 0 },
    stopSell: { type: Boolean, default: false },
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

/**
 * A maintenance / renovation / owner-use block taking `rooms` out of sale for [from, to] (inclusive
 * property-local dates). Applied atomically to DailyInventory.maintenanceRooms + blockedRooms.
 * Releasing returns only future nights, so past occupancy history stays accurate.
 */
export const INVENTORY_BLOCK_REASONS = ['MAINTENANCE', 'RENOVATION', 'OWNER_USE', 'OTHER'] as const;
export interface InventoryBlockAttrs {
  hotelId: Types.ObjectId;
  roomTypeId: Types.ObjectId;
  from: string;
  to: string;
  rooms: number;
  reason: (typeof INVENTORY_BLOCK_REASONS)[number];
  note: string;
  status: 'ACTIVE' | 'RELEASED';
  createdBy: Types.ObjectId;
  releasedBy: Types.ObjectId | null;
  releasedAt: Date | null;
  /** First date returned to sale on release (dates before it stay blocked in history). */
  releasedFrom: string | null;
  createdAt: Date;
  updatedAt: Date;
}
export type InventoryBlockRecord = InventoryBlockAttrs & { _id: Types.ObjectId };
const blockSchema = new Schema<InventoryBlockAttrs>(
  {
    hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    roomTypeId: { type: Schema.Types.ObjectId, ref: 'RoomType', required: true },
    from: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    to: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    rooms: { type: Number, required: true, min: 1 },
    reason: { type: String, enum: INVENTORY_BLOCK_REASONS, required: true },
    note: { type: String, default: '', maxlength: 300 },
    status: { type: String, enum: ['ACTIVE', 'RELEASED'], default: 'ACTIVE' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    releasedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    releasedAt: { type: Date, default: null },
    releasedFrom: { type: String, default: null },
  },
  { timestamps: true, versionKey: false },
);
blockSchema.index({ hotelId: 1, status: 1, from: 1 }, { name: 'hotel_status_from' });
export const InventoryBlockModel = model<InventoryBlockAttrs>('InventoryBlock', blockSchema);
