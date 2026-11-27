import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import {
  ACCOUNT_STATUSES,
  CURRENCIES,
  DEFAULT_ROLE,
  LANGUAGES,
  ROLES,
  type AccountStatus,
  type CurrencyCode,
  type Language,
  type NotificationPreferences,
  type Role,
} from '@stayscape/shared';

export interface UserAvatar {
  url: string;
  key: string;
  contentType: string;
  size: number;
  updatedAt: Date;
}

export interface UserPreferences {
  language: Language;
  currency: CurrencyCode;
  notifications: NotificationPreferences;
  personalization?: { recommendations: boolean; consentedAt: Date | null };
}

export interface UserAttrs {
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  passwordHash: string;
  avatar: UserAvatar | null;
  roles: Role[];
  accountStatus: AccountStatus;
  emailVerifiedAt: Date | null;
  phoneVerifiedAt: Date | null;
  preferences: UserPreferences;
  lastLoginAt: Date | null;
  passwordChangedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type UserDocument = HydratedDocument<UserAttrs>;
export type UserRecord = UserAttrs & { _id: Types.ObjectId };

const avatarSchema = new Schema<UserAvatar>(
  {
    url: { type: String, required: true },
    key: { type: String, required: true },
    contentType: { type: String, required: true },
    size: { type: Number, required: true },
    updatedAt: { type: Date, required: true },
  },
  { _id: false },
);

const preferencesSchema = new Schema<UserPreferences>(
  {
    language: { type: String, enum: LANGUAGES, default: 'en' },
    currency: { type: String, enum: CURRENCIES, default: 'INR' },
    notifications: {
      emailBookingUpdates: { type: Boolean, default: true },
      emailPromotions: { type: Boolean, default: false },
      emailSecurityAlerts: { type: Boolean, default: true },
      smsBookingUpdates: { type: Boolean, default: false },
      pushEnabled: { type: Boolean, default: false },
    },
    personalization: {
      recommendations: { type: Boolean, default: false },
      consentedAt: { type: Date, default: null },
    },
  },
  { _id: false },
);

const userSchema = new Schema<UserAttrs>(
  {
    firstName: { type: String, required: true, trim: true, maxlength: 60 },
    lastName: { type: String, required: true, trim: true, maxlength: 60 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    phone: { type: String, default: null, trim: true },
    // Never selected unless explicitly requested with `.select('+passwordHash')`.
    passwordHash: { type: String, required: true, select: false },
    avatar: { type: avatarSchema, default: null },
    roles: {
      type: [{ type: String, enum: ROLES }],
      default: [DEFAULT_ROLE],
      validate: {
        validator: (roles: Role[]) => roles.length > 0 && new Set(roles).size === roles.length,
        message: 'A user must have at least one unique role',
      },
    },
    accountStatus: { type: String, enum: ACCOUNT_STATUSES, default: 'ACTIVE' },
    emailVerifiedAt: { type: Date, default: null },
    phoneVerifiedAt: { type: Date, default: null },
    preferences: { type: preferencesSchema, default: () => ({}) },
    lastLoginAt: { type: Date, default: null },
    passwordChangedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      versionKey: false,
      transform: (_doc, ret: Record<string, unknown>) => {
        delete ret.passwordHash;
        return ret;
      },
    },
  },
);

userSchema.index({ email: 1 }, { unique: true, name: 'uniq_email' });
userSchema.index({ roles: 1 }, { name: 'roles' });
userSchema.index({ accountStatus: 1, createdAt: -1 }, { name: 'status_created' });

export const UserModel = model<UserAttrs>('User', userSchema);
