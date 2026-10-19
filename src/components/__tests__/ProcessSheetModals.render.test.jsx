import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ProcessSheetModals from '../ProcessSheetModals';
import { withRecomputedTotals } from '../../config/orderWorkflow';

/**
 * View / Edit / Delete on an Uploaded Sheet.
 *
 * The row actions themselves are pinned in ProcessUploadPage.render.test.jsx;
 * this covers the dialog each button opens. The layout is rendered on the server
 * here — the interactions (adding a process, saving) are exercised in the browser
 * QA run, because they only exist after a click.
 */
const SHEET = {
  id: 10,
  style: 'STY-1001',
  order_no: 'PO-105',
  fileName: 'breakdown.xlsx',
  uploadedAt: '2026-08-19',
  totalSmv: 4.5,
  smvUnit: 'minutes',
  // The agreed percentage buffer for the sheet. It is stated here because the
  // derived target columns depend on it: without a buffer the same 1.2-minute
  // operation gives 500/day, and with the 5% allowance it gives 525/day. A fixture
  // that leaves it out is not testing the buffer path, it is testing a zero buffer.
  targetBuffer: 5,
  operations: [
    { operation: 'Collar Attach', machine: 'Overlock', section: 'Front', smv: 1.2 },
    { operation: 'Sleeve Join', machine: 'Overlock', section: 'Sleeve', smv: 1.5 },
    { operation: 'Side Seam', machine: 'Flatlock', section: 'Body', smv: 1.8 },
  ],
};

const ORDERS = [
  { id: 1, style: 'STY-1001', order_no: 'PO-105', buyer: 'H&M', qty: 5000 },
  { id: 2, style: 'STY-2002', order_no: 'PO-200', buyer: 'Zara', qty: 1500 },
];

const render = (props) => renderToStaticMarkup(
  <ProcessSheetModals
    sheet={SHEET}
    orders={ORDERS}
    onClose={() => { }}
    onSaveSheet={() => { }}
    onDelete={() => { }}
    {...props}
  />,
);

describe('the View dialog', () => {
  it('lists every operation on the sheet', () => {
    const html = render({ mode: 'view' });
    expect(html).toContain('Processes — STY-1001');
    ['Collar Attach', 'Sleeve Join', 'Side Seam'].forEach((op) => expect(html).toContain(op));
  });

  it('shows the sheet totals, including the seconds figure', () => {
    const html = render({ mode: 'view' });
    expect(html).toContain('Total SMV');
    expect(html).toContain('4.5 min');
    expect(html).toContain('Operations');
  });

  it('offers Add New Process with the fields it needs', () => {
    const html = render({ mode: 'view' });
    expect(html).toContain('Add New Process');
    expect(html).toContain('e.g. Bottom Hem');
    expect(html).toContain('+ Add Process');
    expect(html).toContain('SMV (min)');
  });

  it('shows the derived target columns beside each operation', () => {
    const html = render({ mode: 'view' });
    // The brief's requirement 3: the computed figures are shown in the table,
    // not only in the uploader's preview.
    expect(html).toContain('Base Hr Cap');
    expect(html).toContain('Hr Target');
    expect(html).toContain('Daily Target');
    // And they are real figures for the sheet's operations: 60 / 1.2 = 50 base,
    // × 1.05 = 52/hr, × 10 = 525/day for Collar Attach.
    expect(html).toContain('525');
  });

  it('does not offer Add New Process to a non-admin', () => {
    const html = render({ mode: 'view', isAdmin: false });
    expect(html).not.toContain('+ Add Process');
  });

  it('still shows the operations to a non-admin', () => {
    // View is a read action, so the list must render for everyone.
    const html = render({ mode: 'view', isAdmin: false });
    expect(html).toContain('Collar Attach');
  });
});

describe('the Edit dialog', () => {
  it('offers the style picker and the file name', () => {
    const html = render({ mode: 'edit' });
    expect(html).toContain('Edit sheet — STY-1001');
    expect(html).toContain('Style / Order');
    expect(html).toContain('File name');
  });

  it('pre-fills the current file name', () => {
    const html = render({ mode: 'edit' });
    expect(html).toContain('value="breakdown.xlsx"');
  });

  it('renders independent English line input and output process selectors with saved selections', () => {
    const html = render({
      mode: 'edit',
      sheet: { ...SHEET, lineInputProcess: 'Collar Attach', inputProcess: 'Collar Attach', lineOutputProcess: 'Side Seam', outputProcess: 'Side Seam' },
    });
    expect(html).toContain('Line Input Process');
    expect(html).toContain('aria-label="Line Input Process"');
    expect(html).toContain('Line Output Process');
    expect(html).toContain('aria-label="Line Output Process"');
    expect(html).not.toContain('Select Line Input Process...');
    expect(html).not.toContain('Select Line Output Process...');
    expect(html).toContain('<span class="ss-value">Collar Attach</span>');
    expect(html).toContain('<span class="ss-value">Side Seam</span>');
    expect(html.match(/Line Output Process/g)).toHaveLength(3);
  });
});

describe('the Delete dialog', () => {
  it('asks for confirmation and names the sheet', () => {
    const html = render({ mode: 'delete' });
    expect(html).toContain('Delete this process sheet?');
    expect(html).toContain('Remove the sheet for');
    expect(html).toContain('STY-1001');
  });

  it('says what deleting actually does', () => {
    const html = render({ mode: 'delete' });
    expect(html).toContain('stop being offered on Hourly Production');
    expect(html).toContain('3 operations');
    expect(html).toContain('Delete sheet');
  });

  it('is an alertdialog, so it is announced as a confirmation', () => {
    const html = render({ mode: 'delete' });
    expect(html).toContain('role="alertdialog"');
  });

  it('does not offer the operation list', () => {
    const html = render({ mode: 'delete' });
    expect(html).not.toContain('Add New Process');
  });
});

describe('rendering nothing when no sheet is open', () => {
  it('returns empty for a null sheet', () => {
    expect(render({ sheet: null, mode: '' })).toBe('');
  });
});

describe('recomputing a sheet after an edit', () => {
  it('preserves independent input and output process selections', () => {
    const updated = withRecomputedTotals({
      ...SHEET,
      lineInputProcess: 'Collar Attach',
      inputProcess: 'Collar Attach',
      lineOutputProcess: 'Side Seam',
      outputProcess: 'Side Seam',
    });
    expect(updated.lineInputProcess).toBe('Collar Attach');
    expect(updated.inputProcess).toBe('Collar Attach');
    expect(updated.lineOutputProcess).toBe('Side Seam');
    expect(updated.outputProcess).toBe('Side Seam');
  });
  it('re-derives the total from the operations', () => {
    const updated = withRecomputedTotals({
      ...SHEET,
      operations: [
        { operation: 'Collar Attach', smv: 1.2 },
        { operation: 'Bottom Hem', smv: 1.4 },
      ],
    });
    expect(updated.totalSmv).toBe(2.6);
    expect(updated.totalSmvSeconds).toBe(156);
  });

  it('does not leave a stale total in place', () => {
    // The sheet arrived claiming 4.5; its operations now add up to 5.4.
    const updated = withRecomputedTotals({
      ...SHEET,
      totalSmv: 4.5,
      operations: [
        { operation: 'Collar Attach', smv: 1.2 },
        { operation: 'Sleeve Join', smv: 1.5 },
        { operation: 'Side Seam', smv: 2.7 },
      ],
    });
    expect(updated.totalSmv).toBe(5.4);
    expect(updated.totalSmv).not.toBe(4.5);
  });

  it('sums plain minute values as minutes', () => {
    // `totalSmvOf` sums minutes: rows are normalised by `parseOperations` on the
    // way in, so a hand-typed 72 here really is 72 standard minutes. The
    // seconds guard lives in the SMV engine (smvMinutes), which is what the
    // capacity and dispatch calculations go through.
    const updated = withRecomputedTotals({
      ...SHEET,
      operations: [{ operation: 'Collar Attach', smv: 72 }],
    });
    expect(updated.totalSmv).toBe(72);
    expect(updated.totalSmvSeconds).toBe(4320);
  });

  it('keeps the rest of the sheet intact', () => {
    const updated = withRecomputedTotals(SHEET);
    expect(updated.style).toBe('STY-1001');
    expect(updated.order_no).toBe('PO-105');
    expect(updated.fileName).toBe('breakdown.xlsx');
    expect(updated.id).toBe(10);
  });
});
