import { createHash, randomBytes } from 'node:crypto';
import { Types } from 'mongoose';
import type {
  AdminContentDto,
  ContentLocale,
  ContentState,
  ContentType,
  PublicContentDto,
} from '@stayscape/shared';
import { AppError, Errors, isMongoDuplicateKey } from '@/lib/errors';
import { paginated } from '@/lib/http';
import type { RequestContext } from '@/lib/request-context';
import type { AuditService } from '@/modules/audit/audit.service';
import { MediaAssetModel, type MediaAssetRecord } from '@/modules/media/media-asset.model';
import { toImageDto, type MediaService, type UploadedFile } from '@/modules/media/media.service';
import {
  ContentEntryModel,
  ContentRevisionModel,
  type ContentBody,
  type ContentEntryRecord,
} from './content.models';

type BodyInput = Omit<ContentBody, 'imageIds'> & { imageIds: string[] };
const PREVIEW_TTL_MS = 60 * 60_000;
const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function contentState(
  e: Pick<ContentEntryRecord, 'archivedAt' | 'published' | 'publishAt' | 'unpublishAt'>,
  now = new Date(),
): ContentState {
  if (e.archivedAt) return 'ARCHIVED';
  if (!e.published) return 'DRAFT';
  if (e.publishAt && e.publishAt > now) return 'SCHEDULED';
  if (e.unpublishAt && e.unpublishAt <= now) return 'EXPIRED';
  return 'LIVE';
}

/** Mongo filter equivalent of `contentState(e) === state`. */
function stateFilter(state: ContentState, now: Date): Record<string, unknown> {
  switch (state) {
    case 'ARCHIVED':
      return { archivedAt: { $ne: null } };
    case 'DRAFT':
      return { archivedAt: null, published: null };
    case 'SCHEDULED':
      return { archivedAt: null, published: { $ne: null }, publishAt: { $gt: now } };
    case 'EXPIRED':
      return {
        archivedAt: null,
        published: { $ne: null },
        publishAt: { $lte: now },
        unpublishAt: { $lte: now },
      };
    case 'LIVE':
      return {
        archivedAt: null,
        published: { $ne: null },
        publishAt: { $lte: now },
        $or: [{ unpublishAt: null }, { unpublishAt: { $gt: now } }],
      };
  }
}

/**
 * Content management (content:manage at the router). Drafts never reach the public site; publishing
 * copies the draft into a snapshot with an optional schedule; every change writes a revision and an
 * audit entry; previews use short-lived, single-entry tokens stored only as hashes.
 */
export class ContentService {
  constructor(private readonly deps: { media: MediaService; audit: AuditService }) {}

  private async images(ids: Types.ObjectId[], alts: string[]) {
    if (!ids.length) return [];
    const assets = await MediaAssetModel.find({ _id: { $in: ids }, purpose: 'CONTENT_IMAGE' }).lean<
      MediaAssetRecord[]
    >();
    return ids.flatMap((id, i) => {
      const a = assets.find((x) => x._id.equals(id));
      return a ? [toImageDto(a, alts[i] ?? '')] : [];
    });
  }

  private async toBody(input: BodyInput): Promise<ContentBody> {
    const ids = [...new Set(input.imageIds)];
    if (
      ids.length &&
      (await MediaAssetModel.countDocuments({ _id: { $in: ids }, purpose: 'CONTENT_IMAGE' })) !==
        ids.length
    )
      throw Errors.validation({
        fieldErrors: { imageIds: ['Upload images through the content image endpoint first'] },
      });
    if (ids.length) await this.deps.media.markAttached(ids);
    return { ...input, imageIds: ids.map((i) => new Types.ObjectId(i)) };
  }

  private async toPublic(
    e: ContentEntryRecord,
    body: ContentBody,
    publishedAt: Date | null,
  ): Promise<PublicContentDto> {
    return {
      type: e.type,
      locale: e.locale,
      slug: e.slug,
      title: body.title,
      summary: body.summary,
      body: body.body,
      images: await this.images(body.imageIds, body.imageAlts),
      cta: body.cta,
      destinationSlug: body.destinationSlug,
      faqCategory: body.faqCategory,
      tags: body.tags,
      seo: body.seo,
      publishedAt: publishedAt?.toISOString() ?? null,
      updatedAt: e.updatedAt.toISOString(),
    };
  }

  private async toAdmin(e: ContentEntryRecord): Promise<AdminContentDto> {
    const pub = await this.toPublic(e, e.draft, e.publishedAt);
    const { type: _t, locale: _l, slug: _s, publishedAt: _p, updatedAt: _u, ...draft } = pub;
    const { version: publishedVersion, ...publishedBody } = e.published ?? { version: 0 };
    return {
      id: e._id.toString(),
      type: e.type,
      locale: e.locale,
      slug: e.slug,
      state: contentState(e),
      version: e.version,
      draft: { ...draft, imageIds: e.draft.imageIds.map(String), sortOrder: e.draft.sortOrder },
      hasUnpublishedChanges:
        !e.published ||
        publishedVersion !== e.version ||
        JSON.stringify(publishedBody) !== JSON.stringify(e.draft),
      publishAt: e.publishAt?.toISOString() ?? null,
      unpublishAt: e.unpublishAt?.toISOString() ?? null,
      publishedAt: e.publishedAt?.toISOString() ?? null,
      archivedAt: e.archivedAt?.toISOString() ?? null,
      updatedAt: e.updatedAt.toISOString(),
      updatedBy: e.updatedBy?.toString() ?? null,
    };
  }

  private async entry(id: string): Promise<ContentEntryRecord> {
    if (!Types.ObjectId.isValid(id)) throw Errors.notFound('Content');
    const e = await ContentEntryModel.findById(id).lean<ContentEntryRecord>();
    if (!e) throw Errors.notFound('Content');
    return e;
  }

  private async log(
    actorId: string,
    e: ContentEntryRecord,
    action: 'CREATED' | 'SAVED' | 'PUBLISHED' | 'UNPUBLISHED' | 'ARCHIVED' | 'RESTORED',
    before: unknown,
    after: unknown,
    context: RequestContext,
  ) {
    await ContentRevisionModel.create({
      entryId: e._id,
      version: e.version,
      action,
      body: e.draft,
      actorId,
    });
    await this.deps.audit.record({
      actorId,
      action: `content.${action.toLowerCase()}`,
      entityType: 'ContentEntry',
      entityId: e._id.toString(),
      metadata: { type: e.type, slug: e.slug, locale: e.locale, before, after },
      context,
    });
  }

  // ------------------------------------------------------------------ admin
  async list(q: {
    page: number;
    limit: number;
    type?: ContentType | undefined;
    locale?: ContentLocale | undefined;
    state?: ContentState | undefined;
    q?: string | undefined;
  }) {
    const now = new Date();
    const filter: Record<string, unknown> = {
      ...(q.type ? { type: q.type } : {}),
      ...(q.locale ? { locale: q.locale } : {}),
      ...(q.state ? stateFilter(q.state, now) : {}),
    };
    if (q.q) {
      const rx = new RegExp(escapeRegex(q.q), 'i');
      filter.$and = [{ $or: [{ slug: rx }, { 'draft.title': rx }] }];
    }
    const [rows, total] = await Promise.all([
      ContentEntryModel.find(filter)
        .sort({ updatedAt: -1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean<ContentEntryRecord[]>(),
      ContentEntryModel.countDocuments(filter),
    ]);
    return paginated(await Promise.all(rows.map((r) => this.toAdmin(r))), q.page, q.limit, total);
  }

  async detail(id: string) {
    return this.toAdmin(await this.entry(id));
  }

  async revisions(id: string) {
    const e = await this.entry(id);
    const rows = await ContentRevisionModel.find({ entryId: e._id })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    return rows.map((r) => ({
      id: r._id.toString(),
      version: r.version,
      action: r.action,
      title: r.body.title,
      actorId: r.actorId.toString(),
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async create(
    actorId: string,
    input: BodyInput & { type: ContentType; locale: ContentLocale; slug: string },
    context: RequestContext,
  ) {
    const { type, locale, slug, ...body } = input;
    try {
      const doc = (
        await ContentEntryModel.create({
          type,
          locale,
          slug,
          draft: await this.toBody(body),
          version: 1,
          createdBy: actorId,
          updatedBy: actorId,
        })
      ).toObject() as ContentEntryRecord;
      await this.log(actorId, doc, 'CREATED', null, { title: doc.draft.title }, context);
      return this.toAdmin(doc);
    } catch (error) {
      if (isMongoDuplicateKey(error))
        throw new AppError(
          409,
          'CONFLICT',
          'Content with this type, language and slug already exists.',
        );
      throw error;
    }
  }

  async update(
    actorId: string,
    id: string,
    input: BodyInput & { version: number },
    context: RequestContext,
  ) {
    const before = await this.entry(id);
    if (before.archivedAt)
      throw new AppError(409, 'INVALID_STATE', 'Restore this entry before editing it.');
    const { version, ...body } = input;
    const updated = await ContentEntryModel.findOneAndUpdate(
      { _id: before._id, version },
      { $set: { draft: await this.toBody(body), updatedBy: actorId }, $inc: { version: 1 } },
      { new: true },
    ).lean<ContentEntryRecord>();
    // Optimistic concurrency: someone else saved since this editor loaded the entry.
    if (!updated)
      throw new AppError(
        409,
        'CONFLICT',
        'This entry was changed by someone else. Reload to see the latest version.',
      );
    await this.log(
      actorId,
      updated,
      'SAVED',
      { title: before.draft.title, version: before.version },
      { title: updated.draft.title, version: updated.version },
      context,
    );
    return this.toAdmin(updated);
  }

  async publish(
    actorId: string,
    id: string,
    input: { publishAt: string | null; unpublishAt: string | null },
    context: RequestContext,
  ) {
    const e = await this.entry(id);
    if (e.archivedAt)
      throw new AppError(409, 'INVALID_STATE', 'Restore this entry before publishing it.');
    if (
      !e.draft.title.trim() ||
      (['GUIDE', 'BLOG', 'LEGAL', 'FAQ'].includes(e.type) && !e.draft.body.trim())
    )
      throw Errors.validation({ fieldErrors: { body: ['Add content before publishing'] } });
    if (e.type === 'LEGAL' && input.unpublishAt)
      throw Errors.validation({
        fieldErrors: { unpublishAt: ['Legal pages cannot expire; publish a new version instead'] },
      });
    const now = new Date();
    const publishAt = input.publishAt ? new Date(input.publishAt) : now;
    const unpublishAt = input.unpublishAt ? new Date(input.unpublishAt) : null;
    if (unpublishAt && unpublishAt <= now)
      throw Errors.validation({ fieldErrors: { unpublishAt: ['Choose a time in the future'] } });
    const updated = await ContentEntryModel.findOneAndUpdate(
      { _id: e._id, version: e.version },
      {
        $set: {
          published: { ...e.draft, version: e.version },
          publishAt,
          unpublishAt,
          publishedAt: publishAt,
          updatedBy: actorId,
        },
      },
      { new: true },
    ).lean<ContentEntryRecord>();
    if (!updated)
      throw new AppError(
        409,
        'CONFLICT',
        'This entry changed while publishing. Review and publish again.',
      );
    await this.log(
      actorId,
      updated,
      'PUBLISHED',
      { state: contentState(e), publishedVersion: e.published?.version ?? null },
      { state: contentState(updated), publishedVersion: e.version, publishAt, unpublishAt },
      context,
    );
    return this.toAdmin(updated);
  }

  async unpublish(actorId: string, id: string, context: RequestContext) {
    const e = await this.entry(id);
    if (!e.published) throw new AppError(409, 'INVALID_STATE', 'This entry is not published.');
    const updated = (await ContentEntryModel.findByIdAndUpdate(
      e._id,
      { $set: { published: null, publishAt: null, unpublishAt: null, updatedBy: actorId } },
      { new: true },
    ).lean<ContentEntryRecord>())!;
    await this.log(
      actorId,
      updated,
      'UNPUBLISHED',
      { state: contentState(e) },
      { state: 'DRAFT' },
      context,
    );
    return this.toAdmin(updated);
  }

  async archive(actorId: string, id: string, archived: boolean, context: RequestContext) {
    const e = await this.entry(id);
    if (Boolean(e.archivedAt) === archived)
      throw new AppError(
        409,
        'INVALID_STATE',
        archived ? 'Already archived.' : 'This entry is not archived.',
      );
    const set = archived
      ? { archivedAt: new Date(), published: null, publishAt: null, unpublishAt: null }
      : { archivedAt: null };
    const updated = (await ContentEntryModel.findByIdAndUpdate(
      e._id,
      { $set: { ...set, updatedBy: actorId } },
      { new: true },
    ).lean<ContentEntryRecord>())!;
    await this.log(
      actorId,
      updated,
      archived ? 'ARCHIVED' : 'RESTORED',
      { state: contentState(e) },
      { state: contentState(updated) },
      context,
    );
    return this.toAdmin(updated);
  }

  async createPreview(actorId: string, id: string, context: RequestContext) {
    const e = await this.entry(id);
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + PREVIEW_TTL_MS);
    await ContentEntryModel.updateOne(
      { _id: e._id },
      { $set: { previewTokenHash: hashToken(token), previewExpiresAt: expiresAt } },
    );
    await this.deps.audit.record({
      actorId,
      action: 'content.preview_created',
      entityType: 'ContentEntry',
      entityId: e._id.toString(),
      context,
    });
    return { token, expiresAt: expiresAt.toISOString() };
  }

  async uploadImage(actorId: string, file: UploadedFile | undefined) {
    const asset = await this.deps.media.uploadImage({
      partnerId: null,
      hotelId: null,
      uploadedBy: actorId,
      purpose: 'CONTENT_IMAGE',
      file,
    });
    return toImageDto(asset);
  }

  // ------------------------------------------------------------------ public
  async preview(token: string): Promise<PublicContentDto> {
    const e = await ContentEntryModel.findOne({
      previewTokenHash: hashToken(token),
      previewExpiresAt: { $gt: new Date() },
    }).lean<ContentEntryRecord>();
    if (!e) throw Errors.notFound('Preview');
    return {
      ...(await this.toPublic(e, e.draft, e.publishedAt)),
      seo: { ...e.draft.seo, noindex: true },
    };
  }

  async publicList(q: {
    type: ContentType;
    locale: ContentLocale;
    tag?: string | undefined;
    limit: number;
  }) {
    const now = new Date();
    const load = (locale: ContentLocale) =>
      ContentEntryModel.find({
        type: q.type,
        locale,
        ...stateFilter('LIVE', now),
        ...(q.tag ? { 'published.tags': q.tag } : {}),
      })
        .sort({ 'published.sortOrder': 1, publishedAt: -1 })
        .limit(q.limit)
        .lean<ContentEntryRecord[]>();
    let rows = await load(q.locale);
    // Fall back to English when a language has no published content of this kind yet.
    if (rows.length === 0 && q.locale !== 'en') rows = await load('en');
    return Promise.all(rows.map((r) => this.toPublic(r, r.published!, r.publishedAt)));
  }

  async publicEntry(
    type: ContentType,
    slug: string,
    locale: ContentLocale,
  ): Promise<PublicContentDto> {
    const now = new Date();
    const find = (l: ContentLocale) =>
      ContentEntryModel.findOne({
        type,
        slug,
        locale: l,
        ...stateFilter('LIVE', now),
      }).lean<ContentEntryRecord>();
    const e = (await find(locale)) ?? (locale !== 'en' ? await find('en') : null);
    if (!e) throw Errors.notFound('Page');
    return this.toPublic(e, e.published!, e.publishedAt);
  }
}
