// Reading what another app shared. Instagram and TikTok share only a link
// (sometimes with the caption around it); Safari shares the page address.

const URL_PATTERN = /https?:\/\/[^\s<>"'”’)\]]+/i;

/** The first web address in the shared texts, without trailing punctuation */
export function firstSharedUrl(texts: string[]): string | null {
  for (const text of texts) {
    const match = text.match(URL_PATTERN);
    if (match) return match[0].replace(/[.,;:!?]+$/, "");
  }
  return null;
}

/** Shared text long enough to be a recipe someone copied */
export function sharedRecipeText(texts: string[]): string | null {
  const joined = texts.map((t) => t.trim()).filter(Boolean).join("\n\n");
  return joined.length >= 20 ? joined : null;
}
