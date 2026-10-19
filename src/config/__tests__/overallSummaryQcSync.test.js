import { describe, it, expect } from 'vitest';
import { summariseDay, summariseQcDay, dayHeadline } from '../productionAggregation';
import { buildQcRecord, computeQcTotals, QC_COLLECTION } from '../hourlyEntryMode';

/**
 * The Overall Summary's QC figures, and the fact that they do NOT leak into output.
 *
 * The rule these pin down:
 *
 *   - a QC Product Check is an INSPECTION, not production. It is summarised on its
 *     own and never added to the day's completed pieces, because doing so would
 *     inflate every production figure the factory reads.
 *   - the summary reads the QC collection as well as the hourly rows, so a check
 *     saved from the SAME unified entry form reaches the Overall Summary.
 *   - the summary is a pure function of its inputs, so a save that changes the rows
 *     changes the summary on the next render with no reload — that is what makes
 *     the real-time sync a consequence of the data flow rather than a manual push.
 */

const HOURLY = (overrides = {}) => ({
  id: 1,
  date: '2026-10-17',
  employee: 'Md Robiul Islam',
  order_no: 'PO-105',
  style: 'STY-1001',
  process: 'Collar Attach',
  hours: { 8: 50, 9: 55 },
  workingHours: 2,
  dailyTarget: 400,
  ...overrides,
});

const QC = (overrides = {}) => ({
  id: 'q1',
  date: '2026-10-17',
  line: 'Line-03',
  process: 'Collar Attach',
  checked: 337,
  defect_qty: 12,
  ok_pcs: 300,
  alter_pcs: 25,
  defect_pcs: 12,
  total_checked: 337,
  ...overrides,
});

describe('summarising the QC side of a day', () => {
  it('totals the checks, the pieces checked and the OK / Alter / Defect split', () => {
    const qc = summariseQcDay([QC(), QC({ id: 'q2', ok_pcs: 100, alter_pcs: 0, defect_pcs: 5, total_checked: 105 })], '2026-10-17');
    expect(qc.checks).toBe(2);
    expect(qc.checked).toBe(442);
    expect(qc.ok).toBe(400);
    expect(qc.alter).toBe(25);
    expect(qc.defect).toBe(17);
  });

  it('computes the pass rate from the OK share of everything checked', () => {
    const qc = summariseQcDay([QC()], '2026-10-17');
    // 300 of 337.
    expect(qc.passRate).toBeCloseTo(89, 0);
    expect(qc.defectRate).toBeCloseTo(3.6, 1);
  });

  it('reads a row written by the Quality Control screen, which has no breakdown', () => {
    // The older shape: `checked` and `defect_qty` only.
    const qc = summariseQcDay([{ date: '2026-10-17', checked: 200, defect_qty: 20 }], '2026-10-17');
    expect(qc.checked).toBe(200);
    expect(qc.defect).toBe(20);
  });

  it('only counts the day asked for', () => {
    const qc = summariseQcDay([QC(), QC({ id: 'q2', date: '2026-10-16' })], '2026-10-17');
    expect(qc.checks).toBe(1);
  });

  it('is zero-safe when nothing was checked', () => {
    const qc = summariseQcDay([], '2026-10-17');
    expect(qc.checks).toBe(0);
    expect(qc.checked).toBe(0);
    expect(qc.passRate).toBe(0);
    expect(qc.defectRate).toBe(0);
  });
});

describe('the overall summary with QC', () => {
  it('exposes the QC figures alongside the production ones', () => {
    const summary = summariseDay([HOURLY()], '2026-10-17', [QC()]);
    expect(summary.qc.checks).toBe(1);
    expect(summary.qc.checked).toBe(337);
  });

  it('does NOT add the QC pieces to the production output', () => {
    // This is the whole point of keeping QC separate: an inspection counts pieces
    // CHECKED, so adding it to output would inflate the day's figure.
    const withoutQc = summariseDay([HOURLY()], '2026-10-17', []);
    const withQc = summariseDay([HOURLY()], '2026-10-17', [QC()]);
    expect(withQc.completedPieces).toBe(withoutQc.completedPieces);
    expect(withQc.completedPieces).toBe(105);
  });

  it('does not let a QC check create a phantom process or employee', () => {
    const summary = summariseDay([HOURLY()], '2026-10-17', [QC({ process: 'Final Check', employee: 'Someone Else' })]);
    expect(summary.byProcess.map((p) => p.process)).toEqual(['Collar Attach']);
    expect(summary.byEmployee.map((e) => e.employee)).toEqual(['Md Robiul Islam']);
  });

  it('still works when no QC collection is passed at all', () => {
    // A caller that predates the QC parameter must not break.
    const summary = summariseDay([HOURLY()], '2026-10-17');
    expect(summary.qc.checks).toBe(0);
    expect(summary.completedPieces).toBe(105);
  });

  it('re-derives from new rows, which is what makes the sync real-time', () => {
    // The summary is a pure function of its inputs. A save that changes the rows
    // changes the summary on the next render — no reload, no manual push.
    const before = summariseDay([HOURLY()], '2026-10-17', []);
    const after = summariseDay(
      [HOURLY(), HOURLY({ id: 2, hours: { 10: 40 } })],
      '2026-10-17',
      [QC()],
    );
    expect(before.completedPieces).toBe(105);
    expect(before.qc.checks).toBe(0);
    // The new hourly row and the new QC check are both reflected.
    expect(after.completedPieces).toBe(145);
    expect(after.qc.checks).toBe(1);
  });

  it('keeps the headline bar and the summary tab in step', () => {
    // dayHeadline delegates to summariseDay, so the two cannot disagree.
    const headline = dayHeadline([HOURLY()], '2026-10-17');
    expect(headline.pieces).toBe(105);
    expect(headline.employees).toBe(1);
  });
});

describe('the QC record the unified form writes', () => {
  it('writes to the collection the Quality Control screen reads', () => {
    expect(QC_COLLECTION).toBe('quality-control');
  });

  it('carries the auto-calculated Total Checked', () => {
    const record = buildQcRecord({
      date: '2026-10-17', line_no: 'Line-03', process: 'Collar Attach',
      ok_pcs: 300, alter_pcs: 25, defect_pcs: 12,
    });
    // 300 + 25 + 12
    expect(record.checked).toBe(337);
    expect(record.total_checked).toBe(337);
    expect(record.defect_qty).toBe(12);
  });

  it('is marked as a QC entry, so an output aggregator can exclude it', () => {
    expect(buildQcRecord({ ok_pcs: 1 }).entry_type).toBe('qc');
  });

  it('is summarised correctly when round-tripped through the aggregator', () => {
    // The exact path a save takes: the form builds the record, the summary reads
    // it back. If these two ever disagree the card would show the wrong figure.
    const record = buildQcRecord({
      date: '2026-10-17', line_no: 'Line-03', process: 'Collar Attach',
      ok_pcs: 300, alter_pcs: 25, defect_pcs: 12,
    });
    const qc = summariseQcDay([record], '2026-10-17');
    expect(qc.checked).toBe(record.total_checked);
    expect(qc.defect).toBe(record.defect_pcs);
  });

  it('agrees with the pure total calculator', () => {
    const totals = computeQcTotals({ okPcs: 300, alterPcs: 25, defectPcs: 12 });
    expect(totals.totalChecked).toBe(337);
    expect(totals.passRate).toBeCloseTo(89, 0);
  });
});
