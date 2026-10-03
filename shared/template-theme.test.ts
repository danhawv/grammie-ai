import { describe, it, expect } from 'vitest';
import { buildThemeConfigFromTemplate, isColorDark, lightenColor, darkenColor } from './template-theme';
import type { CustomTemplateData } from './schema';

const baseTemplate: CustomTemplateData = {
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
};

describe('color utilities', () => {
  it('classifies dark and light colors', () => {
    expect(isColorDark('#22382c')).toBe(true);
    expect(isColorDark('#fbf9f5')).toBe(false);
    expect(isColorDark('linear-gradient(...)')).toBe(true); // non-hex defaults dark
  });

  it('lightens and darkens hex colors', () => {
    expect(lightenColor('#000000', 1)).toBe('#ffffff');
    expect(darkenColor('#ffffff', 1)).toBe('#000000');
    expect(lightenColor('#c1502e', 0)).toBe('#c1502e');
  });
});

describe('buildThemeConfigFromTemplate', () => {
  it('maps template colors and fonts into the ThemeConfig', () => {
    const theme = buildThemeConfigFromTemplate(baseTemplate);
    expect(theme.bg).toBe('#fbf9f5');
    expect(theme.accent).toBe('#c1502e');
    expect(theme.titleFont).toContain('Playfair Display');
    expect(theme.bodyFont).toContain('Inter');
    expect(theme.coverDark).toBe(true); // dark green cover
    expect(theme.titleColor).toBe('#1f1c17');
    expect(theme.textColor).toBe('#33302b');
  });

  it('derives accent variants deterministically (preview must match PDF)', () => {
    const a = buildThemeConfigFromTemplate(baseTemplate);
    const b = buildThemeConfigFromTemplate(baseTemplate);
    expect(a).toEqual(b);
    expect(a.accentLight).toBe(lightenColor('#c1502e', 0.9));
    expect(a.badgeText).toBe(darkenColor('#c1502e', 0.3));
  });

  it('parses fontSizes strings into px numbers, ignoring invalid values', () => {
    const theme = buildThemeConfigFromTemplate({
      ...baseTemplate,
      fontSizes: { recipeTitle: '28px', body: '13px', title: 'garbage' },
    });
    expect(theme.fontSizes?.recipeTitle).toBe(28);
    expect(theme.fontSizes?.body).toBe(13);
    expect(theme.fontSizes?.title).toBeUndefined();
  });
});
