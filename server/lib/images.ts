import sharp from 'sharp';

// Print derivative sizing: a 6x9" book prints photos up to ~5.5" wide at 300 DPI
// ≈ 1650px; 1800px covers 8.5x11" layouts with margin to spare.
const PRINT_MAX_DIMENSION = 1800;
const PRINT_JPEG_QUALITY = 80;

/**
 * Produce a print-resolution JPEG data URL from a full-resolution base64 image.
 * Returns null if the source is missing or can't be decoded.
 */
export async function buildPrintImage(sourceDataUrl: string | null | undefined): Promise<string | null> {
  if (!sourceDataUrl) return null;
  const commaIdx = sourceDataUrl.indexOf(',');
  if (!sourceDataUrl.startsWith('data:') || commaIdx === -1) return null;

  try {
    const input = Buffer.from(sourceDataUrl.slice(commaIdx + 1), 'base64');
    const output = await sharp(input)
      .rotate() // respect EXIF orientation
      .resize(PRINT_MAX_DIMENSION, PRINT_MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: PRINT_JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
    return `data:image/jpeg;base64,${output.toString('base64')}`;
  } catch (err) {
    console.error('buildPrintImage: failed to process image', err);
    return null;
  }
}
