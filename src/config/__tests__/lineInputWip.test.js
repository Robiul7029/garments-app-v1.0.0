import { describe, it, expect } from 'vitest';
import {
  computeWip,
  summariseWip,
  summariseWipTotals,
  inputVsOutputByOrder,
  inputVsOutputByLine,
  inputQtyOf,
  outputQtyOf,
  comparisonLevel,
  comparisonPercent,
  distinctValues,
} from '../lineInputWip';

/**
 * Line Input & WIP tracking, pinned.
 *
 * The brief's balance is `WIP = Total Line Input − Total Completed Line Output`.
 * These tests hold that formula, the grouping (order + style + line), the date
 * window and the comparison roll-ups, so a change to the arithmetic fails here
 * rather than being noticed as a wrong number on a screen.
 */
describe('computeWip — the brief\'s formula', () => {
  it('is input minus completed output', () => {
    const r = computeWip(1000, 400);
    expect(r.wip).toBe(600);
    expect(r.totalInput).toBe(1000);
    expect(r.totalCompletedOutput).toBe(400);
    expect(r.overReported).toBe(0);
  });

  it('never reports negative work in progress', () => {
    const r = computeWip(500, 900);
    expect(r.wip).toBe(0);
    // The excess is surfaced separately rather than hidden behind the floor.
    expect(r.overReported).toBe(400);
    expect(r.level).toBe('critical');
  });

  it('reports the finished share of what was fed', () => {
    expect(computeWip(1000, 250).completedPercent).toBe(25);
    expect(computeWip(1000, 250).wipPercent).toBe(75);
    // Output above input cannot exceed a 100% completion figure.
    expect(computeWip(1000, 1200).completedPercent).toBe(100);
  });

  it('treats feeding with no output as warning, not critical', () => {
    expect(computeWip(1000, 0).level).toBe('warning');
    expect(computeWip(0, 0).level).toBe('warning');
  });
});

describe('quantity readers tolerate the spellings in use', () => {
  it('reads an input quantity from any of its names', () => {
    expect(inputQtyOf({ inputQty: 10 })).toBe(10);
    expect(inputQtyOf({ quantity: 20 })).toBe(20);
    expect(inputQtyOf({ qty: 30 })).toBe(30);
    expect(inputQtyOf({})).toBe(0);
  });

  it('reads completed output from packing or end-line QC rows', () => {
    expect(outputQtyOf({ packedQty: 100 })).toBe(100);
    expect(outputQtyOf({ passedQty: 80 })).toBe(80);
    expect(outputQtyOf({})).toBe(0);
  });
});

describe('summariseWip — rolling the collections up', () => {
  const inputs = [
    { order_no: 'PO-1', style: 'S1', color: 'Navy', sizeRange: 'S–XL', inputQty: 1200, line_no: 'Line-1', timestamp: '2026-10-16T08:15' },
    { order_no: 'PO-1', style: 'S1', color: 'White', sizeRange: 'M–XXL', inputQty: 800, line_no: 'Line-1', timestamp: '2026-10-16T11:40' },
    { order_no: 'PO-2', style: 'S2', inputQty: 2400, line_no: 'Line-3', timestamp: '2026-10-16T07:50' },
  ];
  const outputs = [
    { order_no: 'PO-1', style: 'S1', line_no: 'Line-1', packedQty: 1100, packDate: '2026-10-16' },
    { order_no: 'PO-1', style: 'S1', line_no: 'Line-1', passedQty: 780, date: '2026-10-16' },
  ];

  it('groups on order + style + line and balances each group', () => {
    const rows = summariseWip(inputs, outputs, {});
    const po1 = rows.find((r) => r.order_no === 'PO-1' && r.line_no === 'Line-1');
    expect(po1.totalInput).toBe(2000);
    expect(po1.totalCompletedOutput).toBe(1880);
    expect(po1.wip).toBe(120);
  });

  it('counts packing and end-line QC together as completed output', () => {
    // 1100 packed + 780 passed = 1880, so neither side may be dropped.
    const rows = summariseWip(inputs, outputs, {});
    expect(rows.find((r) => r.order_no === 'PO-1').totalCompletedOutput).toBe(1880);
  });

  it('applies the date window to inputs and outputs alike', () => {
    const yesterday = summariseWip(inputs, outputs, { date: '2026-10-15' });
    expect(yesterday).toHaveLength(0);
    const today = summariseWip(inputs, outputs, { date: '2026-10-16' });
    expect(today.length).toBeGreaterThan(0);
  });

  it('filters by order and by line', () => {
    expect(summariseWip(inputs, outputs, { order_no: 'PO-2' })).toHaveLength(1);
    expect(summariseWip(inputs, outputs, { line_no: 'Line-3' })).toHaveLength(1);
    expect(summariseWip(inputs, outputs, { line_no: 'Line-9' })).toHaveLength(0);
  });

  it('drops an output row that belongs to no order and no style', () => {
    // Such a row cannot be attributed, and would otherwise become a phantom group.
    const rows = summariseWip([], [{ packedQty: 500, line_no: 'Line-1', packDate: '2026-10-16' }], {});
    expect(rows).toHaveLength(0);
  });

  it('carries the distinct colours and size ranges fed', () => {
    const po1 = summariseWip(inputs, outputs, {}).find((r) => r.order_no === 'PO-1');
    expect(po1.colors).toEqual(['Navy', 'White']);
    expect(po1.sizeRanges).toEqual(['S–XL', 'M–XXL']);
  });
});

describe('summariseWipTotals — the headline figures', () => {
  it('sums the rows and computes the balance from the totals', () => {
    const rows = summariseWip(
      [
        { order_no: 'PO-1', inputQty: 1000, line_no: 'Line-1', timestamp: '2026-10-16' },
        { order_no: 'PO-2', inputQty: 500, line_no: 'Line-2', timestamp: '2026-10-16' },
      ],
      [{ order_no: 'PO-1', packedQty: 300, line_no: 'Line-1', packDate: '2026-10-16' }],
      {},
    );
    const t = summariseWipTotals(rows);
    expect(t.totalInput).toBe(1500);
    expect(t.totalCompletedOutput).toBe(300);
    expect(t.wip).toBe(1200);
    // The comparison view's names for the same two figures.
    expect(t.input).toBe(1500);
    expect(t.output).toBe(300);
  });
});

describe('inputVsOutput — the comparison roll-ups', () => {
  const rows = summariseWip(
    [
      { order_no: 'PO-1', style: 'S1', inputQty: 1200, line_no: 'Line-1', timestamp: '2026-10-16' },
      { order_no: 'PO-1', style: 'S1', inputQty: 800, line_no: 'Line-2', timestamp: '2026-10-16' },
      { order_no: 'PO-2', style: 'S2', inputQty: 3000, line_no: 'Line-4', timestamp: '2026-10-16' },
    ],
    [
      { order_no: 'PO-1', style: 'S1', packedQty: 1000, line_no: 'Line-1', packDate: '2026-10-16' },
      { order_no: 'PO-2', style: 'S2', packedQty: 3050, line_no: 'Line-4', packDate: '2026-10-16' },
    ],
    {},
  );

  it('merges every line feeding an order into one comparison row', () => {
    const byOrder = inputVsOutputByOrder(rows);
    const po1 = byOrder.find((r) => r.order_no === 'PO-1');
    expect(po1.input).toBe(2000);
    expect(po1.output).toBe(1000);
    expect(po1.lines.sort()).toEqual(['Line-1', 'Line-2']);
  });

  it('groups by line when asked the line-wise question', () => {
    const byLine = inputVsOutputByLine(rows);
    expect(byLine.find((r) => r.line_no === 'Line-4').input).toBe(3000);
    expect(byLine.find((r) => r.line_no === 'Line-4').overReported).toBe(50);
  });

  it('grades a comparison row by how much of the feed is finished', () => {
    expect(comparisonLevel({ input: 1000, output: 900 })).toBe('good');
    expect(comparisonLevel({ input: 1000, output: 500 })).toBe('warning');
    expect(comparisonLevel({ input: 1000, output: 100 })).toBe('critical');
    // Output above input is a discrepancy, not a triumph.
    expect(comparisonLevel({ input: 1000, output: 1100 })).toBe('critical');
    expect(comparisonPercent({ input: 1000, output: 250 })).toBe(25);
    expect(comparisonPercent({ input: 1000, output: 1200 })).toBe(100);
    expect(comparisonPercent({ input: 0, output: 10 })).toBe(0);
  });
});

describe('distinctValues — the dropdown options', () => {
  it('returns each distinct value once, naturally sorted', () => {
    const rows = summariseWip(
      [
        { order_no: 'PO-10', line_no: 'Line-10', inputQty: 1, timestamp: '2026-10-16' },
        { order_no: 'PO-2', line_no: 'Line-2', inputQty: 1, timestamp: '2026-10-16' },
        { order_no: 'PO-10', line_no: 'Line-10', inputQty: 1, timestamp: '2026-10-16' },
      ],
      [], {},
    );
    expect(distinctValues(rows, 'order_no')).toEqual(['PO-2', 'PO-10']);
    expect(distinctValues(rows, 'line_no')).toEqual(['Line-2', 'Line-10']);
  });
});
