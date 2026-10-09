import type { BookConfig } from './types';

/**
 * Builds the 27-character Lulu Pod Package ID from book configuration.
 *
 * Format: [TrimSize(9)][Color(2)][Quality(3)][Binding(2)][Paper(8)][Finish(1)][Linen(1)][Foil(1)]
 * Example: 0600X0900FCSTDPB080CW444GXX
 */
export function buildPodPackageId(config: BookConfig): string {
  return [
    config.trimSize,        // 9 chars: e.g., 0600X0900
    config.colorType,       // 2 chars: BW or FC
    // Lulu only makes full-color saddle stitch in premium color
    config.bindingType === 'SS' && config.colorType === 'FC' ? 'PRE' : config.printQuality,
    config.bindingType,     // 2 chars: PB, CW, LW, CO, SS
    config.paperType,       // 8 chars: e.g., 060UW444
    config.coverFinish,     // 1 char:  M or G
    // Linen wrap has no product without a cloth color and foil
    config.bindingType === 'LW' && config.linenColor === 'X' ? 'N' : config.linenColor, // 1 char: N, G, K, R, T, E, or X
    config.bindingType === 'LW' && config.foilType === 'X' ? 'G' : config.foilType,     // 1 char: G, B, W, S, or X
  ].join('');
}

/**
 * Parses a Pod Package ID into its component parts.
 */
export function parsePodPackageId(id: string): BookConfig | null {
  if (id.length !== 27) return null;

  return {
    trimSize: id.substring(0, 9) as BookConfig['trimSize'],
    colorType: id.substring(9, 11) as BookConfig['colorType'],
    printQuality: id.substring(11, 14) as BookConfig['printQuality'],
    bindingType: id.substring(14, 16) as BookConfig['bindingType'],
    paperType: id.substring(16, 24) as BookConfig['paperType'],
    coverFinish: id.substring(24, 25) as BookConfig['coverFinish'],
    linenColor: id.substring(25, 26) as BookConfig['linenColor'],
    foilType: id.substring(26, 27) as BookConfig['foilType'],
  };
}

// Valid combinations (not all combos work with Lulu)
export const BINDING_PAPER_COMPATIBILITY: Record<string, string[]> = {
  PB: ['060UW444', '060UC444', '080CW444'],
  CW: ['060UW444', '060UC444', '080CW444'],
  LW: ['060UW444', '060UC444'],
  CO: ['060UW444', '060UC444', '080CW444'],
  SS: ['060UW444', '080CW444'],
};

export const BINDING_PAGE_LIMITS: Record<string, { min: number; max: number }> = {
  PB: { min: 32, max: 800 },
  CW: { min: 32, max: 800 },
  LW: { min: 32, max: 800 },
  CO: { min: 24, max: 300 },
  SS: { min: 4, max: 48 },
};

/**
 * Why Lulu has no product for this combination, or null. Checked against
 * Lulu's catalog (October 2026): every size and paper below exists except
 * cream paper in color.
 */
export function unsupportedBookReason(config: Pick<BookConfig, 'colorType' | 'paperType' | 'bindingType'>): string | null {
  if (!(BINDING_PAPER_COMPATIBILITY[config.bindingType] || []).includes(config.paperType)) {
    return "That paper doesn't work with this binding.";
  }
  if (config.bindingType === 'LW') {
    return "Linen wrap isn't available yet. Choose hardcover for a hard-backed book.";
  }
  if (config.colorType === 'FC' && config.paperType === '060UC444') {
    return 'Cream paper only prints in black and white. Choose white paper for a color book.';
  }
  return null;
}
