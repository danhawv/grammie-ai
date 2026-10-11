// Turning whatever the person hands us (a folder, a .zip, a pile of photos)
// into a tidy list of photos for bulk intake. Pure browser code with no UI,
// so it can be tested: .zip reading (without a library; the browser's own
// DecompressionStream does the work), photo-type checks, the date a photo
// was taken, and ordering.

export const PHOTO_EXT = /\.(jpe?g|png|webp|heic|heif|gif|bmp|tiff?)$/i;

/** Photos we can use; skips Mac/Windows clutter (._x, .DS_Store, __MACOSX/, Thumbs.db) */
export function isPhotoName(path: string): boolean {
  const name = path.split("/").pop() ?? "";
  if (!name || name.startsWith(".") || /(^|\/)__MACOSX\//.test(path) || /^thumbs\.db$/i.test(name)) return false;
  return PHOTO_EXT.test(name);
}

/** The folder id from a Google Drive link ("…/folders/<id>", "…?id=<id>") */
export function folderIdFromLink(link: string): string | null {
  const m = link.match(/\/folders\/([\w-]{10,})/) ?? link.match(/[?&]id=([\w-]{10,})/);
  return m?.[1] ?? null;
}

export const isZipName = (name: string) => /\.zip$/i.test(name);
export const isPdfName = (name: string) => /\.pdf$/i.test(name);

/** "IMG_2.jpg" before "IMG_10.jpg" */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

// ---- .zip ---------------------------------------------------------------------

export interface ZipEntry {
  path: string;
  size: number;
  open: () => Promise<Blob>;
}

export class ZipError extends Error {}

const u16 = (v: DataView, o: number) => v.getUint16(o, true);
const u32 = (v: DataView, o: number) => v.getUint32(o, true);

/**
 * Lists the files in a .zip without reading the whole thing into memory
 * (each entry is read when opened). Handles "stored" and "deflate", which
 * is what Finder, Windows and Google Drive downloads use.
 */
export async function readZip(zip: Blob): Promise<ZipEntry[]> {
  // The end-of-directory record sits in the last 64 KB
  const tailStart = Math.max(0, zip.size - 65_557);
  const tail = new DataView(await zip.slice(tailStart).arrayBuffer());
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (u32(tail, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new ZipError("This .zip file looks damaged. Try making it again.");
  const count = u16(tail, eocd + 10);
  const dirSize = u32(tail, eocd + 12);
  const dirOffset = u32(tail, eocd + 16);
  if (dirOffset === 0xffffffff || count === 0xffff) throw new ZipError("This .zip file is too big to open here. Unzip it and choose the folder instead.");

  const dir = new DataView(await zip.slice(dirOffset, dirOffset + dirSize).arrayBuffer());
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let n = 0; n < count && p + 46 <= dir.byteLength; n++) {
    if (u32(dir, p) !== 0x02014b50) throw new ZipError("This .zip file looks damaged. Try making it again.");
    const method = u16(dir, p + 10);
    const compressed = u32(dir, p + 20);
    const size = u32(dir, p + 24);
    const nameLen = u16(dir, p + 28);
    const extraLen = u16(dir, p + 30);
    const commentLen = u16(dir, p + 32);
    const local = u32(dir, p + 42);
    const path = decoder.decode(new Uint8Array(dir.buffer, dir.byteOffset + p + 46, nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (path.endsWith("/")) continue; // a folder
    entries.push({
      path,
      size,
      open: async () => {
        const head = new DataView(await zip.slice(local, local + 30).arrayBuffer());
        if (u32(head, 0) !== 0x04034b50) throw new ZipError(`Couldn't read ${path} from the .zip.`);
        const start = local + 30 + u16(head, 26) + u16(head, 28);
        const data = zip.slice(start, start + compressed);
        if (method === 0) return data;
        if (method !== 8) throw new ZipError(`${path} is packed in a way we can't open.`);
        const stream = data.stream().pipeThrough(new DecompressionStream("deflate-raw"));
        return new Response(stream).blob();
      },
    });
  }
  return entries;
}

// ---- When a photo was taken ---------------------------------------------------------

/**
 * DateTimeOriginal from a JPEG's EXIF, as an ISO string, or null. Photos
 * taken in order (front, then back) help match backs to fronts.
 */
export function exifTakenAt(bytes: ArrayBuffer): string | null {
  const v = new DataView(bytes);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null;
  let o = 2;
  while (o + 4 <= v.byteLength) {
    const marker = v.getUint16(o);
    const len = v.getUint16(o + 2);
    if (marker === 0xffe1 && o + 10 <= v.byteLength && v.getUint32(o + 4) === 0x45786966) {
      return readExifDate(v, o + 10);
    }
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break;
    o += 2 + len;
  }
  return null;
}

function readExifDate(v: DataView, tiff: number): string | null {
  if (tiff + 8 > v.byteLength) return null;
  const little = v.getUint16(tiff) === 0x4949;
  const g16 = (o: number) => v.getUint16(o, little);
  const g32 = (o: number) => v.getUint32(o, little);
  const readIfd = (start: number, want: number[]): Map<number, number> => {
    const out = new Map<number, number>();
    if (start + 2 > v.byteLength) return out;
    const n = g16(start);
    for (let i = 0; i < n; i++) {
      const e = start + 2 + i * 12;
      if (e + 12 > v.byteLength) break;
      const tag = g16(e);
      if (want.includes(tag)) out.set(tag, e);
    }
    return out;
  };
  const ifd0 = readIfd(tiff + g32(tiff + 4), [0x8769, 0x0132]);
  const exifPtr = ifd0.get(0x8769);
  const sub = exifPtr !== undefined ? readIfd(tiff + g32(exifPtr + 8), [0x9003]) : new Map<number, number>();
  const entry = sub.get(0x9003) ?? ifd0.get(0x0132);
  if (entry === undefined) return null;
  const at = tiff + g32(entry + 8);
  if (at + 19 > v.byteLength) return null;
  let s = "";
  for (let i = 0; i < 19; i++) s += String.fromCharCode(v.getUint8(at + i));
  const m = s.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m || m[1] === "0000") return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
}

// ---- Ordering -------------------------------------------------------------------------

export interface OrderedPhoto {
  path: string;
  takenAt: string | null;
  lastModified: number;
}

/**
 * The order the photos were most likely taken in: by capture time when
 * every photo has one, else by file name (cameras number them in order).
 */
export function orderPhotos<T extends OrderedPhoto>(photos: T[]): T[] {
  const allTimed = photos.length > 0 && photos.every((p) => p.takenAt);
  return [...photos].sort((a, b) =>
    allTimed ? a.takenAt!.localeCompare(b.takenAt!) || naturalCompare(a.path, b.path) : naturalCompare(a.path, b.path),
  );
}

/** SHA-256 of a file, hex. The same file always gets the same id, which makes uploads resumable */
export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
