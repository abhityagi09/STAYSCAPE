import { Schema, model, type Types } from 'mongoose';
import { MEDIA_PURPOSES, type MediaPurpose } from '@stayscape/shared';

export interface MediaVariant {
  name: 'sm' | 'md' | 'lg' | 'avif' | 'original';
  key: string;
  url: string;
  width: number;
  height: number;
  contentType: string;
  size: number;
}

export interface MediaAssetAttrs {
  /** Owning partner for listing media; null for customer uploads (reviews, support). */
  partnerId: Types.ObjectId | null;
  hotelId: Types.ObjectId | null;
  uploadedBy: Types.ObjectId;
  purpose: MediaPurpose;
  visibility: 'PUBLIC' | 'PRIVATE';
  /** PENDING until referenced by a listing/application; unreferenced PENDING assets are cleaned up. */
  status: 'PENDING' | 'ATTACHED' | 'DELETED';
  originalFileName: string;
  contentType: string;
  size: number;
  width: number | null;
  height: number | null;
  dominantColor: string | null;
  variants: MediaVariant[];
  /** Private documents: storage key in the private store. */
  privateKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}
export type MediaAssetRecord = MediaAssetAttrs & { _id: Types.ObjectId };

const variantSchema = new Schema<MediaVariant>(
  {
    name: { type: String, required: true },
    key: { type: String, required: true },
    url: { type: String, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    contentType: { type: String, required: true },
    size: { type: Number, required: true },
  },
  { _id: false },
);

const mediaAssetSchema = new Schema<MediaAssetAttrs>(
  {
    partnerId: { type: Schema.Types.ObjectId, ref: 'Partner', default: null },
    hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', default: null },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    purpose: { type: String, enum: MEDIA_PURPOSES, required: true },
    visibility: { type: String, enum: ['PUBLIC', 'PRIVATE'], required: true },
    status: { type: String, enum: ['PENDING', 'ATTACHED', 'DELETED'], default: 'PENDING' },
    originalFileName: { type: String, required: true, maxlength: 200 },
    contentType: { type: String, required: true },
    size: { type: Number, required: true, min: 0 },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    dominantColor: { type: String, default: null },
    variants: { type: [variantSchema], default: [] },
    privateKey: { type: String, default: null },
  },
  { timestamps: true, versionKey: false },
);

mediaAssetSchema.index({ partnerId: 1, hotelId: 1, purpose: 1 }, { name: 'partner_hotel_purpose' });
mediaAssetSchema.index({ status: 1, createdAt: 1 }, { name: 'status_created' });
mediaAssetSchema.index({ uploadedBy: 1, purpose: 1, createdAt: -1 }, { name: 'uploader_purpose' });

export const MediaAssetModel = model<MediaAssetAttrs>('MediaAsset', mediaAssetSchema);
