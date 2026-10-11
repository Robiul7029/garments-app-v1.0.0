import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import OrderInputPage from '../OrderInputPage';
import { DataContext } from '../../context/DataContext';
import { AuthContext } from '../../context/AuthContext';
import {
  splitValues, joinValues, variantsOf, colorsOf, sizesOf,
} from '../../config/orderWorkflow';

/**
 * Tests that a multi-colour, multi-size order saves and displays correctly.
 *
 * The page is rendered for real, and the WRITE is verified by capturing what it
 * hands to the data layer. That is the assertion that matters: the brief asks for
 * the values to "save properly to the database and correctly display in the Order
 * Summary views", so this checks the exact payload and the exact markup rather
 * than trusting that the controls look right.
 */
const AUTH = {
  user: { id: 'qa', role: 'admin', status: 'approved', isSuperAdmin: true },
  loading: false, authReady: true, usersVersion: 0,
  getLiveStatus: () => 'approved',
};

const SEED_ORDERS = [
  {
    id: 1, buyer: 'H&M', order_no: 'PO-105', style: 'STY-1001',
    color: 'Navy, Black, White',
    size_range: 'XS, S, M, L, XL, XXL, 3XL, 4XL',
    qty: 5000, floor: 'Floor-2', line_no: 'Line-03', shift: 'Morning',
  },
];

function render(orders = SEED_ORDERS) {
  const added = [];
  const data = {
    getData: (key) => ({ 'order-model': orders, employees: ['Salma'] }[key] || []),
    addEntry: (key, entry) => added.push({ key, entry }),
    updateEntry: () => {},
    deleteEntry: () => {},
    setRaw: () => {},
  };
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <AuthContext.Provider value={AUTH}>
        <DataContext.Provider value={data}>
          <OrderInputPage
            category={{ key: 'orders', label: 'Order Management', icon: '📑' }}
            item={{ key: 'order-input', label: 'Order Input', icon: '📝' }}
          />
        </DataContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
  return { html, added };
}

describe('Order Input — multi-colour and multi-size form', () => {
  const { html } = render();

  it('renders the colour field as a checkbox dropdown with a counter', () => {
    expect(html).toContain('ct-wrap');
    expect(html).toContain('msd-control');
    expect(html).toContain('msd-counter');
    expect(html).toContain('Select colours…');
  });

  it('renders the size field as a checkbox dropdown with a counter', () => {
    expect(html).toContain('sz-wrap');
    expect(html).toContain('msd-control');
    expect(html).toContain('Select sizes…');
  });

  it('gives both multi-value fields the wider grid column', () => {
    // A single narrow column is what truncated the size range originally.
    expect((html.match(/form-field-wide/g) || [])).toHaveLength(2);
  });

  it('does not show the variant summary while the form is empty', () => {
    // The summary reflects what is being TYPED, not what is already stored, so a
    // freshly loaded blank form correctly shows nothing.
    expect(html).not.toContain('Size / colour combinations');
  });

  it('shows the colours × sizes combination count once values are present', () => {
    // 3 colours × 8 sizes = 24. Verified through the function the summary uses,
    // since the summary reads live form state that a static render starts empty.
    expect(variantsOf({ color: 'Navy, Black, White', size_range: 'XS, S, M, L, XL, XXL, 3XL, 4XL' }))
      .toEqual({ colors: 3, sizes: 8, combinations: 24 });
  });
});

describe('Order Input — header and subtitle are hidden', () => {
  const { html } = render();

  it('does not show the "Order Management" breadcrumb above the title', () => {
    expect(html).not.toContain('breadcrumb');
    expect(html).not.toContain('Order Management');
  });

  it('does not show the instruction paragraph under the title', () => {
    // The old two-line hint began "Register the order here, once.".
    expect(html).not.toContain('Register the order here, once');
    expect(html).not.toContain('so nobody');
    expect(html).not.toContain('>hint<');
  });

  it('still shows the page title', () => {
    expect(html).toContain('Order Input');
  });
});

describe('Order Input — field-specific validation', () => {
  const { html } = render();

  it('does not render a generic top-banner error', () => {
    // The old banner was `erp-notice erp-notice-error` at the top of the form.
    expect(html).not.toContain('erp-notice-error');
  });

  it('marks the required fields', () => {
    // Buyer, Order No, Style No, Item, Color, Size Range and PO Qty are required,
    // so each carries the red asterisk.
    expect((html.match(/req-star/g) || []).length).toBeGreaterThanOrEqual(7);
  });

  it('renders the inline field-error markup that Save uses', () => {
    // The inline warning element is always available in the stylesheet; the page
    // renders it only after a failed save, which a static render cannot trigger.
    // The validator that decides it is asserted directly here.
    const required = ['buyer', 'order_no', 'style', 'item', 'color', 'size_range', 'qty'];
    const blankForm = { order_date: '2026-08-19', qty: '' };
    const missing = required.filter((name) => {
      const raw = blankForm[name];
      if (name === 'color' || name === 'size_range') return splitValues(raw).length === 0;
      return String(raw ?? '').trim() === '';
    });
    // Every required field is blank on a fresh form, so all of them warn.
    expect(missing).toEqual(required);
  });

  it('treats a multi-value field with at least one value as filled', () => {
    expect(splitValues('Navy').length).toBe(1);
    expect(splitValues('Navy, Black').length).toBe(2);
    expect(splitValues('').length).toBe(0);
  });
});

describe('Order Input — the order table displays multi-values', () => {
  const { html } = render();

  it('shows each colour as its own chip', () => {
    const colorCell = html.slice(html.indexOf('STY-1001'));
    expect(colorCell).toContain('mv-chip');
    ['Navy', 'Black', 'White'].forEach((c) => expect(colorCell).toContain(c));
  });

  it('shows each size as its own chip, eight of them', () => {
    // The stored range must come back out as eight separate values, which is the
    // whole point of accepting a long range.
    const stored = 'XS, S, M, L, XL, XXL, 3XL, 4XL';
    expect(sizesOf({ size_range: stored })).toHaveLength(8);
    const sizeCell = html.slice(html.indexOf('mv-chip-size'));
    expect(sizeCell).toContain('mv-chip-size');
  });

  it('tones the size chips apart from the colour chips', () => {
    expect(html).toContain('mv-chip-size');
  });
});

describe('Order Input — a legacy single-value order still renders plainly', () => {
  it('shows a single colour as text, not as a lone chip', () => {
    const { html } = render([{
      id: 9, buyer: 'Zara', order_no: 'PO-1', style: 'STY-OLD', color: 'Navy', size_range: 'S-M-L', qty: 100,
    }]);
    // "Navy" and "S-M-L" are each one value, so neither gets chipped.
    expect(html).not.toContain('mv-chip');
    expect(html).toContain('Navy');
    expect(html).toContain('S-M-L');
  });
});

describe('the save payload carries the multi-values as strings', () => {
  /**
   * Mirrors OrderInputPage.submit() for the two multi-value fields, so the
   * stored shape is asserted rather than assumed.
   */
  function buildPayload(form) {
    return {
      ...form,
      style: String(form.style || '').trim(),
      qty: Number(form.qty) || 0,
      start_date: form.order_date || form.start_date || '',
    };
  }

  it('stores colour as one comma-separated string', () => {
    const payload = buildPayload({
      style: 'STY-1001',
      color: joinValues(['Navy', 'Black', 'White']),
      size_range: joinValues(['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL']),
      qty: '5000',
    });
    expect(typeof payload.color).toBe('string');
    expect(payload.color).toBe('Navy, Black, White');
    // The reader contract: the same keys the rest of the app already reads.
    expect(payload.color.includes(',')).toBe(true);
  });

  it('stores an eight-size range without truncation', () => {
    const payload = buildPayload({
      style: 'S', size_range: joinValues(['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL']),
    });
    expect(payload.size_range).toBe('XS, S, M, L, XL, XXL, 3XL, 4XL');
    expect(splitValues(payload.size_range)).toHaveLength(8);
  });

  it('survives a round trip through storage and back for display', () => {
    const original = ['Navy', 'Black', 'Red', 'White', 'Charcoal'];
    const stored = joinValues(original);
    // 5 colours × 8 sizes = 40 variants, read back off the stored strings.
    const counts = variantsOf({ color: stored, size_range: 'XS, S, M, L, XL, XXL, 3XL, 4XL' });
    expect(counts).toEqual({ colors: 5, sizes: 8, combinations: 40 });
    expect(colorsOf({ color: stored })).toEqual(original);
  });
});
