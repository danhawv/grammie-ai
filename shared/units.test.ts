import { describe, it, expect } from 'vitest';
import { convertAmount, formatIngredientInSystem } from './units';

describe('convertAmount', () => {
  it('converts metric mass to US', () => {
    expect(convertAmount(250, 'g', 'us')).toEqual({ quantity: 8.75, unit: 'oz', converted: true });
    expect(convertAmount(1, 'kg', 'us')).toEqual({ quantity: 2.25, unit: 'lb', converted: true });
  });

  it('converts US mass to metric', () => {
    expect(convertAmount(8, 'oz', 'metric')).toEqual({ quantity: 225, unit: 'g', converted: true });
    expect(convertAmount(2, 'lb', 'metric')).toEqual({ quantity: 905, unit: 'g', converted: true });
    expect(convertAmount(5, 'lb', 'metric')).toEqual({ quantity: 2.27, unit: 'kg', converted: true });
  });

  it('converts volumes to natural kitchen units', () => {
    expect(convertAmount(2, 'cups', 'metric')).toEqual({ quantity: 480, unit: 'ml', converted: true });
    expect(convertAmount(480, 'ml', 'us')).toEqual({ quantity: 2, unit: 'cup', converted: true });
    expect(convertAmount(30, 'ml', 'us')).toEqual({ quantity: 2, unit: 'tbsp', converted: true });
    expect(convertAmount(1, 'gallon', 'metric')).toEqual({ quantity: 3.79, unit: 'l', converted: true });
  });

  it('leaves tsp/tbsp, counts, in-system, and unknown units alone', () => {
    expect(convertAmount(1, 'tsp', 'metric')).toBeNull();
    expect(convertAmount(2, 'tbsp', 'us')).toBeNull();
    expect(convertAmount(7, 'pieces', 'us')).toBeNull();
    expect(convertAmount(250, 'g', 'metric')).toBeNull();
    expect(convertAmount(1, 'cup', 'us')).toBeNull();
    expect(convertAmount(250, 'g', 'original')).toBeNull();
  });
});

describe('formatIngredientInSystem', () => {
  const strawberries = { quantity: 250, unit: 'g', item: 'strawberries' };

  it('renders the mixed-units cheesecake consistently in US', () => {
    expect(formatIngredientInSystem(strawberries, 'us')).toBe('8 3/4 oz strawberries');
    expect(formatIngredientInSystem({ quantity: 1, unit: 'tsp', item: 'sweetener' }, 'us')).toBe('1 tsp sweetener');
  });

  it('renders US recipes consistently in metric', () => {
    expect(formatIngredientInSystem({ quantity: 0.5, unit: 'cup', item: 'yogurt' }, 'metric')).toBe('120 ml yogurt');
    expect(formatIngredientInSystem({ quantity: 8, unit: 'oz', item: 'cream cheese' }, 'metric')).toBe('225 g cream cheese');
  });

  it('passes through as-written', () => {
    expect(formatIngredientInSystem(strawberries, 'original')).toBe('250 g strawberries');
  });
});
