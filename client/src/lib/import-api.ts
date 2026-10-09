import { apiRequest } from "@/lib/queryClient";
import { detectLinkPlatform, normalizeUrl, type LinkPlatform } from "@shared/link-platform";

// Server calls for adding recipes (the "Add recipe" sheet and the import
// progress list). Endpoints are unchanged from before the redesign.

/** Pulls the server's { error } text out of apiRequest's "400: {...}" errors */
export function apiErrorMessage(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const body = raw.replace(/^\d{3}:\s*/, "");
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed.error === "string" && parsed.error.trim()) return parsed.error;
  } catch {
    /* not JSON */
  }
  if (/^5\d\d/.test(raw) || /failed to fetch|network/i.test(raw)) return fallback;
  return body && body.length < 200 ? body : fallback;
}

export async function addToCookbook(cookbookId: string | undefined, recipeId: string) {
  if (!cookbookId) return;
  try {
    await apiRequest("POST", `/api/cookbooks/${cookbookId}/recipes`, { recipeId });
  } catch (error) {
    // The recipe itself was saved; adding it to the cookbook is secondary
    console.error("Failed to add recipe to cookbook:", error);
  }
}

// Keep the original name for files the browser couldn't re-encode (e.g. .heic),
// so the server knows to convert them
const nameFor = (blob: Blob, fallback: string) => (blob instanceof File && blob.name ? blob.name : fallback);

/** 1–5 photos combined into one recipe */
export async function uploadRecipePhotos(pages: Blob[]): Promise<string> {
  const form = new FormData();
  if (pages.length === 1) {
    form.append("image", pages[0], nameFor(pages[0], "page-1.jpg"));
    const res = await apiRequest("POST", "/api/recipes/upload", form);
    return ((await res.json()) as { recipeId: string }).recipeId;
  }
  pages.forEach((p, i) => form.append("images", p, nameFor(p, `page-${i + 1}.jpg`)));
  const res = await apiRequest("POST", "/api/recipes/upload-multi-image", form);
  return ((await res.json()) as { recipeId: string }).recipeId;
}

export async function createUploadSession(totalFiles: number): Promise<string | undefined> {
  if (totalFiles < 2) return undefined;
  const res = await apiRequest("POST", "/api/uploads/sessions", { totalFiles });
  return ((await res.json()) as { id: string }).id;
}

/** One photo = one recipe (batch import) */
export async function uploadBatchPhoto(photo: Blob, sessionId: string | undefined, index: number): Promise<string> {
  const form = new FormData();
  form.append("image", photo, nameFor(photo, `recipe-${index + 1}.jpg`));
  if (sessionId) {
    form.append("sessionId", sessionId);
    form.append("sourceImageIndex", String(index));
  }
  const res = await apiRequest("POST", "/api/recipes/upload", form);
  return ((await res.json()) as { recipeId: string }).recipeId;
}

export { detectLinkPlatform, normalizeUrl, type LinkPlatform } from "@shared/link-platform";

export async function importLink(input: string): Promise<{ recipeId: string; platform: LinkPlatform }> {
  const url = normalizeUrl(input);
  const platform = detectLinkPlatform(input);
  if (!url || !platform) throw new Error("That doesn't look like a web address. Copy the whole link and paste it again.");
  const endpoint = platform === "web" ? "/api/recipes/extract-url" : "/api/recipes/import-social";
  const res = await apiRequest("POST", endpoint, { url });
  return { recipeId: ((await res.json()) as { recipeId: string }).recipeId, platform };
}

/** sourceUrl: the post the text was copied from, when its link couldn't be read */
export async function importText(text: string, sourceUrl?: string): Promise<string> {
  const res = await apiRequest("POST", "/api/recipes/extract-text", sourceUrl ? { text, sourceUrl } : { text });
  return ((await res.json()) as { recipeId: string }).recipeId;
}

export async function retryImport(recipeId: string): Promise<void> {
  await apiRequest("POST", `/api/recipe-imports/${recipeId}/retry`);
}

export async function dismissImportReview(recipeId: string): Promise<void> {
  await apiRequest("POST", `/api/recipe-imports/${recipeId}/dismiss`);
}
