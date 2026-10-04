import { describe, it, expect } from 'vitest';
import { templateFromStyleAnalysis, sanitizeLayout } from './template-from-photos';
import { customTemplateDataSchema } from './schema';

describe('templateFromStyleAnalysis', () => {
  it('builds a valid template from a good analysis', () => {
    const t = templateFromStyleAnalysis({
      name: 'Golden Farmhouse',
      headingFont: 'playfair display',
      bodyFont: 'Inter',
      colors: { title: '#1F1A14', text: '#333', accent: '#E3A72F', background: '#FFFFFF' },
      layout: { photo: 'right', columns: 'two', stepMarker: 'circle', titleScale: 1.4 },
    });
    expect(customTemplateDataSchema.safeParse(t.templateData).success).toBe(true);
    expect(t.name).toBe('Golden Farmhouse');
    expect(t.templateData.fonts.heading.family).toBe('Playfair Display');
    expect(t.templateData.colors.textColor).toBe('#333333');
    expect(t.templateData.layout?.columns).toBe('two');
    expect(t.templateData.layout?.titleScale).toBe(1.4);
  });

  it('survives garbage from the model', () => {
    const t = templateFromStyleAnalysis({
      name: 42,
      headingFont: 'Comic Sans; } body { display:none',
      colors: { accent: 'red', background: 'url(javascript:alert(1))' },
      layout: { photo: 'diagonal', titleScale: 99, cornerRadius: -5, badges: 'yes' },
      dividerStyle: 'wavy',
    });
    expect(customTemplateDataSchema.safeParse(t.templateData).success).toBe(true);
    expect(t.name).toBe('Photo Match');
    expect(t.templateData.fonts.heading.family).toBe('Playfair Display');
    expect(t.templateData.colors.accentColor).toMatch(/^#[0-9a-f]{6}$/);
    expect(t.templateData.layout?.photo).toBe('right');
    expect(t.templateData.layout?.titleScale).toBe(1.6);
    expect(t.templateData.layout?.cornerRadius).toBe(0);
  });

  it('replaces a title color that would vanish on the page background', () => {
    const t = templateFromStyleAnalysis({ colors: { title: '#ffffff', text: '#4a4a4a', background: '#fdf8ef' } });
    expect(t.templateData.colors.titleColor).not.toBe('#ffffff');
    expect(t.templateData.colors.textColor).toBe('#4a4a4a');
  });

  it('keeps valid layout fields when others are invalid', () => {
    const l = sanitizeLayout({ photo: 'top', columns: 'seven', panels: 'plain' });
    expect(l.photo).toBe('top');
    expect(l.columns).toBe('auto');
    expect(l.panels).toBe('plain');
  });
});
