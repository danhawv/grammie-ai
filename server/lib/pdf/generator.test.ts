import { describe, it, expect, afterAll } from 'vitest';
import { getBookSizeConfig } from '../lulu/book-sizes';
import {
  buildInteriorHtml,
  generateInteriorPdf,
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

  it('uses custom template colors', () => {
    expect(html).toContain('#c1502e'); // accent
    expect(html).toContain('#22382c'); // cover background
  });
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
