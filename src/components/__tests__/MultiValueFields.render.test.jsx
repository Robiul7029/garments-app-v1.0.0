import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ColorTagInput from '../ColorTagInput';
import SizeRangeInput from '../SizeRangeInput';
import MultiSelectDropdown from '../MultiSelectDropdown';
import { MultiValueCell } from '../DailyProductionSheet';

/**
 * Renders the two multi-value controls and the shared display cell.
 *
 * These assert the markup the user actually gets: a dropdown of checkboxes with
 * a counter badge, the chosen values shown as removable chips in the closed box,
 * and a row to add a value the list does not carry.
 */

const render = (element) => renderToStaticMarkup(element);

describe('the colour field (checkbox dropdown)', () => {
  it('renders as a dropdown control with a counter badge', () => {
    const html = render(<ColorTagInput value="Navy, Black, Red" onChange={() => {}} />);
    expect(html).toContain('msd-wrap');
    expect(html).toContain('msd-control');
    expect(html).toContain('msd-counter');
    // The badge shows exactly how many colours are selected.
    expect(html).toContain('>3</span>');
  });

  it('shows each selected colour as a removable chip', () => {
    const html = render(<ColorTagInput value="Navy, Black, Red" onChange={() => {}} />);
    expect((html.match(/msd-chip-remove/g) || [])).toHaveLength(3);
    expect(html).toContain('aria-label="Remove Navy"');
    expect(html).toContain('aria-label="Remove Red"');
  });

  it('shows a prompt and a zero count when empty', () => {
    const html = render(<ColorTagInput value="" onChange={() => {}} placeholder="Select colours…" />);
    expect(html).toContain('Select colours…');
    expect(html).toContain('>0</span>');
    expect(html).not.toContain('msd-chip-remove');
  });

  it('renders read-only when disabled', () => {
    const html = render(<ColorTagInput value="Navy" onChange={() => {}} disabled />);
    expect(html).toContain('msd-disabled');
    expect(html).not.toContain('msd-chip-remove');
  });
});

describe('the size range field (checkbox dropdown)', () => {
  it('renders as a dropdown control with a counter badge', () => {
    const html = render(<SizeRangeInput value="S, M, L" onChange={() => {}} />);
    expect(html).toContain('msd-wrap');
    expect(html).toContain('msd-counter');
    expect(html).toContain('>3</span>');
  });

  it('tones the size chips apart from the colour chips', () => {
    const sizes = render(<SizeRangeInput value="S, M" onChange={() => {}} />);
    const colors = render(<ColorTagInput value="Navy" onChange={() => {}} />);
    expect(sizes).toContain('msd-tone-size');
    expect(colors).toContain('msd-tone-color');
  });

  it('counts a ten-size range without truncation', () => {
    const ten = 'XXS, XS, S, M, L, XL, XXL, 3XL, 4XL, 5XL';
    const html = render(<SizeRangeInput value={ten} onChange={() => {}} />);
    expect(html).toContain('>10</span>');
    expect(html).toContain('>3XL<');
  });

  it('keeps a custom size visible as a chip', () => {
    const html = render(<SizeRangeInput value="S, 7XL" onChange={() => {}} />);
    expect(html).toContain('>7XL<');
    expect(html).toContain('>2</span>');
  });
});

describe('the checkbox dropdown control', () => {
  it('wires up the listbox accessibility contract', () => {
    const html = render(
      <MultiSelectDropdown value="Navy" onChange={() => {}} options={['Navy', 'Black']} ariaLabel="Colours" />,
    );
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Colours"');
  });

  it('shows selected values as chips in the closed box, not as checkboxes', () => {
    const html = render(
      <MultiSelectDropdown value="Navy, Black" onChange={() => {}} options={['Navy', 'Black', 'Red']} />,
    );
    expect((html.match(/msd-chip-label/g) || [])).toHaveLength(2);
    expect(html).not.toContain('msd-checkbox');
  });
});

describe('the shared multi-value display cell', () => {
  it('renders each value as its own chip', () => {
    const html = render(<MultiValueCell value="Navy, Black, Red" />);
    expect((html.match(/mv-chip/g) || [])).toHaveLength(3);
  });

  it('renders a single value without a chip, as it always did', () => {
    // A record entered before multi-value support must look unchanged.
    const html = render(<MultiValueCell value="Navy" />);
    expect(html).toBe('<span>Navy</span>');
  });

  it('renders a dash for an empty value', () => {
    expect(render(<MultiValueCell value="" />)).toBe('<span>—</span>');
    expect(render(<MultiValueCell value={null} />)).toBe('<span>—</span>');
  });

  it('tones the size chips differently from the colour chips', () => {
    const colors = render(<MultiValueCell value="Navy, Black" />);
    const sizes = render(<MultiValueCell value="S, M" tone="size" />);
    expect(colors).not.toContain('mv-chip-size');
    expect(sizes).toContain('mv-chip-size');
  });
});
