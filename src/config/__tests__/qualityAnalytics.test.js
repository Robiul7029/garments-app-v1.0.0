import { describe, it, expect } from 'vitest';
import {
  qcBreakdown,
  qcRowStatus,
  summariseQuality,
  buildQualitySummaryRows,
  filterQualityRows,
  distinctQualityValues,
  qcLine,
  qcOrder,
} from '../qualityAnalytics';
import { buildQcRecord } from '../hourlyEntryMode';

/**
 * The Quality Control analytics.
 *
 * These pin the arithmetic the Quality Analytics & Summary Dashboard is built
 * from: the per-row reconciliation, the KPI headline, the pass/defect bands and
 * the filters. The screen only renders what this module returns, so if these are
 * right the cards, the table and the export agree by construction.
 */

/** A stored QC row, in the shape the Unified Entry Modal writes. */
function qcRow(overrides = {}) {
  return buildQcRecord({
    date: '2026-10-12',
    order_no: 'PO-105',
    style: 'STY-1001',
    line_no: 'Line-03',
    process: 'Collar Attach',
    ok_pcs: 300,
    alter_pcs: 25,
    defect_pcs: 12,
    defect_type: 'Skip Stitch',
    ...overrides,
  });
}

describe('the QC breakdown of one row', () => {
  it('reads the OK / Alter / Defect split and the total from the stored row', () => {
    const b = qcBreakdown(qcRow());
    expect(b.okPcs).toBe(300);
    expect(b.alterPcs).toBe(25);
    expect(b.defectPcs).toBe(12);
    expect(b.totalChecked).toBe(337);
  });

  it('derives the pass, alter and defect rates', () => {
    const b = qcBreakdown(qcRow());
    expect(b.passRate).toBe(89);
    expect(b.alterRate).toBe(7.4);
    expect(b.defectRate).toBe(3.6);
  });

  it('reconciles a hand-entered row that carries only checked and defect_qty', () => {
    // The legacy QC screen's shape: no split, only the flat fields.
    const b = qcBreakdown({ checked: 200, defect_qty: 20 });
    expect(b.totalChecked).toBe(200);
    expect(b.defectPcs).toBe(20);
    expect(b.okPcs).toBe(180);
    expect(b.alterPcs).toBe(0);
    expect(b.passRate).toBe(90);
    expect(b.defectRate).toBe(10);
  });

  it('never lets the defect figure exceed what was inspected', () => {
    const b = qcBreakdown({ checked: 50, defect_qty: 999 });
    expect(b.defectPcs).toBe(50);
    expect(b.defectRate).toBe(100);
  });

  it('is zero-safe on an empty row', () => {
    const b = qcBreakdown({});
    expect(b.totalChecked).toBe(0);
    expect(b.passRate).toBe(0);
    expect(b.defectRate).toBe(0);
  });
});

describe('the row status band', () => {
  it('is Pass (green) at 95% and above', () => {
    expect(qcRowStatus(95)).toMatchObject({ key: 'pass', tone: 'success' });
    expect(qcRowStatus(100).key).toBe('pass');
  });

  it('is Watch (yellow) between 90% and 94%', () => {
    expect(qcRowStatus(90)).toMatchObject({ key: 'watch', tone: 'warning' });
    expect(qcRowStatus(94.9).key).toBe('watch');
  });

  it('is At Risk (red) below 90%', () => {
    expect(qcRowStatus(89.9)).toMatchObject({ key: 'risk', tone: 'danger' });
    expect(qcRowStatus(0).key).toBe('risk');
  });
});

describe('the quality KPI summary', () => {
  it('totals the checked, OK, alter and defect figures', () => {
    const summary = summariseQuality([
      qcRow({ ok_pcs: 300, alter_pcs: 25, defect_pcs: 12 }),
      qcRow({ ok_pcs: 200, alter_pcs: 0, defect_pcs: 3 }),
    ]);
    expect(summary.totalChecked).toBe(540);
    expect(summary.okPcs).toBe(500);
    expect(summary.alterPcs).toBe(25);
    expect(summary.defectPcs).toBe(15);
    expect(summary.entries).toBe(2);
  });

  it('computes the FTR pass rate and the defect rate over everything checked', () => {
    const summary = summariseQuality([qcRow({ ok_pcs: 300, alter_pcs: 25, defect_pcs: 12 })]);
    expect(summary.passRate).toBe(89);
    expect(summary.defectRate).toBe(3.6);
    expect(summary.pendingAlter).toBe(25);
  });

  it('ranks the defect types by defect qty and keeps the top three', () => {
    const summary = summariseQuality([
      qcRow({ defect_pcs: 5, defect_type: 'Skip Stitch' }),
      qcRow({ defect_pcs: 9, defect_type: 'Open Seam' }),
      qcRow({ defect_pcs: 7, defect_type: 'Broken Stitch' }),
      qcRow({ defect_pcs: 1, defect_type: 'Oil Spot' }),
    ]);
    expect(summary.defectTypes.map((d) => d.type)).toEqual(['Open Seam', 'Broken Stitch', 'Skip Stitch', 'Oil Spot']);
    expect(summary.topDefectTypes).toHaveLength(3);
    expect(summary.topDefectTypes[0]).toMatchObject({ type: 'Open Seam', defectPcs: 9 });
  });

  it('does not treat a defect-free check as a defect type', () => {
    const summary = summariseQuality([qcRow({ defect_pcs: 0, defect_type: 'Skip Stitch' })]);
    expect(summary.defectPcs).toBe(0);
    expect(summary.defectTypes).toHaveLength(0);
  });

  it('labels a defect with no type rather than dropping the quantity', () => {
    const summary = summariseQuality([qcRow({ defect_pcs: 4, defect_type: '' })]);
    expect(summary.defectTypes[0].type).toBe('Unspecified');
    expect(summary.defectTypes[0].defectPcs).toBe(4);
  });

  it('is zero-safe on an empty set', () => {
    const summary = summariseQuality([]);
    expect(summary.totalChecked).toBe(0);
    expect(summary.passRate).toBe(0);
    expect(summary.topDefectTypes).toEqual([]);
  });
});

describe('the summary table rows', () => {
  it('maps a stored row into the brief\'s columns', () => {
    const [row] = buildQualitySummaryRows([qcRow()]);
    expect(row).toMatchObject({
      date: '2026-10-12',
      line: 'Line-03',
      orderNo: 'PO-105',
      style: 'STY-1001',
      process: 'Collar Attach',
      checkedQty: 337,
      okPcs: 300,
      alterPcs: 25,
      defectQty: 12,
      defectRate: 3.6,
      statusLabel: 'At Risk',
    });
  });

  it('sorts newest first', () => {
    const rows = buildQualitySummaryRows([
      qcRow({ date: '2026-10-10' }),
      qcRow({ date: '2026-10-14' }),
      qcRow({ date: '2026-10-12' }),
    ]);
    expect(rows.map((r) => r.date)).toEqual(['2026-10-14', '2026-10-12', '2026-10-10']);
  });
});

describe('the filters', () => {
  const rows = [
    qcRow({ date: '2026-10-12', line_no: 'Line-03', order_no: 'PO-105' }),
    qcRow({ date: '2026-10-13', line_no: 'Line-04', order_no: 'PO-106' }),
    qcRow({ date: '2026-10-14', line_no: 'Line-03', order_no: 'PO-106' }),
  ];

  it('filters to a single date', () => {
    expect(filterQualityRows(rows, { date: '2026-10-13' })).toHaveLength(1);
  });

  it('filters to an inclusive date range', () => {
    expect(filterQualityRows(rows, { from: '2026-10-12', to: '2026-10-13' })).toHaveLength(2);
  });

  it('filters by line and order together', () => {
    const filtered = filterQualityRows(rows, { line: 'Line-03', order: 'PO-106' });
    expect(filtered).toHaveLength(1);
    expect(qcLine(filtered[0])).toBe('Line-03');
    expect(qcOrder(filtered[0])).toBe('PO-106');
  });

  it('ignores an empty filter', () => {
    expect(filterQualityRows(rows, {})).toHaveLength(3);
  });

  it('excludes a dateless row when a date filter is set', () => {
    const withBlank = [...rows, qcRow({ date: '' })];
    expect(filterQualityRows(withBlank, { from: '2026-10-01' })).toHaveLength(3);
  });
});

describe('the dropdown options', () => {
  it('lists each distinct value once, sorted', () => {
    const rows = [qcRow({ line_no: 'Line-03' }), qcRow({ line_no: 'Line-04' }), qcRow({ line_no: 'Line-03' })];
    expect(distinctQualityValues(rows, 'line')).toEqual(['Line-03', 'Line-04']);
  });
});
