import {
  validateInterior,
  validateCover,
  getInteriorValidation,
  getCoverValidation,
  type LuluFileValidation,
} from './client';

// Runs a book's PDFs through Lulu's own file checks (the same ones a print
// job runs) and waits for the answer. Used by the size check, which proves
// every book size and binding we offer passes before anyone orders it.

export interface FileCheck {
  ok: boolean;
  status: string;
  problems: string[];
  pageCount?: number | null;
}

export interface BookFilesCheck {
  ok: boolean;
  interior: FileCheck;
  cover: FileCheck;
  seconds: number;
}

const INTERIOR_DONE = new Set(['VALIDATED', 'NORMALIZED', 'ERROR']);
const COVER_DONE = new Set(['NORMALIZED', 'ERROR']);

/** Lulu's error messages arrive as strings, lists or nested objects */
export function flattenLuluMessages(m: unknown, out: string[] = []): string[] {
  if (!m) return out;
  if (typeof m === 'string') out.push(m);
  else if (Array.isArray(m)) m.forEach((x) => flattenLuluMessages(x, out));
  else if (typeof m === 'object') Object.values(m as object).forEach((x) => flattenLuluMessages(x, out));
  return out;
}

async function waitFor(
  start: () => Promise<LuluFileValidation>,
  poll: (id: number) => Promise<LuluFileValidation>,
  done: Set<string>,
  deadline: number,
): Promise<FileCheck> {
  let v = await start();
  while (!done.has(v.status || '') && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 4000));
    v = await poll(v.id);
  }
  const status = v.status || 'UNKNOWN';
  const problems = flattenLuluMessages(v.errors);
  if (!done.has(status)) problems.push("Lulu didn't finish checking in time");
  return { ok: status !== 'ERROR' && done.has(status) && problems.length === 0, status, problems, pageCount: v.page_count };
}

export async function checkBookFilesWithLulu(opts: {
  interiorUrl: string;
  coverUrl: string;
  podPackageId: string;
  pageCount: number;
  timeoutMs?: number;
}): Promise<BookFilesCheck> {
  const t0 = Date.now();
  const deadline = t0 + (opts.timeoutMs ?? 6 * 60_000);
  const [interior, cover] = await Promise.all([
    waitFor(() => validateInterior(opts.interiorUrl, opts.podPackageId), getInteriorValidation, INTERIOR_DONE, deadline),
    waitFor(() => validateCover(opts.coverUrl, opts.podPackageId, opts.pageCount), getCoverValidation, COVER_DONE, deadline),
  ]);
  return { ok: interior.ok && cover.ok, interior, cover, seconds: Math.round((Date.now() - t0) / 1000) };
}
