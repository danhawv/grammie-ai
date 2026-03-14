import type { BookSizeConfig, TrimSize, BindingType } from './types';

function makeConfig(
  trimSize: TrimSize,
  name: string,
  width: number,
  height: number,
  bindingType: BindingType = 'PB'
): BookSizeConfig {
  const bleed = 0.125;
  const isHardcover = bindingType === 'CW' || bindingType === 'LW';
  const safetyMargin = isHardcover ? 0.75 : 0.5;
  const gutterMargin = 0.2;

  return {
    trimSize,
    name,
    trimWidthIn: width,
    trimHeightIn: height,
    bleed,
    safetyMargin,
    gutterMargin,
    pageWidthWithBleed: width + bleed * 2,
    pageHeightWithBleed: height + bleed * 2,
    contentWidth: width - safetyMargin - gutterMargin - safetyMargin,
    contentHeight: height - safetyMargin * 2,
  };
}

export const BOOK_SIZES: Record<TrimSize, { name: string; width: number; height: number }> = {
  '0425X0687': { name: 'Pocket Book', width: 4.25, height: 6.875 },
  '0500X0800': { name: 'Novella', width: 5, height: 8 },
  '0550X0850': { name: 'Digest', width: 5.5, height: 8.5 },
  '0600X0900': { name: 'US Trade', width: 6, height: 9 },
  '0614X0921': { name: 'Royal', width: 6.14, height: 9.21 },
  '0700X1000': { name: 'Executive', width: 7, height: 10 },
  '0744X0968': { name: 'Crown Quarto', width: 7.44, height: 9.68 },
  '0750X0750': { name: 'Square (Small)', width: 7.5, height: 7.5 },
  '0827X1169': { name: 'A4', width: 8.27, height: 11.69 },
  '0850X1100': { name: 'US Letter', width: 8.5, height: 11 },
  '0850X0850': { name: 'Square (Large)', width: 8.5, height: 8.5 },
};

export function getBookSizeConfig(
  trimSize: TrimSize,
  bindingType: BindingType = 'PB'
): BookSizeConfig {
  const size = BOOK_SIZES[trimSize];
  return makeConfig(trimSize, size.name, size.width, size.height, bindingType);
}

export const BINDING_TYPE_INFO: Record<BindingType, { name: string; description: string }> = {
  PB: {
    name: 'Paperback',
    description: 'Perfect bound softcover. Most popular and cost-effective.',
  },
  CW: {
    name: 'Hardcover',
    description: 'Case wrap hardcover with printed cover.',
  },
  LW: {
    name: 'Linen Wrap',
    description: 'Hardcover with linen material and optional foil stamping.',
  },
  CO: {
    name: 'Coil Bound',
    description: 'Spiral coil binding. Lays flat when open — great for cookbooks.',
  },
  SS: {
    name: 'Saddle Stitch',
    description: 'Staple-bound booklet. Best for shorter cookbooks (up to 80 pages).',
  },
};

export const PAPER_TYPE_INFO: Record<string, { name: string; description: string }> = {
  '060UW444': {
    name: '60# White Uncoated',
    description: 'Standard white paper. Good for text-heavy layouts.',
  },
  '060UC444': {
    name: '60# Cream Uncoated',
    description: 'Warm cream paper. Classic cookbook feel.',
  },
  '080CW444': {
    name: '80# White Coated',
    description: 'Glossy coated paper. Best for full-color photo cookbooks.',
  },
};

export const COLOR_TYPE_INFO: Record<string, { name: string; description: string }> = {
  BW: { name: 'Black & White', description: 'Lower cost, great for text-focused cookbooks.' },
  FC: { name: 'Full Color', description: 'Vibrant photos and colored design elements.' },
};
