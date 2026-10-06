/**
 * Parses a model's JSON answer. JSON mode usually returns clean JSON, which
 * may be an object or a bare array; only if that fails, cut it out of any
 * surrounding text, using whichever bracket comes first. (Cutting from the
 * first "{" to the last "}" broke every bare array.)
 */
export function parseModelJson(text: string): any {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const obj = trimmed.indexOf("{");
    const arr = trimmed.indexOf("[");
    const useArray = arr !== -1 && (obj === -1 || arr < obj);
    const start = useArray ? arr : obj;
    const end = useArray ? trimmed.lastIndexOf("]") : trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("no JSON found");
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}
