import { Schema, model, type Types } from 'mongoose';
import {
  BUSINESS_TYPES,
  PARTNER_DOCUMENT_TYPES,
  PARTNER_VERIFICATION_STATUSES,
  STAFF_INVITATION_STATUSES,
  STAFF_PERMISSIONS,
  type BusinessType,
  type PartnerDocumentType,
  type PartnerVerificationStatus,
  type StaffInvitationStatus,
  type StaffPermission,
} from '@stayscape/shared';

export interface PartnerDocument {
  type: PartnerDocumentType;
  mediaId: Types.ObjectId;
  fileName: string;
  contentType: string;
  size: number;
  uploadedAt: Date;
}

export interface SettlementAccount {
  reference: string;
  accountHolderName: string;
  bankName: string;
  ifsc: string;
  accountNumberLast4: string;
  /** AES-256-GCM ciphertext; never returned by the API. */
  accountNumberEncrypted: string;
}

export interface PartnerAttrs {
  ownerId: Types.ObjectId;
  ownerName: string | null;
  businessName: string | null;
  businessType: BusinessType | null;
  registrationNumber: string | null;
  taxDetails: { pan: string | null; gstin: string | null };
  businessAddress: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  };
  contactDetails: { email?: string; phone?: string; website?: string };
  verificationDocuments: PartnerDocument[];
  settlementAccount: SettlementAccount | null;
  /** Spec field: opaque reference to the settlement account (mirrors settlementAccount.reference). */
  settlementAccountReference: string | null;
  verificationStatus: PartnerVerificationStatus;
  rejectionReason: string | null;
  submittedAt: Date | null;
  approvedBy: Types.ObjectId | null;
  approvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
export type PartnerRecord = PartnerAttrs & { _id: Types.ObjectId };

const documentSchema = new Schema<PartnerDocument>(
  {
    type: { type: String, enum: PARTNER_DOCUMENT_TYPES, required: true },
    mediaId: { type: Schema.Types.ObjectId, ref: 'MediaAsset', required: true },
    fileName: { type: String, required: true },
    contentType: { type: String, required: true },
    size: { type: Number, required: true },
    uploadedAt: { type: Date, required: true },
  },
  { _id: false },
);

const partnerSchema = new Schema<PartnerAttrs>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    ownerName: { type: String, default: null, maxlength: 60 },
    businessName: { type: String, default: null, maxlength: 150 },
    businessType: { type: String, enum: [...BUSINESS_TYPES, null], default: null },
    registrationNumber: { type: String, default: null, maxlength: 50 },
    taxDetails: { pan: { type: String, default: null }, gstin: { type: String, default: null } },
    businessAddress: {
      line1: String,
      line2: String,
      city: String,
      state: String,
      postalCode: String,
      country: String,
    },
    contactDetails: { email: String, phone: String, website: String },
    verificationDocuments: { type: [documentSchema], default: [] },
    settlementAccount: {
      type: new Schema<SettlementAccount>(
        {
          reference: { type: String, required: true },
          accountHolderName: { type: String, required: true },
          bankName: { type: String, required: true },
          ifsc: { type: String, required: true },
          accountNumberLast4: { type: String, required: true },
          accountNumberEncrypted: { type: String, required: true, select: false },
        },
        { _id: false },
      ),
      default: null,
    },
    settlementAccountReference: { type: String, default: null },
    verificationStatus: {
      type: String,
      enum: PARTNER_VERIFICATION_STATUSES,
      default: 'REGISTERED',
    },
    rejectionReason: { type: String, default: null, maxlength: 1000 },
    submittedAt: { type: Date, default: null },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

partnerSchema.index({ ownerId: 1 }, { unique: true, name: 'uniq_owner' });
partnerSchema.index({ verificationStatus: 1, submittedAt: 1 }, { name: 'status_submitted' });

export const PartnerModel = model<PartnerAttrs>('Partner', partnerSchema);

export interface PartnerStaffAttrs {
  partnerId: Types.ObjectId;
  userId: Types.ObjectId;
  assignedProperties: Types.ObjectId[];
  permissions: StaffPermission[];
  invitationStatus: StaffInvitationStatus;
  invitedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
export type PartnerStaffRecord = PartnerStaffAttrs & { _id: Types.ObjectId };

const partnerStaffSchema = new Schema<PartnerStaffAttrs>(
  {
    partnerId: { type: Schema.Types.ObjectId, ref: 'Partner', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    assignedProperties: { type: [{ type: Schema.Types.ObjectId, ref: 'Hotel' }], default: [] },
    permissions: { type: [{ type: String, enum: STAFF_PERMISSIONS }], default: [] },
    invitationStatus: { type: String, enum: STAFF_INVITATION_STATUSES, default: 'PENDING' },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, versionKey: false },
);
partnerStaffSchema.index({ partnerId: 1, userId: 1 }, { unique: true, name: 'uniq_partner_user' });
partnerStaffSchema.index({ userId: 1, invitationStatus: 1 }, { name: 'user_status' });

export const PartnerStaffModel = model<PartnerStaffAttrs>('PartnerStaff', partnerStaffSchema);
