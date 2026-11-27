import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { Types } from 'mongoose';
import {
  DOCUMENT_MAX_BYTES,
  DOCUMENT_MIME_TYPES,
  IMAGE_MAX_BYTES,
  IMAGE_MIME_TYPES,
  type ImageDto,
  type MediaPurpose,
} from '@stayscape/shared';
import type { StorageProvider } from '@/infrastructure/storage/storage.provider';
import { Errors } from '@/lib/errors';
import { detectFileType } from '@/lib/file-signature';
import type { Logger } from '@/lib/logger';
import { MediaAssetModel, type MediaAssetRecord, type MediaVariant } from './media-asset.model';

export interface UploadedFile {
  buffer: Buffer;
  size: number;
  originalname: string;
}

const WIDTHS = { sm: 480, md: 1024, lg: 1920 } as const;
const MAX_PIXELS = 60_000_000; // decompression-bomb guard

function safeFileName(name: string) {
  return name.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'file';
}

export function toImageDto(
  asset: Pick<MediaAssetRecord, '_id' | 'width' | 'height' | 'dominantColor' | 'variants'>,
  alt = '',
): ImageDto {
  const url = (name: MediaVariant['name']) =>
    asset.variants.find((v) => v.name === name)?.url ?? null;
  const lg = url('lg') ?? url('md') ?? url('sm') ?? '';
  return {
    id: asset._id.toString(),
    alt,
    width: asset.width ?? 0,
    height: asset.height ?? 0,
    dominantColor: asset.dominantColor,
    variants: { sm: url('sm') ?? lg, md: url('md') ?? lg, lg, avif: url('avif') },
  };
}

export class MediaService {
  constructor(
    private readonly publicStorage: StorageProvider,
    private readonly privateStorage: StorageProvider,
    private readonly logger: Logger,
  ) {}

  /**
   * Validate an image by content, strip metadata (EXIF/GPS), and store responsive WebP variants
   * plus an AVIF medium. Aspect ratio is preserved (fit: inside, never upscaled).
   * The original binary is not retained and nothing binary is stored in MongoDB.
   */
  async uploadImage(params: {
    partnerId: string | null;
    hotelId: string | null;
    uploadedBy: string;
    purpose: Extract<MediaPurpose, 'HOTEL_IMAGE' | 'ROOM_IMAGE' | 'REVIEW_IMAGE' | 'CONTENT_IMAGE'>;
    file: UploadedFile | undefined;
  }): Promise<MediaAssetRecord> {
    const { file } = params;
    if (!file) throw Errors.badRequest('Attach an image in the "file" field.');
    if (file.size > IMAGE_MAX_BYTES) throw Errors.tooLarge('Images must be 10 MB or smaller.');
    const type = detectFileType(file.buffer, IMAGE_MIME_TYPES);
    if (!type) throw Errors.unsupportedMedia('Images must be JPEG, PNG, WebP or AVIF.');

    let metadata: sharp.Metadata;
    try {
      metadata = await sharp(file.buffer, { limitInputPixels: MAX_PIXELS }).metadata();
    } catch {
      throw Errors.unsupportedMedia('The image could not be read.');
    }
    if (!metadata.width || !metadata.height)
      throw Errors.unsupportedMedia('The image could not be read.');
    if (metadata.width < 400 || metadata.height < 300)
      throw Errors.badRequest('Images must be at least 400 × 300 pixels.');

    const base = sharp(file.buffer, { limitInputPixels: MAX_PIXELS }).rotate(); // honour EXIF orientation, then drop metadata
    const stats = await base.clone().resize(32, 32, { fit: 'inside' }).stats();
    const { r, g, b } = stats.dominant;
    const dominantColor = `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;

    const folder =
      params.purpose === 'REVIEW_IMAGE'
        ? `reviews/${params.uploadedBy}/${randomUUID()}`
        : `${params.purpose === 'HOTEL_IMAGE' ? 'hotels' : 'rooms'}/${params.partnerId}/${randomUUID()}`;
    const variants: MediaVariant[] = [];
    let width = metadata.width;
    let height = metadata.height;
    try {
      for (const [name, maxWidth] of Object.entries(WIDTHS) as Array<
        [keyof typeof WIDTHS, number]
      >) {
        const { data, info } = await base
          .clone()
          .resize({ width: maxWidth, height: maxWidth, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 80 })
          .toBuffer({ resolveWithObject: true });
        const stored = await this.publicStorage.put(`${folder}/${name}.webp`, data, 'image/webp');
        variants.push({
          name,
          key: stored.key,
          url: stored.url,
          width: info.width,
          height: info.height,
          contentType: 'image/webp',
          size: data.length,
        });
        if (name === 'lg') ({ width, height } = info);
      }
      const { data, info } = await base
        .clone()
        .resize({ width: WIDTHS.md, height: WIDTHS.md, fit: 'inside', withoutEnlargement: true })
        .avif({ quality: 50, effort: 2 })
        .toBuffer({ resolveWithObject: true });
      const stored = await this.publicStorage.put(`${folder}/md.avif`, data, 'image/avif');
      variants.push({
        name: 'avif',
        key: stored.key,
        url: stored.url,
        width: info.width,
        height: info.height,
        contentType: 'image/avif',
        size: data.length,
      });
    } catch (error) {
      await Promise.allSettled(variants.map((v) => this.publicStorage.delete(v.key)));
      this.logger.error({ err: error }, 'Image processing failed');
      throw Errors.unsupportedMedia('The image could not be processed.');
    }

    const doc = await MediaAssetModel.create({
      partnerId: params.partnerId ? new Types.ObjectId(params.partnerId) : null,
      hotelId: params.hotelId ? new Types.ObjectId(params.hotelId) : null,
      uploadedBy: new Types.ObjectId(params.uploadedBy),
      purpose: params.purpose,
      visibility: 'PUBLIC',
      status: 'PENDING',
      originalFileName: safeFileName(file.originalname),
      contentType: type.mime,
      size: file.size,
      width,
      height,
      dominantColor,
      variants,
    });
    return doc.toObject() as MediaAssetRecord;
  }

  /** Verification documents go to private storage and are only readable via authorised endpoints. */
  async uploadDocument(params: {
    partnerId: string;
    uploadedBy: string;
    file: UploadedFile | undefined;
  }): Promise<MediaAssetRecord> {
    const { file } = params;
    if (!file) throw Errors.badRequest('Attach a document in the "file" field.');
    if (file.size > DOCUMENT_MAX_BYTES) throw Errors.tooLarge('Documents must be 5 MB or smaller.');
    const type = detectFileType(file.buffer, DOCUMENT_MIME_TYPES);
    if (!type) throw Errors.unsupportedMedia('Documents must be PDF, JPEG or PNG.');
    const key = `partners/${params.partnerId}/documents/${randomUUID()}.${type.ext}`;
    await this.privateStorage.put(key, file.buffer, type.mime);
    const doc = await MediaAssetModel.create({
      partnerId: new Types.ObjectId(params.partnerId),
      uploadedBy: new Types.ObjectId(params.uploadedBy),
      purpose: 'PARTNER_DOCUMENT',
      visibility: 'PRIVATE',
      status: 'ATTACHED',
      originalFileName: safeFileName(file.originalname),
      contentType: type.mime,
      size: file.size,
      privateKey: key,
    });
    return doc.toObject() as MediaAssetRecord;
  }

  async readDocument(
    partnerId: string,
    mediaId: string,
  ): Promise<{ body: Buffer; asset: MediaAssetRecord }> {
    if (!Types.ObjectId.isValid(mediaId)) throw Errors.notFound('Document');
    const asset = await MediaAssetModel.findOne({
      _id: mediaId,
      partnerId,
      purpose: 'PARTNER_DOCUMENT',
      status: { $ne: 'DELETED' },
    }).lean<MediaAssetRecord>();
    if (!asset?.privateKey) throw Errors.notFound('Document');
    return { body: await this.privateStorage.get(asset.privateKey), asset };
  }

  /** Private customer upload (support attachments): PDF/JPEG/PNG, content-checked, never public. */
  async uploadPrivateFile(params: {
    uploadedBy: string;
    purpose: 'SUPPORT_ATTACHMENT' | 'SETTLEMENT_EVIDENCE';
    file: UploadedFile | undefined;
  }): Promise<MediaAssetRecord> {
    const { file } = params;
    if (!file) throw Errors.badRequest('Attach a file in the "file" field.');
    if (file.size > DOCUMENT_MAX_BYTES)
      throw Errors.tooLarge('Attachments must be 5 MB or smaller.');
    const type = detectFileType(file.buffer, DOCUMENT_MIME_TYPES);
    if (!type) throw Errors.unsupportedMedia('Attachments must be PDF, JPEG or PNG.');
    const key = `${params.purpose === 'SUPPORT_ATTACHMENT' ? 'support' : 'settlements'}/${params.uploadedBy}/${randomUUID()}.${type.ext}`;
    await this.privateStorage.put(key, file.buffer, type.mime);
    const doc = await MediaAssetModel.create({
      uploadedBy: new Types.ObjectId(params.uploadedBy),
      purpose: params.purpose,
      visibility: 'PRIVATE',
      status: 'PENDING',
      originalFileName: safeFileName(file.originalname),
      contentType: type.mime,
      size: file.size,
      privateKey: key,
    });
    return doc.toObject() as MediaAssetRecord;
  }

  async readPrivateFile(
    mediaId: string,
    purpose: MediaPurpose,
  ): Promise<{ body: Buffer; asset: MediaAssetRecord }> {
    if (!Types.ObjectId.isValid(mediaId)) throw Errors.notFound('File');
    const asset = await MediaAssetModel.findOne({
      _id: mediaId,
      purpose,
      status: { $ne: 'DELETED' },
    }).lean<MediaAssetRecord>();
    if (!asset?.privateKey) throw Errors.notFound('File');
    return { body: await this.privateStorage.get(asset.privateKey), asset };
  }

  /** Customer uploads may only be attached by the customer who uploaded them. */
  async assertUploadedBy(userId: string, ids: string[], purpose: MediaPurpose): Promise<void> {
    if (ids.length === 0) return;
    const count = await MediaAssetModel.countDocuments({
      _id: { $in: ids },
      uploadedBy: userId,
      purpose,
      status: { $ne: 'DELETED' },
    });
    if (count !== new Set(ids).size) throw Errors.badRequest('One or more files were not found.');
  }

  findImages(ids: Array<string | Types.ObjectId>): Promise<MediaAssetRecord[]> {
    const valid = ids.map(String).filter((id) => Types.ObjectId.isValid(id));
    if (valid.length === 0) return Promise.resolve([]);
    return MediaAssetModel.find({
      _id: { $in: valid },
      visibility: 'PUBLIC',
      status: { $ne: 'DELETED' },
    })
      .lean<MediaAssetRecord[]>()
      .exec();
  }

  /** Ensure every referenced image belongs to this partner (and hotel) before it can be attached. */
  async assertOwnedImages(partnerId: string, hotelId: string, ids: string[]): Promise<void> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return;
    const count = await MediaAssetModel.countDocuments({
      _id: { $in: unique },
      partnerId,
      $or: [{ hotelId }, { hotelId: null }],
      visibility: 'PUBLIC',
      status: { $ne: 'DELETED' },
    });
    if (count !== unique.length)
      throw Errors.badRequest('One or more images do not exist or belong to another property.');
  }

  async markAttached(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await MediaAssetModel.updateMany(
      { _id: { $in: ids }, status: 'PENDING' },
      { $set: { status: 'ATTACHED' } },
    );
  }

  /** Delete an asset owned by the partner. Callers must check it is no longer referenced. */
  async deleteAsset(partnerId: string, mediaId: string): Promise<void> {
    if (!Types.ObjectId.isValid(mediaId)) throw Errors.notFound('Media');
    const asset = await MediaAssetModel.findOneAndUpdate(
      { _id: mediaId, partnerId, status: { $ne: 'DELETED' } },
      { $set: { status: 'DELETED' } },
    ).lean<MediaAssetRecord>();
    if (!asset) throw Errors.notFound('Media');
    await this.removeObjects(asset);
  }

  private async removeObjects(asset: MediaAssetRecord) {
    const deletions = asset.variants.map((v) => this.publicStorage.delete(v.key));
    if (asset.privateKey) deletions.push(this.privateStorage.delete(asset.privateKey));
    const results = await Promise.allSettled(deletions);
    if (results.some((r) => r.status === 'rejected'))
      this.logger.warn(
        { mediaId: asset._id.toString() },
        'Some media objects could not be deleted',
      );
  }

  /**
   * Cleanup job: remove uploads that were never attached to a listing within the TTL, after
   * re-checking that nothing references them. Safe to run repeatedly (idempotent).
   */
  async cleanupOrphans(
    olderThan: Date,
    isReferenced: (ids: Types.ObjectId[]) => Promise<Set<string>>,
  ): Promise<number> {
    const candidates = await MediaAssetModel.find({
      status: 'PENDING',
      createdAt: { $lt: olderThan },
    })
      .limit(500)
      .lean<MediaAssetRecord[]>();
    if (candidates.length === 0) return 0;
    const referenced = await isReferenced(candidates.map((c) => c._id));
    let removed = 0;
    for (const asset of candidates) {
      if (referenced.has(asset._id.toString())) {
        await MediaAssetModel.updateOne({ _id: asset._id }, { $set: { status: 'ATTACHED' } });
        continue;
      }
      const claimed = await MediaAssetModel.findOneAndUpdate(
        { _id: asset._id, status: 'PENDING' },
        { $set: { status: 'DELETED' } },
      );
      if (claimed) {
        await this.removeObjects(asset);
        removed += 1;
      }
    }
    return removed;
  }
}
