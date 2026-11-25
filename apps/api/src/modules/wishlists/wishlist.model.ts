import { Schema, model, type Types } from 'mongoose';

export interface WishlistItem {
  hotelId: Types.ObjectId;
  note: string;
  addedAt: Date;
}

export interface WishlistAttrs {
  userId: Types.ObjectId;
  name: string;
  /** The list the heart button saves to ("Saved stays"); created on demand, one per user. */
  isDefault: boolean;
  items: WishlistItem[];
  /** SHA-256 of the share token (lookup); the token itself is stored encrypted for the owner. */
  shareTokenHash: string | null;
  shareTokenEncrypted: string | null;
  sharedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
export type WishlistRecord = WishlistAttrs & { _id: Types.ObjectId };

const itemSchema = new Schema<WishlistItem>(
  {
    hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    note: { type: String, default: '', maxlength: 300 },
    addedAt: { type: Date, default: () => new Date() },
  },
  { _id: false },
);

const wishlistSchema = new Schema<WishlistAttrs>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, maxlength: 60 },
    isDefault: { type: Boolean, default: false },
    items: { type: [itemSchema], default: [] },
    shareTokenHash: { type: String, default: null },
    shareTokenEncrypted: { type: String, default: null },
    sharedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);
wishlistSchema.index({ userId: 1, updatedAt: -1 }, { name: 'user_updated' });
wishlistSchema.index(
  { userId: 1, isDefault: 1 },
  { unique: true, name: 'uniq_default_per_user', partialFilterExpression: { isDefault: true } },
);
wishlistSchema.index(
  { shareTokenHash: 1 },
  {
    unique: true,
    name: 'uniq_share_token',
    partialFilterExpression: { shareTokenHash: { $type: 'string' } },
  },
);
wishlistSchema.index({ userId: 1, 'items.hotelId': 1 }, { name: 'user_hotel' });
export const WishlistModel = model<WishlistAttrs>('Wishlist', wishlistSchema);
