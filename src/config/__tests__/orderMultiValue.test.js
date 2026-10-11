import { describe, it, expect } from 'vitest';
import {
  splitValues,
  joinValues,
  colorsOf,
  sizesOf,
  variantsOf,
  orderPrefill,
  SIZE_PRESETS,
  FULL_SIZE_RANGE,
  COLOR_SUGGESTIONS,
} from '../orderWorkflow';

/**
 * Tests for multi-colour and multi-size orders.
 *
 * The stored value stays a plain comma-separated STRING — that is the contract
 * every existing reader relies on. These tests pin both ends: that any way of
 * typing a list parses into the right parts, and that what is saved is the
 * canonical form the tables and CSV export expect.
 */
describe('splitting a stored multi-value', () => {
  it('splits on a comma', () => {
    expect(splitValues('Navy, Black, Red')).toEqual(['Navy', 'Black', 'Red']);
  });

  it('accepts every separator a supervisor is likely to type', () => {
    // The field is free text; refusing a format would mean retyping the order.
    expect(splitValues('Navy;Black')).toEqual(['Navy', 'Black']);
    expect(splitValues('Navy/Black')).toEqual(['Navy', 'Black']);
    expect(splitValues('Navy|Black')).toEqual(['Navy', 'Black']);
  });

  it('trims surrounding whitespace on every part', () => {
    expect(splitValues('  Navy ,   Black  ')).toEqual(['Navy', 'Black']);
  });

  it('passes a single value through as one part', () => {
    expect(splitValues('Navy')).toEqual(['Navy']);
  });

  it('drops empty parts from a trailing separator', () => {
    expect(splitValues('Navy,,Black,')).toEqual(['Navy', 'Black']);
  });

  it('accepts an array, so a future editor storing a real list still reads', () => {
    expect(splitValues(['Navy', 'Black'])).toEqual(['Navy', 'Black']);
  });

  it('handles a missing value without throwing', () => {
    expect(splitValues('')).toEqual([]);
    expect(splitValues(null)).toEqual([]);
    expect(splitValues(undefined)).toEqual([]);
  });

  it('keeps a multi-word colour intact', () => {
    // "Grey Melange" is one colour, and must not be split on its space.
    expect(splitValues('Grey Melange, Navy')).toEqual(['Grey Melange', 'Navy']);
  });
});

describe('joining parts for storage', () => {
  it('joins with a comma and a space — the stored format', () => {
    expect(joinValues(['Navy', 'Black'])).toBe('Navy, Black');
  });

  it('removes duplicates case-insensitively, keeping the first casing', () => {
    expect(joinValues(['Navy', 'navy', 'NAVY'])).toBe('Navy');
    expect(joinValues(['Navy', 'Black', 'navy'])).toBe('Navy, Black');
  });

  it('drops empty entries', () => {
    expect(joinValues(['Navy', '', '  ', 'Black'])).toBe('Navy, Black');
    expect(joinValues([])).toBe('');
  });

  it('round-trips through split and join without loss', () => {
    const stored = 'Navy, Black, Red';
    expect(joinValues(splitValues(stored))).toBe(stored);
  });

  it('normalises a messy input into the canonical stored form', () => {
    expect(joinValues(splitValues(' navy ;black/red '))).toBe('navy, black, red');
  });
});

describe('reading colours and sizes off an order', () => {
  it('reads the colours', () => {
    expect(colorsOf({ color: 'Navy, Black' })).toEqual(['Navy', 'Black']);
  });

  it('reads the sizes', () => {
    expect(sizesOf({ size_range: 'XS, S, M, L' })).toEqual(['XS', 'S', 'M', 'L']);
  });

  it('accepts the plural keys another writer might use', () => {
    expect(colorsOf({ colors: 'Navy, Black' })).toEqual(['Navy', 'Black']);
    expect(sizesOf({ sizes: 'S, M' })).toEqual(['S', 'M']);
  });

  it('returns nothing for an order without the fields', () => {
    expect(colorsOf({})).toEqual([]);
    expect(sizesOf({})).toEqual([]);
    expect(colorsOf(null)).toEqual([]);
  });
});

describe('the variant count', () => {
  it('multiplies colours by sizes', () => {
    const counts = variantsOf({ color: 'Navy, Black, Red', size_range: 'S, M, L, XL' });
    expect(counts).toEqual({ colors: 3, sizes: 4, combinations: 12 });
  });

  it('reports zero combinations when either side is empty', () => {
    expect(variantsOf({ color: 'Navy' }).combinations).toBe(0);
    expect(variantsOf({}).combinations).toBe(0);
  });

  it('handles a large order', () => {
    // Five colours across ten sizes is 50 variants — the case the old
    // single-text-box field made impossible to check at a glance.
    const counts = variantsOf({
      color: 'Navy, Black, Red, White, Charcoal',
      size_range: 'XXS, XS, S, M, L, XL, XXL, 3XL, 4XL, 5XL',
    });
    expect(counts).toEqual({ colors: 5, sizes: 10, combinations: 50 });
  });
});

describe('prefill carries multi-value fields onto a production entry', () => {
  it('passes the colours and sizes through as stored strings', () => {
    const prefill = orderPrefill({
      style: 'STY-1001',
      color: 'Navy, Black, Red',
      size_range: 'XS, S, M, L, XL, XXL, 3XL, 4XL',
      qty: 5000,
    });
    expect(prefill.color).toBe('Navy, Black, Red');
    expect(prefill.size_range).toBe('XS, S, M, L, XL, XXL, 3XL, 4XL');
    expect(prefill.po_qty).toBe(5000);
  });

  it('keeps a long size range intact rather than truncating it', () => {
    const range = 'XXS, XS, S, M, L, XL, XXL, 3XL, 4XL, 5XL, 6XL';
    expect(orderPrefill({ style: 'S', size_range: range }).size_range).toBe(range);
    expect(sizesOf({ size_range: range })).toHaveLength(11);
  });

  it('omits the fields when the order has none', () => {
    const prefill = orderPrefill({ style: 'STY-1' });
    expect(prefill).not.toHaveProperty('color');
    expect(prefill).not.toHaveProperty('size_range');
  });
});

describe('the size and colour presets', () => {
  it('offers the full standard ladder smallest to largest', () => {
    expect(SIZE_PRESETS).toEqual([
      'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL', '6XL',
    ]);
  });

  it('covers the eight-size range the order form must support', () => {
    // The brief names exactly this range: XS through 4XL must all be preset.
    ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL']
      .forEach((size) => expect(FULL_SIZE_RANGE).toContain(size));
    expect(FULL_SIZE_RANGE).toHaveLength(8);
  });

  it('offers useful colour suggestions including the ones in the brief', () => {
    ['Navy', 'Black', 'Red', 'White', 'Charcoal']
      .forEach((color) => expect(COLOR_SUGGESTIONS).toContain(color));
  });

  it('has no duplicate sizes in the ladder', () => {
    expect(new Set(SIZE_PRESETS).size).toBe(SIZE_PRESETS.length);
  });
});
