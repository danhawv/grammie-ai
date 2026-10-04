import { describe, it, expect, afterAll } from 'vitest';
import { getBookSizeConfig } from '../lulu/book-sizes';
import {
  buildInteriorHtml,
  generateInteriorPdf,
  getTocMetrics,
  paginateToc,
  closeSharedBrowser,
  type CookbookPrintData,
} from './generator';

// Smoke test: builds a small real book. Catches the regressions that shipped
// silently before tests existed — dropped ingredient names, fonts falling back
// to Times, dedication pages vanishing, broken page counts.

const fixture: CookbookPrintData = {
  title: 'Test Kitchen',
  subtitle: 'A tiny fixture book',
  authorName: 'Vitest',
  dedication: 'For the CI pipeline.',
  templateId: 'classic',
  trimSize: '0600X0900',
  bindingType: 'PB',
  paperType: '060UW444',
  sections: [{ id: 's1', title: 'Basics', sortOrder: 0 }],
  recipes: [
    {
      sectionId: 's1',
      sortOrder: 0,
      data: {
        id: 'r1',
        title: 'Hummus',
        description: 'Smooth and creamy.',
        prepTime: 10,
        servings: '4',
        ingredients: [{ items: ['1/2 cup yogurt', '1 tbsp tahini', '2 cloves garlic, peeled'] }],
        instructions: [
          { step: 1, text: 'Blend everything.' },
          { step: 2, text: 'Serve chilled.' },
        ],
        tags: [],
      },
    },
    {
      sectionId: 's1',
      sortOrder: 1,
      data: {
        id: 'r2',
        title: 'Tataki de bœuf à la grenade',
        description: 'Unicode stress test: œ é à.',
        ingredients: [{ items: ['500 g Faux filet de bœuf, entier'] }],
        instructions: [{ step: 1, text: 'Préparer la marinade.' }],
        tags: [],
      },
    },
  ],
  customizations: { showTips: false, showNutrition: false, showVariations: false },
  customTemplateData: {
    fonts: {
      heading: { family: 'Playfair Display', weight: '700', source: 'google' },
      body: { family: 'Inter', weight: '400', source: 'google' },
    },
    colors: {
      titleColor: '#1f1c17',
      subtitleColor: '#6b6156',
      textColor: '#33302b',
      accentColor: '#c1502e',
      borderColor: '#e5ddd0',
      bgColor: '#fbf9f5',
      sectionBg: '#f3eee6',
    },
    cover: { backgroundColor: '#22382c', textColor: '#f5efe2' },
  },
};

afterAll(async () => {
  await closeSharedBrowser();
});

describe('buildInteriorHtml', () => {
  const config = getBookSizeConfig('0600X0900' as any, 'PB' as any);
  const html = buildInteriorHtml(config, fixture);

  it('includes every ingredient line', () => {
    expect(html).toContain('1/2 cup yogurt');
    expect(html).toContain('1 tbsp tahini');
    expect(html).toContain('500 g Faux filet de bœuf, entier');
  });

  it('applies the template body font globally (the Times-fallback bug)', () => {
    expect(html).toMatch(/body\s*{[^}]*font-family:[^}]*Inter/s);
  });

  it('renders the dedication page', () => {
    expect(html).toContain('For the CI pipeline.');
  });

  it('renders the TOC with single page numbers', () => {
    expect(html).toContain('Contents');
    expect(html).not.toContain('p.7'); // old double-numbering format
  });

  it('fills page 2 with a copyright page when there is no dedication', () => {
    const noDedication = buildInteriorHtml(config, { ...fixture, dedication: undefined });
    expect(noDedication).toContain('Copyright ©');
  });

  it('never pads with blank pages between front matter and recipes', () => {
    // Blank pages render as an empty .page div; one-page recipes shouldn't
    // force right-hand starts, so only the final even-count pad may be blank
    const blanks = html.match(/<div class="page" style="[^"]*"><\/div>/g) || [];
    expect(blanks.length).toBeLessThanOrEqual(1);
  });

  it('uses custom template colors', () => {
    expect(html).toContain('#c1502e'); // accent
    expect(html).toContain('#22382c'); // cover background
  });
});

describe('multi-page Contents', () => {
  const config = getBookSizeConfig('0600X0900' as any, 'PB' as any);
  const many = (n: number, sectionId: string | undefined, prefix: string) =>
    Array.from({ length: n }, (_, i) => ({
      sectionId: sectionId as string,
      sortOrder: i,
      data: { ...fixture.recipes[0].data, id: `${prefix}${i}`, title: `${prefix} Recipe ${i + 1}` },
    }));
  const big: CookbookPrintData = {
    ...fixture,
    sections: [
      { id: 'a', title: 'Mains', sortOrder: 0 },
      { id: 'b', title: 'Desserts', sortOrder: 1 },
    ],
    recipes: [...many(40, 'a', 'Main'), ...many(25, 'b', 'Dessert')],
  };

  it('splits a long list across pages and never ends a page on a heading', () => {
    const m = getTocMetrics(config, config.pageWidthWithBleed * 96);
    const entries = [{ isSection: true }, ...Array(40).fill({ isSection: false }),
      { isSection: true }, ...Array(25).fill({ isSection: false })];
    const pages = paginateToc(entries, m);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.flat().length).toBe(entries.length);
    for (const p of pages) expect(p[p.length - 1].isSection).toBe(false);
  });

  it('lists every recipe and points each at its real page', async () => {
    const result = await generateInteriorPdf(big);
    if (process.env.TOC_PDF_OUT) (await import('node:fs')).writeFileSync(process.env.TOC_PDF_OUT, result.buffer);
    const { execFileSync } = await import('node:child_process');
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    let text: string;
    try {
      const f = join(mkdtempSync(join(tmpdir(), 'toc-')), 'book.pdf');
      writeFileSync(f, result.buffer);
      text = execFileSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' });
    } catch {
      return; // pdftotext not installed; the pagination unit test still covers the split
    }
    const pageTexts = text.split('\f');
    const contents = pageTexts.filter((t, i) => i >= 2 && i < 6 && /Recipe \d/.test(t) && !/INGREDIENTS/i.test(t)).join('\n');
    for (const title of ['Main Recipe 1', 'Main Recipe 40', 'Dessert Recipe 25']) {
      const m = contents.match(new RegExp(title + '\\b[ .]*?(\\d+)\\s*$', 'm'));
      expect(m, `${title} missing from Contents`).toBeTruthy();
      const page = Number(m![1]);
      expect(pageTexts[page - 1]).toContain(title);
    }
  }, 120_000);
});

describe('generateInteriorPdf (Chromium)', () => {
  it('produces a valid PDF with an even page count', async () => {
    const result = await generateInteriorPdf(fixture);
    expect(result.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(result.pageCount).toBeGreaterThanOrEqual(6);
    expect(result.pageCount % 2).toBe(0); // Lulu requires even
    expect(result.buffer.length).toBeGreaterThan(10_000);
  }, 60_000);
});
