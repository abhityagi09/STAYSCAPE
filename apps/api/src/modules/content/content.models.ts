import { Schema, model, type Types } from 'mongoose';
import {
  CONTENT_LOCALES,
  CONTENT_TYPES,
  type ContentLocale,
  type ContentType,
} from '@stayscape/shared';

export interface ContentBody {
  title: string;
  summary: string;
  body: string;
  imageIds: Types.ObjectId[];
  imageAlts: string[];
  cta: { label: string; href: string } | null;
  destinationSlug: string | null;
  faqCategory: string | null;
  tags: string[];
  seo: { title: string; description: string; noindex: boolean };
  sortOrder: number;
}

/**
 * A CMS entry keeps an editable `draft` and an immutable-until-republished `published` snapshot,
 * so edits never leak to the live site before an editor publishes them. Scheduling is the window
 * [publishAt, unpublishAt) on the published snapshot; public reads evaluate it at request time.
 */
export interface ContentEntryAttrs {
  type: ContentType;
  locale: ContentLocale;
  slug: string;
  draft: ContentBody;
  published: (ContentBody & { version: number }) | null;
  version: number;
  publishAt: Date | null;
  unpublishAt: Date | null;
  publishedAt: Date | null;
  archivedAt: Date | null;
  previewTokenHash: string | null;
  previewExpiresAt: Date | null;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}
export type ContentEntryRecord = ContentEntryAttrs & { _id: Types.ObjectId };

const entrySchema = new Schema<ContentEntryAttrs>(
  {
    type: { type: String, enum: CONTENT_TYPES, required: true },
    locale: { type: String, enum: CONTENT_LOCALES, required: true },
    slug: { type: String, required: true, match: /^[a-z0-9-]{2,100}$/ },
    draft: { type: Schema.Types.Mixed, required: true },
    published: { type: Schema.Types.Mixed, default: null },
    version: { type: Number, required: true, min: 1 },
    publishAt: { type: Date, default: null },
    unpublishAt: { type: Date, default: null },
    publishedAt: { type: Date, default: null },
    archivedAt: { type: Date, default: null },
    previewTokenHash: { type: String, default: null },
    previewExpiresAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, versionKey: false },
);
entrySchema.index({ type: 1, locale: 1, slug: 1 }, { unique: true, name: 'uniq_type_locale_slug' });
entrySchema.index({ type: 1, locale: 1, publishAt: -1 }, { name: 'public_listing' });
entrySchema.index({ previewTokenHash: 1 }, { sparse: true, name: 'preview_token' });
export const ContentEntryModel = model<ContentEntryAttrs>('ContentEntry', entrySchema);

/** Append-only revision history (every saved draft and every publish). */
export interface ContentRevisionAttrs {
  entryId: Types.ObjectId;
  version: number;
  action: 'CREATED' | 'SAVED' | 'PUBLISHED' | 'UNPUBLISHED' | 'ARCHIVED' | 'RESTORED';
  body: ContentBody;
  actorId: Types.ObjectId;
  createdAt: Date;
}
const revisionSchema = new Schema<ContentRevisionAttrs>(
  {
    entryId: { type: Schema.Types.ObjectId, ref: 'ContentEntry', required: true },
    version: { type: Number, required: true },
    action: { type: String, required: true },
    body: { type: Schema.Types.Mixed, required: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    createdAt: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
revisionSchema.index({ entryId: 1, createdAt: -1 }, { name: 'entry_created' });
export const ContentRevisionModel = model<ContentRevisionAttrs>('ContentRevision', revisionSchema);
