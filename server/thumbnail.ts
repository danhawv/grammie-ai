import sharp from 'sharp';

/**
 * Generate a thumbnail from a base64-encoded image
 * @param base64Image - Base64 data URL (e.g., "data:image/png;base64,...")
 * @param size - Thumbnail size in pixels (width = height for square)
 * @returns Base64 data URL of the thumbnail
 */
export async function generateThumbnail(
  base64Image: string,
  size: number = 256
): Promise<string> {
  try {
    // Extract the base64 data from the data URL
    const matches = base64Image.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches) {
      throw new Error('Invalid base64 image format');
    }

    const [, imageType, base64Data] = matches;
    const imageBuffer = Buffer.from(base64Data, 'base64');

    // Generate thumbnail using Sharp
    const thumbnailBuffer = await sharp(imageBuffer)
      .resize(size, size, {
        fit: 'cover',
        position: 'center',
      })
      .jpeg({ quality: 85 }) // Convert to JPEG for better compression
      .toBuffer();

    // Convert back to base64 data URL
    const thumbnailBase64 = thumbnailBuffer.toString('base64');
    return `data:image/jpeg;base64,${thumbnailBase64}`;
  } catch (error) {
    console.error('Error generating thumbnail:', error);
    throw error;
  }
}

/**
 * Estimate the size of a base64 data URL in bytes
 */
export function estimateBase64Size(base64DataUrl: string): number {
  // Remove the data URL prefix to get just the base64 string
  const base64String = base64DataUrl.replace(/^data:image\/\w+;base64,/, '');
  // Base64 encodes 3 bytes into 4 characters, so actual size is roughly 3/4 of string length
  return Math.ceil(base64String.length * 0.75);
}
