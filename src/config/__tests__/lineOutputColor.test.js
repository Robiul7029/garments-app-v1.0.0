import { describe, it, expect } from 'vitest';
import {
  colorOptionsFor,
  addColorOption,
  matchingColor,
  colorsOf,
  COLOR_SUGGESTIONS,
} from '../orderWorkflow';

/**
 * The Total Line Output form's optional Color dropdown.
 *
 * The brief: a multi-select populated with the SELECTED ORDER's assigned colours, with
 * an inline "Type custom color..." + "+ Add" row that adds a colour, selects it for
 * the entry, and persists it for future use. The field is OPTIONAL throughout.
 */

const ORDER = { order_no: 'PO-105', style: 'STY-1001', color: 'Navy, Black' };

describe('the colour options', () => {
  it('offers the selected order’s own colours first', () => {
    const options = colorOptionsFor(ORDER, []);
    expect(options[0]).toMatchObject({ value: 'Navy', hint: 'On this order' });
    expect(options[1]).toMatchObject({ value: 'Black', hint: 'On this order' });
  });

  it('follows the standard suggestions, without a source hint', () => {
    const options = colorOptionsFor(ORDER, []);
    const suggestion = options.find((o) => o.value === 'White');
    expect(suggestion).toMatchObject({ hint: '' });
    expect(COLOR_SUGGESTIONS).toContain('White');
  });

  it('carries a colour added by hand, flagged as such', () => {
    const options = colorOptionsFor(ORDER, ['Bottle Green']);
    expect(options.find((o) => o.value === 'Bottle Green')).toMatchObject({ hint: 'Added by you' });
  });

  it('never lists a colour twice, whatever its casing', () => {
    // "navy" is on the order; adding "NAVY" by hand must not make a second entry.
    const options = colorOptionsFor(ORDER, ['navy', 'NAVY']);
    expect(options.filter((o) => o.value.toLowerCase() === 'navy')).toHaveLength(1);
  });

  it('does not duplicate a standard suggestion the order already carries', () => {
    const options = colorOptionsFor({ color: 'White' }, []);
    expect(options.filter((o) => o.value === 'White')).toHaveLength(1);
    // And it is the ORDER's entry that wins, so the hint is kept.
    expect(options.find((o) => o.value === 'White').hint).toBe('On this order');
  });

  it('pre-loads NO colour when no order is selected', () => {
    // Nothing order-specific and no suggestion is offered before an order is picked: a
    // form with no Order No must not list colours that belong to some other order. The
    // dropdown's own "Type custom color..." + "+ Add" row is what fills it.
    expect(colorOptionsFor(null, [])).toEqual([]);
    expect(colorOptionsFor(undefined, [])).toEqual([]);
  });

  it('still lists the colours added by hand with no order selected', () => {
    const options = colorOptionsFor(null, ['Bottle Green']);
    expect(options).toEqual([{ value: 'Bottle Green', label: 'Bottle Green', hint: 'Added by you' }]);
  });

  it('tolerates a malformed order and a malformed added list', () => {
    // No order and nothing added: an empty list, not a crash.
    expect(colorOptionsFor(undefined, undefined)).toEqual([]);
    // A bare string where a list is expected is read as ONE added colour rather than
    // crashing — `splitValues` accepts a string, which is the same tolerance the rest
    // of the app relies on for a hand-typed value.
    expect(colorOptionsFor({}, 'Bottle Green').map((o) => o.value)).toContain('Bottle Green');
    // A non-list added value is stringified by `splitValues`, which is its existing
    // tolerance for a hand-typed value — so a stray number becomes a colour rather
    // than throwing. Nothing here crashes on a malformed store.
    expect(colorOptionsFor({}, 42).map((o) => o.value)).toContain('42');
  });

  it('auto-maps the order’s colours once an order is selected', () => {
    // The selected order's assigned colours lead the list — the auto-mapping the
    // brief asks for — with the suggestions after them.
    const values = colorOptionsFor(ORDER, []).map((o) => o.value);
    expect(values.slice(0, 2)).toEqual(['Navy', 'Black']);
    expect(values).toContain('White');
    // Omitting the suggestions keeps only the order's colours plus the hand-added ones.
    expect(colorOptionsFor(ORDER, [], { includeSuggestions: false }).map((o) => o.value))
      .toEqual(['Navy', 'Black']);
  });

  it('reads an order that stores its colours as an array', () => {
    expect(colorsOf({ colors: ['Red', 'Blue'] })).toEqual(['Red', 'Blue']);
  });
});

describe('adding a colour by hand', () => {
  it('prepends the new colour, so it is not buried', () => {
    expect(addColorOption([], 'Bottle Green', [])).toEqual(['Bottle Green']);
    expect(addColorOption(['Bottle Green'], 'Mustard', [])).toEqual(['Mustard', 'Bottle Green']);
  });

  it('trims and collapses what it stores', () => {
    expect(addColorOption([], '  Sky   Blue  ', [])).toEqual(['Sky Blue']);
  });

  it('returns null for a blank value, so nothing is written', () => {
    expect(addColorOption([], '', [])).toBeNull();
    expect(addColorOption([], '   ', [])).toBeNull();
    expect(addColorOption([], undefined, [])).toBeNull();
  });

  it('returns null when the list already carries it, in any casing', () => {
    // The caller then SELECTS the existing spelling rather than adding a second entry.
    expect(addColorOption([], 'navy', [{ value: 'Navy' }])).toBeNull();
    expect(addColorOption(['Navy'], 'NAVY', [])).toBeNull();
    expect(addColorOption([], 'White', COLOR_SUGGESTIONS.map((c) => ({ value: c })))).toBeNull();
  });
});

describe('selecting the added colour', () => {
  it('uses the typed value when it is new', () => {
    expect(matchingColor('Bottle Green', colorOptionsFor(ORDER, []))).toBe('Bottle Green');
  });

  it('uses the list’s own spelling when the colour already exists', () => {
    // Adding "navy" must select the order's "Navy", not create a second chip.
    expect(matchingColor('navy', colorOptionsFor(ORDER, []))).toBe('Navy');
    expect(matchingColor('  BLACK ', colorOptionsFor(ORDER, []))).toBe('Black');
  });

  it('returns an empty string for a blank value', () => {
    expect(matchingColor('   ', colorOptionsFor(ORDER, []))).toBe('');
  });
});

describe('the field is optional and English', () => {
  it('is not required — an empty colour list is a valid state', () => {
    // The brief: submitting without selecting a colour must remain valid. Nothing in
    // these helpers rejects or flags an empty selection.
    expect(colorOptionsFor(ORDER, [])).toBeTruthy();
    expect(addColorOption([], '', [])).toBeNull(); // a blank is a no-op, not an error
  });

  it('uses only English labels and hints', () => {
    const options = colorOptionsFor(ORDER, ['Bottle Green']);
    [...new Set(options.map((o) => o.hint).filter(Boolean))].forEach((hint) => {
      expect(/^[A-Za-z ]+$/.test(hint)).toBe(true);
    });
  });
});
