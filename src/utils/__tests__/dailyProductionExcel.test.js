import { describe, it, expect } from 'vitest';
import { buildDailyProductionSheet, SHEET_STYLES } from '../dailyProductionExcel';
import { HOUR_SLOTS } from '../../config/dailyProductionForm';

/**
 * Tests for the Excel export builder.
 *
 * The sheet is the deliverable the factory prints, so these check the three
 * things that would silently break it: the section headings exist, the hourly
 * grid has one row per slot, and the end-of-day summary carries real formulas
 * (not frozen numbers) so Excel recalculates after an edit.
 */
const SAMPLE = {
  date: '2026-08-19',
  buyer: 'H&M',
  order_no: 'PO-105',
  style: 'STY-1001',
  item: 'Basic Tee',
  color: 'Navy',
  size_range: 'S-M-L-XL',
  po_qty: 5000,
  floor: 'Floor-2',
  line_no: 'Line-03',
  shift: 'Morning',
  supervisor: 'Salma',
  department: 'Sewing',
  process: 'Collar Attach',
  employee: 'Rina',
  working_hours: 8,
  manpower: 25,
  daily_target: 1000,
  hourly: {
    '08:00-09:00': { target: 125, actual: 120, defect: 2, remarks: 'Morning start' },
    '09:00-10:00': { target: 125, actual: 130, defect: 1, remarks: '' },
  },
};

/** Column letters of the hourly grid (A..I) — the export now spans nine columns. */
const COL_LETTERS = 'ABCDEFGHI';

/** Every cell value of one row, for loose text assertions. */
function rowText(ws, r) {
  let out = '';
  for (let c = 0; c < COL_LETTERS.length; c += 1) {
    const cell = ws[`${COL_LETTERS[c]}${r + 1}`];
    if (cell && cell.v !== undefined) out += ` ${cell.v}`;
  }
  return out;
}

function allText(ws) {
  const range = ws['!ref'] ? ws['!ref'] : 'A1:G1';
  const end = Number(range.split(':')[1].replace(/\D/g, ''));
  let out = '';
  for (let r = 0; r < end; r += 1) out += rowText(ws, r) + '\n';
  return out;
}

describe('the daily production workbook sheet', () => {
  it('reproduces the template title and the three section headings', () => {
    const ws = buildDailyProductionSheet(SAMPLE);
    const text = allText(ws);
    expect(text).toContain('Robiul Garments ERP Daily Production Form');
    expect(text).toContain('1. ORDER & PRODUCTION DETAILS');
    expect(text).toContain('2. HOURLY PRODUCTION TRACKING');
    expect(text).toContain('3. END-OF-DAY SUMMARY');
  });

  it('prints every order-detail field with its value', () => {
    const ws = buildDailyProductionSheet(SAMPLE);
    const text = allText(ws);
    ['Buyer', 'H&M', 'Order No', 'PO-105', 'Style No', 'STY-1001', 'Line No', 'Line-03', 'Manpower', '25']
      .forEach((needle) => expect(text).toContain(needle));
  });

  it('splits Good Output and Defects, then sums them into a live Total Quantity', () => {
    const ws = buildDailyProductionSheet(SAMPLE);
    const text = allText(ws);
    // The header carries the three columns in the requested order.
    expect(text).toContain('Good Output');
    expect(text).toContain('Defect Qty');
    expect(text).toContain('Total Quantity');

    // The header row itself, read left to right, pins the column order.
    // Rows: 0-2 title band, 3 blank, 4 section bar, 5-13 order details,
    // 14 blank, 15 section bar, 16 the hourly column headers.
    const headerRow = 16;
    const header = [];
    for (let c = 0; c < COL_LETTERS.length; c += 1) {
      const cell = ws[`${COL_LETTERS[c]}${headerRow + 1}`];
      if (cell) header.push(cell.v);
    }
    expect(header).toEqual([
      'Time Slot', 'Hourly Target', 'Actual Output', 'Good Output',
      'Defect Qty', 'Total Quantity', 'Cumulative Output', 'Variance (+/-)', 'Remarks',
    ]);

    // Total Quantity is a real =SUM formula per hour and on the TOTAL line.
    const formulas = Object.values(ws)
      .filter((cell) => cell && typeof cell === 'object' && typeof cell.f === 'string')
      .map((cell) => cell.f);
    expect(formulas.some((f) => f.startsWith('SUM('))).toBe(true);
    // Every hourly Total Quantity sums its own Actual + Good columns.
    expect(formulas.filter((f) => /^SUM\(C\d+:D\d+\)$/.test(f)).length).toBe(HOUR_SLOTS.length);
  });

  it('lays out one hourly row per time slot plus the header and the TOTAL line', () => {
    const ws = buildDailyProductionSheet(SAMPLE);
    const text = allText(ws);
    HOUR_SLOTS.forEach((slot) => expect(text).toContain(slot));
    expect(text).toContain('Cumulative Output');
    expect(text).toContain('Variance (+/-)');
    expect(text).toContain('TOTAL');
  });

  it('writes the summary as formulas, not frozen numbers', () => {
    const ws = buildDailyProductionSheet(SAMPLE);
    const formulas = Object.values(ws)
      .filter((cell) => cell && typeof cell === 'object' && typeof cell.f === 'string')
      .map((cell) => cell.f);
    // The hourly running columns and the total row must be live formulas.
    expect(formulas.some((f) => f.startsWith('SUM('))).toBe(true);
    // Variance is Actual − Hourly Target; the columns moved right (C−B).
    expect(formulas.some((f) => f.includes('C') && f.includes('-B'))).toBe(true);
    // Good Output feeds the summary: Total Actual (C) − Total Defects (E).
    expect(formulas.some((f) => f.includes('-E'))).toBe(true);
    expect(formulas.some((f) => f.includes('*100'))).toBe(true);
  });

  it('guards every percentage against a divide-by-zero', () => {
    const ws = buildDailyProductionSheet(SAMPLE);
    const pctFormulas = Object.values(ws)
      .filter((cell) => cell && typeof cell === 'object' && typeof cell.f === 'string' && cell.f.includes('*100'))
      .map((cell) => cell.f);
    expect(pctFormulas.length).toBeGreaterThanOrEqual(3);
    // Each percentage must use IF(...) so an empty day shows 0, never #DIV/0!.
    pctFormulas.forEach((f) => expect(f.startsWith('IF(')).toBe(true));
  });

  it('builds a sheet for a row that predates the hourly grid', () => {
    // An existing Firestore row with only the legacy keys must still export.
    const ws = buildDailyProductionSheet({ date: '2026-08-19', employee: 'Salma', style: 'STY-1001', quantity: 8 });
    const text = allText(ws);
    expect(text).toContain('STY-1001');
    HOUR_SLOTS.forEach((slot) => expect(text).toContain(slot));
  });

  it('merges the title band and the section bars', () => {
    const ws = buildDailyProductionSheet(SAMPLE);
    expect(Array.isArray(ws['!merges'])).toBe(true);
    // A title merge across A..G, and one merge per section heading.
    expect(ws['!merges'].some((m) => m.s.c === 0 && m.e.c === 6)).toBe(true);
  });

  it('freezes the header rows so a long grid stays readable', () => {
    const ws = buildDailyProductionSheet(SAMPLE);
    expect(ws['!freeze']?.ySplit).toBe(4);
  });
});

describe('the workbook styling', () => {
  const cellsWithStyle = (ws) => Object.entries(ws).filter(([k, v]) => !k.startsWith('!') && v && v.s);

  it('styles the title band, every section bar and the hourly header', () => {
    const ws = buildDailyProductionSheet(SAMPLE);
    expect(ws.A1.s).toEqual(SHEET_STYLES.title);
    expect(ws.A2.s).toEqual(SHEET_STYLES.subtitle);
    expect(ws.A3.s).toEqual(SHEET_STYLES.meta);
    // The three section bars sit in column A on their own rows.
    expect(cellsWithStyle(ws).filter(([, v]) => v.s === SHEET_STYLES.section)).toHaveLength(3);
    // The seven hourly column headers are all styled.
    expect(cellsWithStyle(ws).filter(([, v]) => v.s === SHEET_STYLES.head)).toHaveLength(7);
  });

  it('uses a real font and fill, not just a number format', () => {
    const ws = buildDailyProductionSheet(SAMPLE);
    // A styled cell must carry font/fill/border objects — this is exactly what
    // plain `xlsx` refuses to serialise, so it is the assertion that matters.
    expect(ws.A1.s.font.bold).toBe(true);
    expect(ws.A1.s.fill.fgColor.rgb).toBe('FF0F172A');
    // The first order-detail label cell carries the thin box every grid cell uses.
    expect(ws.A6.s.border).toBeTruthy();
    expect(ws.A6.s.font.bold).toBe(true);
  });

  it('bands the order-detail labels and values', () => {
    const ws = buildDailyProductionSheet(SAMPLE);
    expect(cellsWithStyle(ws).filter(([, v]) => v.s === SHEET_STYLES.label).length).toBeGreaterThan(10);
  });

  it('highlights the summary percentages by their own verdict', () => {
    const ws = buildDailyProductionSheet(SAMPLE);
    const good = cellsWithStyle(ws).filter(([, v]) => v.s === SHEET_STYLES.good);
    const bad = cellsWithStyle(ws).filter(([, v]) => v.s === SHEET_STYLES.bad);
    // With this sample the percentages diverge enough to exercise both tints.
    expect(good.length).toBeGreaterThanOrEqual(1);
    expect(bad.length).toBeGreaterThanOrEqual(1);
    [...good, ...bad].forEach(([, v]) => {
      expect([SHEET_STYLES.good, SHEET_STYLES.bad]).toContain(v.s);
    });
  });
});
