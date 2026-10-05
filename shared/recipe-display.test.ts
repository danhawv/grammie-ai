import { describe, it, expect } from 'vitest';
import { formatAmount, formatMinutes, formatQuantityNumber, ingredientDisplay } from './recipe-display';

describe('formatQuantityNumber', () => {
  it('uses kitchen fractions', () => {
    expect(formatQuantityNumber(4.5)).toBe('4½');
    expect(formatQuantityNumber(0.25)).toBe('¼');
    expect(formatQuantityNumber(0.333)).toBe('⅓');
    expect(formatQuantityNumber(1.67)).toBe('1⅔');
    expect(formatQuantityNumber(0.125)).toBe('⅛');
  });
  it('keeps whole numbers and other decimals readable', () => {
    expect(formatQuantityNumber(12)).toBe('12');
    expect(formatQuantityNumber(2.27)).toBe('2.27');
    expect(formatQuantityNumber(1.99)).toBe('2');
    expect(formatQuantityNumber(0)).toBe('');
  });
});

describe('formatAmount', () => {
  it('puts the unit after the number', () => {
    expect(formatAmount(4.5, 'lb')).toBe('4½ lb');
    expect(formatAmount(2, undefined)).toBe('2');
    expect(formatAmount(undefined, 'cup')).toBe('');
  });
  it('drops pseudo count units', () => {
    expect(formatAmount(4, 'unit')).toBe('4');
    expect(formatAmount(0.5, 'kg')).toBe('0.5 kg');
    expect(formatAmount(3, 'Whole')).toBe('3');
  });
});

describe('ingredientDisplay', () => {
  it('splits amount, name and preparation', () => {
    expect(ingredientDisplay({ quantity: 4.5, unit: 'lb', item: 'chicken breast', preparation: 'diced' }, 'original'))
      .toEqual({ amount: '4½ lb', name: 'chicken breast', preparation: 'diced', optional: false });
  });
  it('converts units', () => {
    expect(ingredientDisplay({ quantity: 2, unit: 'cups', item: 'milk' }, 'metric').amount).toBe('480 ml');
  });
  it('falls back to the raw line', () => {
    expect(ingredientDisplay({ raw: 'a pinch of salt' }, 'us')).toEqual({ amount: '', name: 'a pinch of salt', preparation: '', optional: false });
  });
});

describe('formatMinutes', () => {
  it('formats hours and minutes', () => {
    expect(formatMinutes(95)).toBe('1 hr 35 min');
    expect(formatMinutes(60)).toBe('1 hr');
    expect(formatMinutes(20)).toBe('20 min');
    expect(formatMinutes(null)).toBe('');
    expect(formatMinutes(0)).toBe('');
  });
});
