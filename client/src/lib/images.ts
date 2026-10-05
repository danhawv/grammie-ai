// Shrink big phone photos before upload. Browsers that can decode the file
// (including iPhone HEIC in Safari) re-encode it as JPEG; anything they can't
// decode is sent as-is for the server to handle.
export async function downscaleImage(file: File | Blob, maxSide = 2400, quality = 0.88): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
    return blob ?? file;
  } catch {
    return file;
  }
}

/** Reads a file as a base64 data URL (for APIs that take images inline) */
export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Turns a photo by a multiple of 90° (for sideways phone shots); returns JPEG */
export async function rotateImage(file: Blob, degrees: number, quality = 0.9): Promise<Blob> {
  const turns = ((degrees % 360) + 360) % 360;
  if (turns === 0) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const sideways = turns === 90 || turns === 270;
    const canvas = document.createElement("canvas");
    canvas.width = sideways ? bitmap.height : bitmap.width;
    canvas.height = sideways ? bitmap.width : bitmap.height;
    const ctx = canvas.getContext("2d")!;
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((turns * Math.PI) / 180);
    ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
    return blob ?? file;
  } catch {
    return file;
  }
}

/** A small JPEG data URL for lists and progress rows (null if the browser can't decode it) */
export async function makeThumbnail(file: Blob, maxSide = 160): Promise<string | null> {
  try {
    const small = await downscaleImage(file, maxSide, 0.75);
    // downscaleImage hands back the original only when the browser can't decode it
    if (small === file) return null;
    return await fileToDataUrl(small);
  } catch {
    return null;
  }
}
