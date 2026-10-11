import sharp from "sharp";
import heicConvert from "heic-convert";

// Photos arrive already shrunk by the browser (client/src/lib/bulk-upload.ts),
// except iPhone HEIC files on browsers that can't read them. Either way the
// server keeps one ≤2400px JPEG (what the import reads) and a 448px copy
// (the review screen and the first look).

const MAX_SIDE = 2400;

export async function prepareUpload(buffer: Buffer, name: string, mimetype: string): Promise<{ image: Buffer; thumb: Buffer; width: number; height: number }> {
  let input = buffer;
  if (/heic|heif/i.test(mimetype) || /\.(heic|heif)$/i.test(name)) {
    input = Buffer.from(await heicConvert({ buffer, format: "JPEG", quality: 0.92 }));
  }
  const image = await sharp(input)
    .rotate() // honor the phone's orientation flag
    .resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer();
  const meta = await sharp(image).metadata();
  const thumb = await smallCopy(image);
  return { image, thumb, width: meta.width ?? 0, height: meta.height ?? 0 };
}

/** A 448px JPEG, turned clockwise by `rotate` */
export async function smallCopy(image: Buffer, rotate = 0): Promise<Buffer> {
  return sharp(image).rotate().rotate(rotate).resize(448, 448, { fit: "inside" }).jpeg({ quality: 78 }).toBuffer();
}

/** The full photo turned upright for the import */
export async function upright(image: Buffer, rotate: number): Promise<Buffer> {
  if (!rotate) return image;
  return sharp(image).rotate(rotate).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
}
