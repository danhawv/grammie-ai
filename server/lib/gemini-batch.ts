// Gemini Batch API client (https://ai.google.dev/gemini-api/docs/batch-mode).
//
// Batch mode costs half the normal price and finishes within 24 hours
// (usually minutes). A batch that hasn't run after 48 hours expires with no
// results. Results stay downloadable for 6 weeks.
//
// Two ways in:
// - Inline: the requests travel in the create call (under 20MB in total) and
//   the answers come back inside the status response. Fine for text.
// - File: the requests are uploaded as a JSONL file and the answers come back
//   as a JSONL file we stream line by line. Used for dish photos, whose
//   answers are ~1.5MB each and would make one huge status response.
//
// Each request carries our own key, so answers are matched by key rather
// than by position.

const API = "https://generativelanguage.googleapis.com";

export interface BatchRequest {
  key: string;
  /** A GenerateContentRequest body: { contents, generationConfig } */
  request: Record<string, unknown>;
}

export type BatchState = "pending" | "running" | "succeeded" | "failed" | "cancelled" | "expired" | "unknown";

export interface BatchStatus {
  name: string;
  state: BatchState;
  /** Inline answers, when the batch was submitted inline and has finished */
  inlinedResponses?: unknown[];
  /** Answer file ("files/..."), when the batch was submitted as a file */
  responsesFile?: string;
  error?: string;
}

export interface BatchResult {
  /** The GenerateContentResponse, when this request succeeded */
  response?: any;
  error?: string;
}

/** Terminal states: nothing more will happen to the batch */
export function isFinished(state: BatchState): boolean {
  return state === "succeeded" || state === "failed" || state === "cancelled" || state === "expired";
}

/**
 * The REST API reports BATCH_STATE_* while the docs and SDKs use JOB_STATE_*;
 * accept either.
 */
export function normalizeState(raw: unknown): BatchState {
  const s = String(raw ?? "").replace(/^(BATCH|JOB)_STATE_/, "").toLowerCase();
  if (s === "pending" || s === "queued") return "pending";
  if (s === "running") return "running";
  if (s === "succeeded") return "succeeded";
  if (s === "failed") return "failed";
  if (s === "cancelled" || s === "canceled" || s === "cancelling") return "cancelled";
  if (s === "expired") return "expired";
  return "unknown";
}

/** Body for an inline batch create call */
export function inlineBatchBody(displayName: string, requests: BatchRequest[]) {
  return {
    batch: {
      display_name: displayName,
      input_config: {
        requests: {
          requests: requests.map((r) => ({ request: r.request, metadata: { key: r.key } })),
        },
      },
    },
  };
}

/** JSONL input file for a file-based batch: one {key, request} per line */
export function batchJsonl(requests: BatchRequest[]): string {
  return requests.map((r) => JSON.stringify({ key: r.key, request: r.request })).join("\n") + "\n";
}

/**
 * Reads a batch status response. The operation wraps the batch in `metadata`
 * and the answers in `response`; the batch resource on its own has them at
 * the top level and under `dest` / `output`. Handles all of these.
 */
export function parseBatchStatus(body: any): BatchStatus {
  const meta = body?.metadata ?? body ?? {};
  const out = body?.response ?? meta?.output ?? meta?.dest ?? body?.dest ?? body?.output ?? {};
  const inlined = out?.inlinedResponses?.inlinedResponses ?? out?.inlinedResponses;
  const status: BatchStatus = {
    name: body?.name ?? meta?.name,
    state: normalizeState(meta?.state ?? body?.state),
  };
  if (Array.isArray(inlined)) status.inlinedResponses = inlined;
  const file = out?.responsesFile ?? out?.fileName;
  if (typeof file === "string") status.responsesFile = file;
  if (body?.error) status.error = body.error.message ?? JSON.stringify(body.error);
  return status;
}

function errorText(err: any): string {
  if (!err) return "Unknown batch error";
  return err.message ? `${err.code ? `[${err.code}] ` : ""}${err.message}` : JSON.stringify(err);
}

/**
 * One answer (an inline response or a line of the answer file) as
 * [key, result]. `fallbackKey` is used if the answer carries no key.
 */
export function readBatchAnswer(item: any, fallbackKey?: string): [string | undefined, BatchResult] {
  const key = item?.key ?? item?.metadata?.key ?? fallbackKey;
  if (item?.error) return [key, { error: errorText(item.error) }];
  if (item?.response) return [key, { response: item.response }];
  // A bare GenerateContentResponse line
  if (item?.candidates) return [key, { response: item }];
  return [key, { error: "Empty batch answer" }];
}

/**
 * Inline answers -> results by key. Answers come back in request order, so
 * an answer without a key falls back to the key at its position.
 */
export function mapInlineResults(inlined: unknown[], keysInOrder: string[] = []): Map<string, BatchResult> {
  const results = new Map<string, BatchResult>();
  inlined.forEach((item, i) => {
    const [key, result] = readBatchAnswer(item, keysInOrder[i]);
    if (key) results.set(key, result);
  });
  return results;
}

/** Text of a GenerateContentResponse (all text parts, thoughts skipped) */
export function responseText(response: any): string {
  const parts = response?.candidates?.[0]?.content?.parts ?? [];
  return parts.filter((p: any) => typeof p?.text === "string" && !p.thought).map((p: any) => p.text).join("");
}

/** First image in a GenerateContentResponse, as base64 */
export function responseImage(response: any): { data: string; mimeType: string } | null {
  const parts = response?.candidates?.[0]?.content?.parts ?? [];
  for (const p of parts) {
    const inline = p?.inlineData ?? p?.inline_data;
    if (inline?.data) return { data: inline.data, mimeType: inline.mimeType ?? inline.mime_type ?? "image/png" };
  }
  return null;
}

/** Why a response has no usable answer (safety block, empty), if it doesn't */
export function responseProblem(response: any): string | null {
  const candidate = response?.candidates?.[0];
  if (!candidate) return response?.promptFeedback?.blockReason ? `Blocked: ${response.promptFeedback.blockReason}` : "No answer";
  if (!candidate.content?.parts?.length) return `No content (${candidate.finishReason ?? "unknown"})`;
  return null;
}

// ---------------------------------------------------------------------------
// Network calls
// ---------------------------------------------------------------------------

function apiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not configured");
  return key;
}

async function call(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "x-goog-api-key": apiKey(), "content-type": "application/json", ...(init.headers as any) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`[${res.status}] Gemini batch ${path}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

const modelPath = (model: string) => (model.startsWith("models/") ? model : `models/${model}`);

/** Submit requests inline. Returns the batch name ("batches/...") */
export async function createInlineBatch(model: string, displayName: string, requests: BatchRequest[]): Promise<string> {
  const body = await call(`/v1beta/${modelPath(model)}:batchGenerateContent`, {
    method: "POST",
    body: JSON.stringify(inlineBatchBody(displayName, requests)),
  });
  return parseBatchStatus(body).name;
}

/** Upload a JSONL input file. Returns its name ("files/...") */
export async function uploadJsonl(displayName: string, jsonl: string): Promise<string> {
  const bytes = Buffer.from(jsonl, "utf8");
  const start = await fetch(`${API}/upload/v1beta/files`, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey(),
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(bytes.length),
      "X-Goog-Upload-Header-Content-Type": "application/jsonl",
      "content-type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: displayName } }),
  });
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!start.ok || !uploadUrl) throw new Error(`[${start.status}] Gemini file upload start failed: ${(await start.text()).slice(0, 300)}`);
  const done = await fetch(uploadUrl, {
    method: "POST",
    headers: { "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize", "content-length": String(bytes.length) },
    body: bytes,
  });
  const body = await done.json().catch(() => ({}));
  if (!done.ok || !body?.file?.name) throw new Error(`[${done.status}] Gemini file upload failed: ${JSON.stringify(body).slice(0, 300)}`);
  return body.file.name;
}

/** Submit requests as an uploaded JSONL file. Returns the batch name */
export async function createFileBatch(model: string, displayName: string, requests: BatchRequest[]): Promise<string> {
  const fileName = await uploadJsonl(displayName, batchJsonl(requests));
  const body = await call(`/v1beta/${modelPath(model)}:batchGenerateContent`, {
    method: "POST",
    body: JSON.stringify({ batch: { display_name: displayName, input_config: { file_name: fileName } } }),
  });
  return parseBatchStatus(body).name;
}

export async function getBatch(name: string): Promise<BatchStatus> {
  return parseBatchStatus(await call(`/v1beta/${name}`));
}

export async function cancelBatch(name: string): Promise<void> {
  await call(`/v1beta/${name}:cancel`, { method: "POST" });
}

/**
 * Streams an answer file one parsed line at a time, so a file of photos is
 * never held in memory all at once.
 */
export async function* readResultsFile(fileName: string): AsyncGenerator<[string | undefined, BatchResult]> {
  const res = await fetch(`${API}/download/v1beta/${fileName}:download?alt=media`, {
    headers: { "x-goog-api-key": apiKey() },
  });
  if (!res.ok || !res.body) throw new Error(`[${res.status}] Gemini results download failed`);
  const decoder = new TextDecoder();
  let buffered = "";
  for await (const chunk of res.body as any as AsyncIterable<Uint8Array>) {
    buffered += decoder.decode(chunk, { stream: true });
    let newline: number;
    while ((newline = buffered.indexOf("\n")) !== -1) {
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      if (line) yield readBatchAnswer(JSON.parse(line));
    }
  }
  buffered += decoder.decode();
  if (buffered.trim()) yield readBatchAnswer(JSON.parse(buffered.trim()));
}
