import { z } from 'zod';
import type { ImageDto } from '../contracts/marketplace-dto';
import { objectIdSchema } from './common';

/** Phase 4 content management. Bodies are Markdown, rendered without raw HTML on the client. */
export const CONTENT_TYPES = [
  'BANNER',
  'FEATURED_DESTINATION',
  'PROMO_SECTION',
  'GUIDE',
  'BLOG',
  'FAQ',
  'LEGAL',
] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];
export const CONTENT_LOCALES = ['en', 'hi'] as const;
export type ContentLocale = (typeof CONTENT_LOCALES)[number];
/** Derived from the published snapshot and its schedule — never stored. */
export const CONTENT_STATES = ['DRAFT', 'SCHEDULED', 'LIVE', 'EXPIRED', 'ARCHIVED'] as const;
export type ContentState = (typeof CONTENT_STATES)[number];

const relativeOrHttps = z
  .string()
  .trim()
  .max(500)
  .refine(
    (v) => /^\/(?!\/)[\w\-./?=&%#]*$/.test(v) || /^https:\/\/[^\s]+$/.test(v),
    'Use a site path like /destinations/goa or an https:// link',
  );

export const contentBodySchema = z.strictObject({
  title: z.string().trim().min(2).max(160),
  summary: z.string().trim().max(400).default(''),
  body: z
    .string()
    .max(50_000)
    .refine(
      (v) => !/<\s*(script|iframe|object|embed|style)\b|javascript:|\son\w+\s*=/i.test(v),
      'Scripts, frames and inline handlers are not allowed',
    )
    .default(''),
  /** Uploaded CONTENT_IMAGE assets. */
  imageIds: z.array(objectIdSchema).max(10).default([]),
  imageAlts: z.array(z.string().trim().min(2).max(160)).max(10).default([]),
  cta: z
    .strictObject({ label: z.string().trim().min(2).max(40), href: relativeOrHttps })
    .nullable()
    .default(null),
  /** FEATURED_DESTINATION: the destination slug it promotes. */
  destinationSlug: z
    .string()
    .regex(/^[a-z0-9-]{2,80}$/)
    .nullable()
    .default(null),
  /** FAQ: grouping. */
  faqCategory: z.string().trim().max(60).nullable().default(null),
  tags: z
    .array(
      z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^[a-z0-9-]{2,30}$/),
    )
    .max(10)
    .default([]),
  seo: z
    .strictObject({
      title: z.string().trim().max(70).default(''),
      description: z.string().trim().max(170).default(''),
      noindex: z.boolean().default(false),
    })
    .default({ title: '', description: '', noindex: false }),
  sortOrder: z.number().int().min(0).max(10_000).default(100),
});

export const createContentSchema = contentBodySchema.extend({
  type: z.enum(CONTENT_TYPES),
  locale: z.enum(CONTENT_LOCALES).default('en'),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{2,100}$/, 'Use lowercase letters, digits and dashes'),
});
export const updateContentSchema = contentBodySchema.extend({
  /** Optimistic concurrency: the version the editor started from. */
  version: z.number().int().min(1),
});
export const publishContentSchema = z
  .strictObject({
    publishAt: z.string().datetime().nullable().default(null),
    unpublishAt: z.string().datetime().nullable().default(null),
  })
  .refine(
    (v) => !v.publishAt || !v.unpublishAt || Date.parse(v.unpublishAt) > Date.parse(v.publishAt),
    { message: 'Unpublish must be after publish', path: ['unpublishAt'] },
  );
export const contentAdminQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  type: z.enum(CONTENT_TYPES).optional(),
  locale: z.enum(CONTENT_LOCALES).optional(),
  state: z.enum(CONTENT_STATES).optional(),
  q: z.string().trim().max(80).optional(),
});
export const contentPublicQuerySchema = z.object({
  type: z.enum(CONTENT_TYPES),
  locale: z.enum(CONTENT_LOCALES).default('en'),
  tag: z.string().max(30).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export interface PublicContentDto {
  type: ContentType;
  locale: ContentLocale;
  slug: string;
  title: string;
  summary: string;
  body: string;
  images: ImageDto[];
  cta: { label: string; href: string } | null;
  destinationSlug: string | null;
  faqCategory: string | null;
  tags: string[];
  seo: { title: string; description: string; noindex: boolean };
  publishedAt: string | null;
  updatedAt: string;
}
export interface AdminContentDto {
  id: string;
  type: ContentType;
  locale: ContentLocale;
  slug: string;
  state: ContentState;
  version: number;
  draft: Omit<PublicContentDto, 'type' | 'locale' | 'slug' | 'publishedAt' | 'updatedAt'> & {
    imageIds: string[];
    sortOrder: number;
  };
  hasUnpublishedChanges: boolean;
  publishAt: string | null;
  unpublishAt: string | null;
  publishedAt: string | null;
  archivedAt: string | null;
  updatedAt: string;
  updatedBy: string | null;
}
