import { Schema, model, type Types } from 'mongoose';
import {
  REVIEW_REPORT_REASONS,
  REVIEW_STATUSES,
  type ReviewRatingsDto,
  type ReviewReportReason,
  type ReviewStatus,
} from '@stayscape/shared';

export interface ReviewAttrs {
  bookingId: Types.ObjectId;
  hotelId: Types.ObjectId;
  customerId: Types.ObjectId;
  authorName: string;
  roomTypeName: string;
  stayMonth: string;
  checkOutLocalDate: string;
  ratings: ReviewRatingsDto;
  /** Mean of the category scores ×10, as an integer (e.g. 43 = 4.3). */
  overallTenths: number;
  title: string;
  body: string;
  photoIds: Types.ObjectId[];
  status: ReviewStatus;
  editCount: number;
  editedAt: Date | null;
  reportCount: number;
  response: { body: string; respondedBy: Types.ObjectId; respondedAt: Date } | null;
  moderation: { decision: string; reason: string; by: Types.ObjectId; at: Date } | null;
  createdAt: Date;
  updatedAt: Date;
}
export type ReviewRecord = ReviewAttrs & { _id: Types.ObjectId };

const score = { type: Number, required: true, min: 1, max: 5 };
const reviewSchema = new Schema<ReviewAttrs>(
  {
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
    hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    authorName: { type: String, required: true, maxlength: 80 },
    roomTypeName: { type: String, required: true },
    stayMonth: { type: String, required: true },
    checkOutLocalDate: { type: String, required: true },
    ratings: {
      cleanliness: score,
      staff: score,
      location: score,
      comfort: score,
      facilities: score,
      value: score,
    },
    overallTenths: { type: Number, required: true, min: 10, max: 50 },
    title: { type: String, required: true, maxlength: 120 },
    body: { type: String, required: true, maxlength: 4000 },
    photoIds: { type: [Schema.Types.ObjectId], default: [] },
    status: { type: String, enum: REVIEW_STATUSES, default: 'PUBLISHED' },
    editCount: { type: Number, default: 0 },
    editedAt: { type: Date, default: null },
    reportCount: { type: Number, default: 0 },
    response: {
      type: new Schema(
        { body: String, respondedBy: Schema.Types.ObjectId, respondedAt: Date },
        { _id: false },
      ),
      default: null,
    },
    moderation: {
      type: new Schema(
        { decision: String, reason: String, by: Schema.Types.ObjectId, at: Date },
        { _id: false },
      ),
      default: null,
    },
  },
  { timestamps: true, versionKey: false },
);
// One review per stay: eligibility is per completed booking.
reviewSchema.index({ bookingId: 1 }, { unique: true, name: 'uniq_booking' });
reviewSchema.index({ hotelId: 1, status: 1, createdAt: -1 }, { name: 'hotel_status_created' });
reviewSchema.index({ customerId: 1, createdAt: -1 }, { name: 'customer_created' });
reviewSchema.index({ status: 1, reportCount: -1 }, { name: 'status_reports' });
export const ReviewModel = model<ReviewAttrs>('Review', reviewSchema);

export interface ReviewReportAttrs {
  reviewId: Types.ObjectId;
  reporterId: Types.ObjectId;
  reason: ReviewReportReason;
  details: string;
  status: 'OPEN' | 'UPHELD' | 'DISMISSED';
  createdAt: Date;
}
const reportSchema = new Schema<ReviewReportAttrs>(
  {
    reviewId: { type: Schema.Types.ObjectId, ref: 'Review', required: true },
    reporterId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reason: { type: String, enum: REVIEW_REPORT_REASONS, required: true },
    details: { type: String, default: '', maxlength: 1000 },
    status: { type: String, enum: ['OPEN', 'UPHELD', 'DISMISSED'], default: 'OPEN' },
    createdAt: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
reportSchema.index({ reviewId: 1, reporterId: 1 }, { unique: true, name: 'uniq_review_reporter' });
reportSchema.index({ reviewId: 1, status: 1 }, { name: 'review_status' });
export const ReviewReportModel = model<ReviewReportAttrs>('ReviewReport', reportSchema);
