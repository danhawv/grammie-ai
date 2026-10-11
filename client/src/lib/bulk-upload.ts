import { downscaleImage } from "@/lib/images";
import { exifTakenAt, isPdfName, isPhotoName, isZipName, orderPhotos, readZip, sha256Hex, ZipError } from "@/lib/bulk-files";

// Getting hundreds of photos to the server reliably (docs/BULK_IMPORT.md):
//  - folders and .zip files are opened in the browser, so nothing huge is
//    ever sent in one piece
//  - each photo is shrunk to 2400px before upload (a 4 MB phone photo
//    becomes ~600 KB), then sent on its own, 4 at a time
//  - each photo's id is a hash of the original file: the server ignores a
//    photo it already has, so after a dropped connection or a closed tab the
//    person picks the same folder again and only the rest are sent
//  - failures are retried with growing waits; a photo that still fails is
//    listed with a reason, and the rest carry on

/** A photo we can open later (from a folder, a .zip or Google Drive) */
export interface SourcePhoto {
  path: string;
  size: number;
  lastModified: number;
  /** When the photo was taken, if a source already knows (Google Drive does) */
  takenAt?: string | null;
  open: () => Promise<Blob>;
}

export interface Collected {
  photos: SourcePhoto[];
  /** Files we can't use yet, by kind, to tell the person */
  skippedPdfs: string[];
  skippedOther: number;
  problems: string[];
}

const fromFile = (f: File, path?: string): SourcePhoto => ({
  path: path || (f as any).webkitRelativePath || f.name,
  size: f.size,
  lastModified: f.lastModified,
  open: async () => f,
});

async function addFile(file: File, path: string, out: Collected): Promise<void> {
  if (isZipName(path)) {
    try {
      const entries = await readZip(file);
      for (const e of entries) {
        if (isPhotoName(e.path)) out.photos.push({ path: `${path}/${e.path}`, size: e.size, lastModified: file.lastModified, open: e.open });
        else if (isPdfName(e.path)) out.skippedPdfs.push(e.path);
        else if (!e.path.includes("__MACOSX")) out.skippedOther++;
      }
    } catch (err) {
      out.problems.push(err instanceof ZipError ? `${file.name}: ${err.message}` : `${file.name}: we couldn't open this .zip file.`);
    }
  } else if (isPhotoName(path) || file.type.startsWith("image/")) {
    out.photos.push(fromFile(file, path));
  } else if (isPdfName(path)) {
    out.skippedPdfs.push(path);
  } else if (!/(^|\/)\./.test(path)) {
    out.skippedOther++;
  }
}

function readAllEntries(dir: any): Promise<any[]> {
  // readEntries hands back at most 100 at a time; keep asking until empty
  const reader = dir.createReader();
  const all: any[] = [];
  return new Promise((resolve, reject) => {
    const next = () => reader.readEntries((batch: any[]) => {
      if (!batch.length) return resolve(all);
      all.push(...batch);
      next();
    }, reject);
    next();
  });
}

async function walk(entry: any, out: Collected): Promise<void> {
  if (entry.isFile) {
    const file: File = await new Promise((resolve, reject) => entry.file(resolve, reject));
    await addFile(file, entry.fullPath.replace(/^\//, ""), out);
  } else if (entry.isDirectory) {
    for (const child of await readAllEntries(entry)) await walk(child, out);
  }
}

/** Photos from chosen files, a chosen folder, or a drop (folders and .zips included) */
export async function collectPhotos(input: File[] | DataTransfer): Promise<Collected> {
  const out: Collected = { photos: [], skippedPdfs: [], skippedOther: 0, problems: [] };
  if (input instanceof DataTransfer) {
    const entries = Array.from(input.items).map((i) => (i as any).webkitGetAsEntry?.()).filter(Boolean);
    if (entries.length) {
      for (const e of entries) await walk(e, out);
      return out;
    }
    input = Array.from(input.files);
  }
  for (const f of input) await addFile(f, (f as any).webkitRelativePath || f.name, out);
  return out;
}

// ---- Upload ------------------------------------------------------------------

export interface UploadProgress {
  total: number;
  /** Sent now or already on the server */
  done: number;
  failed: { path: string; reason: string }[];
  /** Same file twice in what was picked */
  repeats: number;
}

export class UploadStopped extends Error {
  constructor(message: string, readonly kind: "limit" | "signed_out" | "gone") {
    super(message);
  }
}

const PARALLEL = 4;
const MAX_TRIES = 6;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function readTakenAt(blob: Blob): Promise<string | null> {
  try {
    return exifTakenAt(await blob.slice(0, 128 * 1024).arrayBuffer());
  } catch {
    return null;
  }
}

async function postPhoto(intakeId: string, form: FormData): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    let res: Response | null = null;
    try {
      res = await fetch(`/api/bulk-intake/${intakeId}/photos`, { method: "POST", body: form, credentials: "include" });
    } catch {
      // Offline or the connection dropped: retry below
    }
    if (res?.ok) return;
    const body = res ? await res.json().catch(() => ({})) : {};
    if (res?.status === 401) throw new UploadStopped("You've been signed out. Sign in, then pick the same photos again to carry on.", "signed_out");
    if (res?.status === 404 || res?.status === 409) throw new UploadStopped(body.error || "This box of recipes can't take more photos.", "gone");
    if (res?.status === 413 || (res?.status === 429 && body.limit)) throw new UploadStopped(body.error, "limit");
    if (res && (res.status === 415 || res.status === 400 || body.permanent)) throw new Error(body.error || "We couldn't use this photo.");
    if (attempt >= MAX_TRIES) throw new Error("This photo didn't upload after several tries. Check your connection, then pick the same photos again.");
    // 1s, 2s, 4s, 8s, 16s, plus a little randomness so retries don't line up
    await wait(1000 * 2 ** (attempt - 1) + Math.random() * 500);
  }
}

/**
 * Sends the photos in the order they were most likely taken. `received`
 * holds the ids the server already has (a resumed upload skips them).
 */
export async function uploadPhotos(
  intakeId: string,
  sources: SourcePhoto[],
  received: Set<string>,
  onProgress: (p: UploadProgress) => void,
  signal?: AbortSignal,
): Promise<UploadProgress> {
  const progress: UploadProgress = { total: sources.length, done: 0, failed: [], repeats: 0 };
  // Capture times come from the photos themselves, so order once they're read;
  // until then, file-name order (cameras number photos in order)
  const ordered = orderPhotos(sources.map((s) => ({ ...s, takenAt: s.takenAt ?? null })));
  const seen = new Set<string>();
  let next = 0;
  let stopped: UploadStopped | null = null;

  const worker = async () => {
    while (next < ordered.length && !stopped && !signal?.aborted) {
      const index = next++;
      const src = ordered[index];
      try {
        const blob = await src.open();
        const key = await sha256Hex(blob);
        if (seen.has(key)) {
          progress.repeats++;
          progress.total--;
          continue;
        }
        seen.add(key);
        if (received.has(key)) {
          progress.done++;
          continue;
        }
        const takenAt = src.takenAt ?? (await readTakenAt(blob));
        const small = await downscaleImage(blob, 2400, 0.88);
        const name = src.path.split("/").pop() || `photo-${index + 1}.jpg`;
        const form = new FormData();
        // Keep the original name for files the browser couldn't shrink (e.g. HEIC), so the server converts them
        form.append("photo", small, small === blob ? name : name.replace(/\.\w+$/, "") + ".jpg");
        form.append("clientKey", key);
        form.append("name", src.path);
        form.append("seq", String(index));
        if (takenAt) form.append("takenAt", takenAt);
        await postPhoto(intakeId, form);
        progress.done++;
      } catch (err) {
        if (err instanceof UploadStopped) {
          stopped = err;
        } else {
          progress.failed.push({ path: src.path, reason: err instanceof Error ? err.message : "Didn't upload." });
        }
      } finally {
        onProgress({ ...progress, failed: [...progress.failed] });
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  if (stopped) throw stopped;
  return progress;
}

/** The missing side of a card (usually its back), added from the review screen */
export async function uploadBackFor(intakeId: string, cardId: string, file: File, side: "back" | "front" = "back"): Promise<void> {
  const key = await sha256Hex(file);
  const small = await downscaleImage(file, 2400, 0.88);
  const form = new FormData();
  form.append("photo", small, small === file ? file.name : "back.jpg");
  form.append("clientKey", key);
  form.append("name", file.name);
  form.append("attachTo", cardId);
  form.append("attachAs", side);
  await postPhoto(intakeId, form);
}
