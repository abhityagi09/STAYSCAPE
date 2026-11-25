import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { Config } from '@/config/env';

export interface StoredObject {
  key: string;
  url: string;
  contentType: string;
  size: number;
}

export interface StorageProvider {
  readonly name: string;
  put(key: string, body: Buffer, contentType: string): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

const SAFE_KEY = /^[a-z0-9][a-z0-9/_.-]{0,255}$/i;

function assertSafeKey(key: string) {
  if (!SAFE_KEY.test(key) || key.includes('..')) throw new Error('Unsafe storage key');
}

/**
 * Stores files on the local filesystem and serves them through the API's /media route.
 * Intended for development and single-node deployments only.
 */
export class LocalStorageProvider implements StorageProvider {
  readonly name = 'local';
  readonly root: string;

  constructor(
    uploadDir: string,
    private readonly publicBaseUrl: string,
  ) {
    this.root = resolve(uploadDir);
  }

  private pathFor(key: string) {
    assertSafeKey(key);
    const full = resolve(this.root, key);
    if (!full.startsWith(this.root + sep)) throw new Error('Unsafe storage key');
    return full;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
    return {
      key,
      url: `${this.publicBaseUrl.replace(/\/$/, '')}/${key}`,
      contentType,
      size: body.length,
    };
  }

  get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}

/**
 * S3-compatible object storage (AWS S3, Cloudflare R2, MinIO, Backblaze B2...).
 * Requires real credentials; not exercised by the automated test suite.
 */
export class S3StorageProvider implements StorageProvider {
  readonly name = 's3';
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(
    private readonly config: Config,
    bucket?: string,
    private readonly publicBaseUrl?: string,
  ) {
    const resolved = bucket ?? config.S3_BUCKET;
    if (!resolved || !config.S3_REGION) throw new Error('S3 bucket and S3_REGION are required');
    this.bucket = resolved;
    this.client = new S3Client({
      region: config.S3_REGION,
      ...(config.S3_ENDPOINT ? { endpoint: config.S3_ENDPOINT } : {}),
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      ...(config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY
        ? {
            credentials: {
              accessKeyId: config.S3_ACCESS_KEY_ID,
              secretAccessKey: config.S3_SECRET_ACCESS_KEY,
            },
          }
        : {}),
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    assertSafeKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
    const base =
      this.publicBaseUrl ??
      this.config.S3_PUBLIC_BASE_URL ??
      `https://${this.bucket}.s3.${this.config.S3_REGION}.amazonaws.com`;
    return { key, url: `${base.replace(/\/$/, '')}/${key}`, contentType, size: body.length };
  }

  async get(key: string): Promise<Buffer> {
    assertSafeKey(key);
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!result.Body) throw new Error('Empty object');
    return Buffer.from(await result.Body.transformToByteArray());
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

export function createStorageProvider(config: Config): StorageProvider {
  return config.STORAGE_DRIVER === 's3'
    ? new S3StorageProvider(config)
    : new LocalStorageProvider(config.UPLOAD_DIR, config.MEDIA_PUBLIC_BASE_URL);
}

/**
 * Private storage for sensitive files (verification documents). Never publicly served:
 * reads go through authorised API endpoints only.
 */
export function createPrivateStorageProvider(config: Config): StorageProvider {
  return config.STORAGE_DRIVER === 's3'
    ? new S3StorageProvider(config, config.S3_PRIVATE_BUCKET, 'private://')
    : new LocalStorageProvider(config.PRIVATE_UPLOAD_DIR, 'private://');
}
