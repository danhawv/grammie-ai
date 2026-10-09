import sharp from 'sharp';
import { generateInteriorPdf, generateCoverPdf, type CookbookPrintData } from '../pdf/generator';
import { storePdf } from '../../routes/route-utils';
import { buildPodPackageId, BINDING_PAGE_LIMITS, BINDING_PAPER_COMPATIBILITY, unsupportedBookReason } from './pod-package';
import { BOOK_SIZES } from './book-sizes';
import { checkBookFilesWithLulu, type BookFilesCheck } from './preflight';
import type { BindingType, BookConfig, PaperType, TrimSize } from './types';

// Builds a small sample cookbook in every book size and binding we offer and
// runs each through Lulu's file checks, so a size Lulu would reject is caught
// here and not on someone's order. Admin-only (POST /api/print/lulu/size-check).

export interface SizeCase {
  trimSize: TrimSize;
  bindingType: BindingType;
  paperType: PaperType;
  colorType: 'BW' | 'FC';
  /** Pad the interior to this many pages (spine width depends on it) */
  pages?: number;
}

export interface SizeCaseResult extends SizeCase {
  podPackageId: string;
  pageCount?: number;
  check?: BookFilesCheck;
  error?: string;
}

export interface SizeCheckRun {
  startedAt: string;
  finishedAt?: string;
  total: number;
  results: SizeCaseResult[];
}

let current: SizeCheckRun | null = null;

export function sizeCheckStatus(): SizeCheckRun | null {
  return current;
}

/** Every size x binding at its default paper, plus spine-width variants */
export function defaultSizeCases(): SizeCase[] {
  const cases: SizeCase[] = [];
  for (const trimSize of Object.keys(BOOK_SIZES) as TrimSize[]) {
    for (const bindingType of Object.keys(BINDING_PAPER_COMPATIBILITY) as BindingType[]) {
      const paperType = (bindingType === 'LW' ? '060UW444' : '080CW444') as PaperType;
      cases.push({ trimSize, bindingType, paperType, colorType: 'FC' });
    }
  }
  // Paper changes the spine width; page count does too
  cases.push(
    { trimSize: '0600X0900', bindingType: 'PB', paperType: '060UW444', colorType: 'BW', pages: 124 },
    { trimSize: '0600X0900', bindingType: 'PB', paperType: '060UC444', colorType: 'BW', pages: 124 },
    { trimSize: '0600X0900', bindingType: 'CW', paperType: '060UC444', colorType: 'BW', pages: 124 },
    { trimSize: '0600X0900', bindingType: 'CW', paperType: '080CW444', colorType: 'FC', pages: 124 },
    { trimSize: '0850X1100', bindingType: 'CW', paperType: '080CW444', colorType: 'FC', pages: 300 },
    { trimSize: '0850X1100', bindingType: 'PB', paperType: '080CW444', colorType: 'FC', pages: 300 },
    { trimSize: '0850X1100', bindingType: 'CO', paperType: '080CW444', colorType: 'FC', pages: 124 },
  );
  return cases;
}

async function sampleImage(w: number, h: number, hue: [number, number, number], label: string): Promise<string> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="rgb(${hue.join(',')})"/><stop offset="1" stop-color="#fff8ee"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <text x="50%" y="50%" font-size="${Math.round(h / 8)}" text-anchor="middle" fill="#3b2f2f" font-family="Georgia">${label}</text></svg>`;
  const jpeg = await sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
}

export async function sampleBook(c: SizeCase): Promise<CookbookPrintData> {
  const dish = await sampleImage(1200, 900, [214, 140, 69], 'Dish photo');
  const card = await sampleImage(1000, 700, [240, 230, 200], 'Recipe card');
  const family = await sampleImage(900, 1200, [120, 150, 190], 'Family photo');
  const recipe = (i: number) => ({
    sectionId: i < 2 ? 's1' : 's2',
    sortOrder: i,
    data: {
      id: `sample-${i}`,
      title: ['Grandma’s Apple Pie', 'Sunday Pot Roast', 'Lemon Bars', 'Corn Chowder'][i],
      description: 'A sample recipe used to check that this book size prints correctly.',
      prepTime: 20, cookTime: 45, servings: '8',
      ingredients: [{ items: ['2 cups flour', '1 cup butter, cold', '6 apples, sliced', '3/4 cup sugar', '1 tsp cinnamon', 'Pinch of salt'] }],
      instructions: ['Mix the flour and butter until crumbly.', 'Add the apples, sugar and cinnamon.', 'Bake at 375°F for 45 minutes, until golden.'].map((text, n) => ({ step: n + 1, text })),
      tags: [],
      imageUrl: dish,
      originalImageUrl: i % 2 === 0 ? card : undefined,
    },
  });
  const limits = BINDING_PAGE_LIMITS[c.bindingType];
  return {
    title: 'Size Check',
    subtitle: `${BOOK_SIZES[c.trimSize].name} ${c.bindingType}`,
    authorName: 'grammie.ai',
    dedication: 'For everyone who cooks for the people they love.',
    minPages: Math.min(limits.max, Math.max(limits.min, c.pages ?? 0)),
    templateId: 'heirloom',
    trimSize: c.trimSize,
    bindingType: c.bindingType,
    paperType: c.paperType,
    colorType: c.colorType,
    sections: [{ id: 's1', title: 'Desserts', sortOrder: 0 }, { id: 's2', title: 'Dinners', sortOrder: 1 }],
    recipes: [0, 1, 2, 3].map(recipe) as any,
    coverData: { frontImageUrl: dish, backText: 'A sample cover.' },
    familyPhotos: { byRecipe: {}, album: [{ src: family, aspect: 0.75 }], bySection: { s1: [{ src: family, aspect: 0.75 }] } },
  };
}

/** Starts a run in the background; one at a time */
export function startSizeCheck(baseUrl: string, cases: SizeCase[] = defaultSizeCases()): SizeCheckRun {
  if (current && !current.finishedAt) return current;
  const run: SizeCheckRun = { startedAt: new Date().toISOString(), total: cases.length, results: [] };
  current = run;

  (async () => {
    const checks: Promise<void>[] = [];
    for (const c of cases) {
      const config: BookConfig = {
        trimSize: c.trimSize, colorType: c.colorType, printQuality: 'STD', bindingType: c.bindingType,
        paperType: c.paperType, coverFinish: 'M', linenColor: 'X', foilType: 'X',
      };
      const result: SizeCaseResult = { ...c, podPackageId: buildPodPackageId(config) };
      run.results.push(result);
      const unsupported = unsupportedBookReason(config);
      if (unsupported) { result.error = unsupported; continue; }
      try {
        // PDFs are made one at a time (they share one browser); Lulu checks run side by side
        const data = await sampleBook(c);
        const interior = await generateInteriorPdf(data);
        const cover = await generateCoverPdf(data, interior.pageCount);
        result.pageCount = interior.pageCount;
        const name = `sizecheck_${result.podPackageId}`;
        const interiorUrl = `${baseUrl}/lulu/pdfs/${storePdf(interior.buffer, `${name}_interior.pdf`)}`;
        const coverUrl = `${baseUrl}/lulu/pdfs/${storePdf(cover, `${name}_cover.pdf`)}`;
        checks.push(
          checkBookFilesWithLulu({ interiorUrl, coverUrl, podPackageId: result.podPackageId, pageCount: interior.pageCount })
            .then((check) => { result.check = check; })
            .catch((err) => { result.error = err?.message || String(err); }),
        );
      } catch (err: any) {
        result.error = err?.message || String(err);
      }
    }
    await Promise.all(checks);
    run.finishedAt = new Date().toISOString();
    const passed = run.results.filter((r) => r.check?.ok).length;
    console.log(`[Size check] ${passed}/${run.total} book sizes passed Lulu's file checks`);
  })().catch((err) => {
    console.error('[Size check] Run failed:', err);
    run.finishedAt = new Date().toISOString();
  });

  return run;
}
