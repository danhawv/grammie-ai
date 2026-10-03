import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

// Media storage abstraction. The app historically stores every image as a
// base64 data URL inside Postgres, which bloats rows (multi-MB recipes),
// slows queries, and rules out CDN caching. This service lets uploads live
// outside the database as opaque URLs instead.
//
// Drivers:
//   MEDIA_STORAGE=db    (default) — keep base64-in-database behavior
//   MEDIA_STORAGE=disk  — write files under MEDIA_DIR (default ./media),
//                         served by express at /media/<key>
//
// An S3-compatible driver (R2, S3, Spaces) can be added behind the same
// interface later: implement put()/delete() with the bucket SDK and return
// the public URL. Nothing outside this file needs to change.
//
// IMPORTANT: existing base64 data is NOT migrated automatically. The database
// may be shared with a deployed instance that can't serve this machine's
// files — run scripts/migrate-media.ts deliberately when storage is shared
// (S3) or the DB is no longer shared.

export interface StoredMedia {
  /** Opaque URL suitable for <img src> and API responses */
  url: string;
  /** Driver-specific key for later deletion */
  key: string;
}

export interface MediaStorage {
  readonly driver: string;
  put(data: Buffer, opts: { contentType: string; keyHint?: string }): Promise<StoredMedia>;
  delete(key: string): Promise<void>;
}

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'font/ttf': 'ttf',
  'font/woff': 'woff',
  'font/woff2': 'woff2',
  'font/otf': 'otf',
};

export const MEDIA_DIR = process.env.MEDIA_DIR || path.join(process.cwd(), 'media');

class DiskMediaStorage implements MediaStorage {
  readonly driver = 'disk';

  async put(data: Buffer, opts: { contentType: string; keyHint?: string }): Promise<StoredMedia> {
    const ext = EXT_BY_TYPE[opts.contentType] || 'bin';
    const hash = crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
    const hint = (opts.keyHint || 'media').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'media';
    const key = `${hint}-${hash}.${ext}`;
    await fs.mkdir(MEDIA_DIR, { recursive: true });
    await fs.writeFile(path.join(MEDIA_DIR, key), data);
    return { url: `/media/${key}`, key };
  }

  async delete(key: string): Promise<void> {
    // Keys are content-hashed filenames; refuse anything path-like
    if (key.includes('/') || key.includes('..')) return;
    await fs.unlink(path.join(MEDIA_DIR, key)).catch(() => {});
  }
}

let instance: MediaStorage | null = null;

/** Returns the configured storage driver, or null when running in legacy db-base64 mode */
export function getMediaStorage(): MediaStorage | null {
  const driver = process.env.MEDIA_STORAGE || 'db';
  if (driver === 'db') return null;
  if (!instance) {
    if (driver === 'disk') {
      instance = new DiskMediaStorage();
    } else {
      throw new Error(`Unknown MEDIA_STORAGE driver: ${driver} (expected 'db' or 'disk')`);
    }
  }
  return instance;
}

/**
 * Resolve an image reference to a data URL for PDF embedding. Puppeteer pages
 * built with setContent can't fetch relative /media URLs, so disk-stored
 * images are read back and inlined. Data URLs pass through untouched.
 */
export async function toEmbeddableImage(ref: string | null | undefined): Promise<string | null> {
  if (!ref) return null;
  if (ref.startsWith('data:')) return ref;
  if (ref.startsWith('/media/')) {
    const key = ref.slice('/media/'.length);
    if (key.includes('/') || key.includes('..')) return null;
    try {
      const buf = await fs.readFile(path.join(MEDIA_DIR, key));
      const ext = key.split('.').pop() || '';
      const type = Object.entries(EXT_BY_TYPE).find(([, e]) => e === ext)?.[0] || 'application/octet-stream';
      return `data:${type};base64,${buf.toString('base64')}`;
    } catch {
      return null;
    }
  }
  // http(s) URLs load fine inside Puppeteer
  return ref;
}
