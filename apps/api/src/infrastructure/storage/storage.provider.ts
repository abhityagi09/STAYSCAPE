import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
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

  constructor(private readonly config: Config) {
    if (!config.S3_BUCKET || !config.S3_REGION)
      throw new Error('S3_BUCKET and S3_REGION are required');
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
        Bucket: this.config.S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
    const base =
      this.config.S3_PUBLIC_BASE_URL ??
      `https://${this.config.S3_BUCKET}.s3.${this.config.S3_REGION}.amazonaws.com`;
    return { key, url: `${base.replace(/\/$/, '')}/${key}`, contentType, size: body.length };
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key }));
  }
}

export function createStorageProvider(config: Config): StorageProvider {
  return config.STORAGE_DRIVER === 's3'
    ? new S3StorageProvider(config)
    : new LocalStorageProvider(config.UPLOAD_DIR, config.MEDIA_PUBLIC_BASE_URL);
}
