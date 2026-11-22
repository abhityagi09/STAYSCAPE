import { Schema, model } from 'mongoose';

export interface NewsletterSubscriptionAttrs {
  email: string;
  status: 'SUBSCRIBED' | 'UNSUBSCRIBED';
  source: string;
  consentedAt: Date;
  ipAddress: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const newsletterSubscriptionSchema = new Schema<NewsletterSubscriptionAttrs>(
  {
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    status: { type: String, enum: ['SUBSCRIBED', 'UNSUBSCRIBED'], default: 'SUBSCRIBED' },
    source: { type: String, required: true, maxlength: 40 },
    consentedAt: { type: Date, required: true },
    ipAddress: { type: String, default: null, maxlength: 64 },
  },
  { timestamps: true, versionKey: false },
);

newsletterSubscriptionSchema.index({ email: 1 }, { unique: true, name: 'uniq_email' });

export const NewsletterSubscriptionModel = model<NewsletterSubscriptionAttrs>(
  'NewsletterSubscription',
  newsletterSubscriptionSchema,
);
