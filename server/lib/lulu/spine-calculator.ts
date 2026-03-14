import type { BindingType, PaperType } from './types';

/**
 * Pages Per Inch (PPI) for different paper types.
 * These values come from Lulu's specification sheets.
 */
const PAPER_PPI: Record<PaperType, number> = {
  '060UW444': 444, // 60# Uncoated White
  '060UC444': 444, // 60# Uncoated Cream
  '080CW444': 444, // 80# Coated White (effective PPI varies, using base)
};

/**
 * Additional spine allowance by binding type (in inches).
 * Softcover has a thin cover wrap; hardcover boards add thickness.
 */
const BINDING_SPINE_ADDITION: Record<BindingType, number> = {
  PB: 0.06,   // Perfect bound softcover
  CW: 0.50,   // Case wrap hardcover (boards + wrap)
  LW: 0.50,   // Linen wrap (similar to casewrap)
  CO: 0.0,    // Coil bound (no spine)
  SS: 0.0,    // Saddle stitch (no spine)
};

/**
 * Calculate spine width in inches.
 *
 * Formula: (pageCount / PPI) + bindingAddition
 *
 * Note: pageCount is the total number of pages (both sides of each sheet).
 * For Lulu, this must be even.
 */
export function calculateSpineWidth(
  pageCount: number,
  paperType: PaperType,
  bindingType: BindingType
): number {
  const ppi = PAPER_PPI[paperType];
  const addition = BINDING_SPINE_ADDITION[bindingType];

  // Coil and saddle stitch have no measurable spine
  if (bindingType === 'CO' || bindingType === 'SS') {
    return 0;
  }

  return (pageCount / ppi) + addition;
}

/**
 * Calculate full cover spread dimensions for a given book configuration.
 *
 * The cover is a single PDF page containing:
 * [back cover] [spine] [front cover]
 * with 0.125" bleed on all four edges.
 *
 * For hardcover, there's additional wrap (0.75" on each side).
 */
export function calculateCoverDimensions(
  trimWidthIn: number,
  trimHeightIn: number,
  pageCount: number,
  paperType: PaperType,
  bindingType: BindingType
): { width: number; height: number; spineWidth: number } {
  const bleed = 0.125;
  const spineWidth = calculateSpineWidth(pageCount, paperType, bindingType);

  const isHardcover = bindingType === 'CW' || bindingType === 'LW';
  const wrap = isHardcover ? 0.75 : 0;

  // Total cover width: bleed + wrap + backCover + spine + frontCover + wrap + bleed
  const width = (bleed * 2) + (wrap * 2) + (trimWidthIn * 2) + spineWidth;
  // Total cover height: bleed + wrap + pageHeight + wrap + bleed
  const height = (bleed * 2) + (wrap * 2) + trimHeightIn;

  return {
    width: Math.round(width * 1000) / 1000,
    height: Math.round(height * 1000) / 1000,
    spineWidth: Math.round(spineWidth * 1000) / 1000,
  };
}
