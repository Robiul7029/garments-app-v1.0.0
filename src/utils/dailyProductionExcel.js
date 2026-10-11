/**
 * ROBIUL GARMENTS ERP — Daily Production Excel export.
 *
 * Builds the .xlsx that reproduces the paper "Robiul Garments ERP Daily
 * Production Form": a title band, the order-details block, the hourly tracking
 * grid with its cumulative / variance columns, and the end-of-day summary.
 *
 * Why `xlsx-js-style` and not plain `xlsx`
 * ----------------------------------------
 * The community SheetJS build writes number formats but silently DROPS fonts and
 * fills — a cell's `.s` is parsed on read yet never serialised on write, so a
 * styled sheet is impossible with it. `xlsx-js-style` is a drop-in fork of the
 * same API that does serialise them (verified by reading the produced zip:
 * `xl/styles.xml` carries the font/fill/border tables and the sheet stamps
 * `s="N"` on each cell). It is a fraction the size of exceljs and shares the
 * SheetJS interface, so nothing else in this file changed shape.
 *
 * Every derived figure is a real formula (=SUM, =IF), so a manager can change an
 * hourly cell and watch the summary recalculate exactly as the paper form would.
 *
 * One entry downloads one sheet (one form per line/day).
 */
import XLSX from 'xlsx-js-style';
import {
  HOUR_SLOTS,
  ORDER_DETAIL_FIELDS,
  FORM_TITLE,
  FORM_SUBTITLE,
  computeDailySummary,
} from '../config/dailyProductionForm';

const COLS = 7; // A..G

// ---- Palette ---------------------------------------------------------------
// ARGB. Chosen to match the app's dark/grey ERP chrome while staying legible on
// white paper (the sheet prints, so it is light-on-white, not the dark UI).
const C = {
  ink: 'FF0F172A',
  slate: 'FF334155',
  muted: 'FF64748B',
  line: 'FFCBD5E1',
  band: 'FFF1F5F9',
  subBand: 'FFE2E8F0',
  amber: 'FFF59E0B',
  good: 'FF047857',
  goodBg: 'FFD1FAE5',
  bad: 'FFB91C1C',
  badBg: 'FFFEE2E2',
  white: 'FFFFFFFF',
};

const BORDER = {
  top: { style: 'thin', color: { rgb: C.line } },
  bottom: { style: 'thin', color: { rgb: C.line } },
  left: { style: 'thin', color: { rgb: C.line } },
  right: { style: 'thin', color: { rgb: C.line } },
};

const boxed = (extra = {}) => ({ border: BORDER, alignment: { vertical: 'center', wrapText: true }, ...extra });

/** The style applied to each named region of the sheet. */
export const SHEET_STYLES = {
  title: { font: { bold: true, sz: 14, color: { rgb: C.white } }, fill: { fgColor: { rgb: C.ink } }, alignment: { horizontal: 'center', vertical: 'center' } },
  subtitle: { font: { bold: true, sz: 11, color: { rgb: C.white } }, fill: { fgColor: { rgb: C.slate } }, alignment: { horizontal: 'center', vertical: 'center' } },
  meta: { font: { italic: true, sz: 9, color: { rgb: C.muted } }, alignment: { horizontal: 'center' } },
  section: { font: { bold: true, sz: 11, color: { rgb: C.ink } }, fill: { fgColor: { rgb: C.amber } }, alignment: { vertical: 'center' } },
  head: boxed({ font: { bold: true, sz: 10, color: { rgb: C.white } }, fill: { fgColor: { rgb: C.slate } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true } }),
  label: boxed({ font: { bold: true, sz: 10, color: { rgb: C.slate } }, fill: { fgColor: { rgb: C.band } } }),
  value: boxed({ font: { sz: 10 } }),
  total: boxed({ font: { bold: true, sz: 10 }, fill: { fgColor: { rgb: C.subBand } } }),
  good: boxed({ font: { bold: true, sz: 10, color: { rgb: C.good } }, fill: { fgColor: { rgb: C.goodBg } } }),
  bad: boxed({ font: { bold: true, sz: 10, color: { rgb: C.bad } }, fill: { fgColor: { rgb: C.badBg } } }),
};

// ---- Helpers ---------------------------------------------------------------

const ref = (r, c) => XLSX.utils.encode_cell({ r, c });

function blankRow() {
  return Array.from({ length: COLS }, () => '');
}

/** Sets a value and a style on one cell of the sheet. */
function put(ws, r, c, value, style) {
  const address = ref(r, c);
  ws[address] = { t: typeof value === 'number' ? 'n' : 's', v: value === undefined || value === null ? '' : value };
  if (style) ws[address].s = style;
}

// ---- One form → one sheet ---------------------------------------------------

/**
 * Builds the worksheet for one daily-production row. Exported so the test can
 * assert the layout, the formulas and the styling without a filesystem.
 */
export function buildDailyProductionSheet(row) {
  const safeRow = row || {};
  const summary = computeDailySummary(safeRow);

  const rows = [];
  const merges = [];
  const merge = (r, c0, c1) => merges.push({ s: { r, c: c0 }, e: { r, c: c1 } });

  // ---- Title band ----
  rows.push([FORM_TITLE, '', '', '', '', '', '']);
  merge(rows.length - 1, 0, COLS - 1);
  rows.push([`${FORM_SUBTITLE} — Daily Production Report`, '', '', '', '', '', '']);
  merge(rows.length - 1, 0, COLS - 1);
  rows.push([`Generated: ${new Date().toISOString().slice(0, 10)}`, '', '', '', '', '', '']);
  merge(rows.length - 1, 0, COLS - 1);
  rows.push(blankRow());

  // ---- Section 1: Order & Production Details ----
  rows.push(['1. ORDER & PRODUCTION DETAILS', '', '', '', '', '', '']);
  merge(rows.length - 1, 0, COLS - 1);
  const detailStart = rows.length;
  // Two label/value pairs per row across the seven columns:
  //   A(label) B:C(value)   D(label) E:F(value)   G(spare)
  ORDER_DETAIL_FIELDS.forEach((field, index) => {
    const value = safeRow[field.name] === undefined || safeRow[field.name] === null ? '' : safeRow[field.name];
    if (index % 2 === 0) {
      rows.push([field.label, value, '', '', '', '', '']);
      merge(rows.length - 1, 1, 2);
    } else {
      const line = rows[rows.length - 1];
      line[3] = field.label;
      line[4] = value;
      merge(rows.length - 1, 4, 5);
    }
  });
  // An odd field count leaves the last label without a value pair; close it with
  // a Remarks cell rather than a dangling bold label.
  if (ORDER_DETAIL_FIELDS.length % 2 === 1) {
    const line = rows[rows.length - 1];
    line[3] = 'Remarks';
    line[4] = safeRow.remarks || '';
    merge(rows.length - 1, 4, 5);
  }
  const detailEnd = rows.length; // exclusive
  rows.push(blankRow());

  // ---- Section 2: Hourly Production Tracking ----
  rows.push(['2. HOURLY PRODUCTION TRACKING', '', '', '', '', '', '']);
  merge(rows.length - 1, 0, COLS - 1);
  // Column order: Good Output and Defects are split into their own columns, and
  // Total Quantity sits right beside them as a live =SUM(C+D) formula; the
  // cumulative / variance running columns stay to the right.
  rows.push(['Time Slot', 'Hourly Target', 'Actual Output', 'Good Output', 'Defect Qty', 'Total Quantity', 'Cumulative Output', 'Variance (+/-)', 'Remarks']);
  const hourlyHead = rows.length - 1;
  const hourlyStart = rows.length;

  const stored = (safeRow.hourly && typeof safeRow.hourly === 'object' && safeRow.hourly) || {};
  HOUR_SLOTS.forEach((slot, i) => {
    const R = hourlyStart + i + 1; // 1-based Excel row
    const cell = stored[slot] || {};
    // Good Output = actual pieces minus defects (never negative).
    const good = Math.max(0, (Number(cell.actual) || 0) - (Number(cell.defect) || 0));
    // Total Quantity, Cumulative and Variance are formulas so the sheet behaves
    // like the form: edit an hourly cell and every derived column recalculates.
    const total = `SUM(C${R}:D${R})`;
    const cumulative = i === 0 ? `G${R}` : `G${R - 1}+G${R}`;
    const variance = `C${R}-B${R}`;
    rows.push([
      slot,
      Number(cell.target) || 0,
      Number(cell.actual) || 0,
      good,
      Number(cell.defect) || 0,
      { f: total },
      { f: cumulative },
      { f: variance },
      cell.remarks || '',
    ]);
  });

  const firstR = hourlyStart + 1;
  const lastR = hourlyStart + HOUR_SLOTS.length;
  rows.push([
    'TOTAL',
    { f: `SUM(B${firstR}:B${lastR})` },
    { f: `SUM(C${firstR}:C${lastR})` },
    { f: `SUM(D${firstR}:D${lastR})` },
    { f: `SUM(E${firstR}:E${lastR})` },
    { f: `SUM(F${firstR}:F${lastR})` },
    { f: `G${lastR + 1}` },
    { f: `C${lastR + 1}-B${lastR + 1}` },
    '',
  ]);
  const totalsR = lastR + 1;
  rows.push(blankRow());

  // ---- Section 3: End-of-Day Summary ----
  rows.push(['3. END-OF-DAY SUMMARY', '', '', '', '', '', '']);
  merge(rows.length - 1, 0, COLS - 1);
  const summaryStart = rows.length;
  const dailyTarget = Number(safeRow.daily_target) || 0;
  const rGood = summaryStart + 2; // 1-based row of the Good Output line

  rows.push(['Daily Target vs Actual', '', '', `Target ${dailyTarget} / Actual ${summary.goodOutput}`, '', '', '']);
  merge(rows.length - 1, 3, 4);
  // Good Output = total Actual (C) minus total Defects (E) — the same figures the
  // hourly Good Output column rolls up to, so the two can never disagree.
  rows.push(['Good Output', '', '', { f: `C${totalsR}-E${totalsR}` }, '', '', '']);
  merge(rows.length - 1, 3, 4);
  rows.push(['Efficiency %', '', '', { f: `IF(B${totalsR}=0,0,D${rGood}/B${totalsR}*100)` }, '', '', '']);
  merge(rows.length - 1, 3, 4);
  rows.push(['Target Achievement %', '', '', { f: `IF(${dailyTarget}=0,0,D${rGood}/${dailyTarget}*100)` }, '', '', '']);
  merge(rows.length - 1, 3, 4);
  rows.push(['Defect Rate %', '', '', { f: `IF(C${totalsR}=0,0,E${totalsR}/C${totalsR}*100)` }, '', '', '']);
  merge(rows.length - 1, 3, 4);
  rows.push(['Output to Finishing', '', '', { f: `D${rGood}` }, '', '', '']);
  merge(rows.length - 1, 3, 4);
  const summaryEnd = rows.length; // exclusive

  // ---- Sheet: write the grid, then layer the styles on top ----
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!merges'] = merges;
  ws['!cols'] = [
    { wch: 26 }, { wch: 16 }, { wch: 15 }, { wch: 15 }, { wch: 12 },
    { wch: 16 }, { wch: 18 }, { wch: 15 }, { wch: 34 },
  ];
  ws['!rows'] = rows.map((_, i) => ({ hpt: i === 0 ? 26 : 18 }));

  // aoa_to_sheet flattens { f } objects into formulas, and drops undefined
  // cells. Re-stamp the formulas so the ones aoa_to_sheet could not infer (the
  // running columns) are present with a cached 0 so Excel never shows blank.
  restampFormulas(ws, rows);

  // Title band.
  ws[ref(0, 0)].s = SHEET_STYLES.title;
  ws[ref(1, 0)].s = SHEET_STYLES.subtitle;
  ws[ref(2, 0)].s = SHEET_STYLES.meta;

  // Section bars — find them from the grid so a field added later still styles.
  const findRow = (label) => rows.findIndex((line) => line[0] === label);
  ['1. ORDER & PRODUCTION DETAILS', '2. HOURLY PRODUCTION TRACKING', '3. END-OF-DAY SUMMARY']
    .forEach((label) => { ws[ref(findRow(label), 0)].s = SHEET_STYLES.section; });

  // Order-detail key/value cells.
  for (let r = detailStart; r < detailEnd; r += 1) {
    [0, 3].forEach((c) => { if (ws[ref(r, c)]) ws[ref(r, c)].s = SHEET_STYLES.label; });
    [1, 4].forEach((c) => { if (ws[ref(r, c)]) ws[ref(r, c)].s = SHEET_STYLES.value; });
  }

  // Hourly grid.
  for (let c = 0; c < COLS; c += 1) {
    if (ws[ref(hourlyHead, c)]) ws[ref(hourlyHead, c)].s = SHEET_STYLES.head;
  }
  for (let r = hourlyStart; r <= totalsR; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const cell = ws[ref(r, c)];
      if (!cell) continue;
      cell.s = r === totalsR ? SHEET_STYLES.total : SHEET_STYLES.value;
    }
  }

  // Summary rows: label bold on the left, the value boxed; the three
  // percentages coloured by their own verdict.
  for (let r = summaryStart; r < summaryEnd; r += 1) {
    if (ws[ref(r, 0)]) ws[ref(r, 0)].s = SHEET_STYLES.label;
    if (ws[ref(r, 3)]) ws[ref(r, 3)].s = SHEET_STYLES.total;
  }
  ws[ref(summaryStart + 2, 3)].s = summary.efficiency >= 75 ? SHEET_STYLES.good : SHEET_STYLES.bad;
  ws[ref(summaryStart + 3, 3)].s = summary.targetAchievement >= 90 ? SHEET_STYLES.good : SHEET_STYLES.bad;
  ws[ref(summaryStart + 4, 3)].s = summary.defectRate <= 5 ? SHEET_STYLES.good : SHEET_STYLES.bad;
  ws[ref(summaryStart + 5, 3)].s = SHEET_STYLES.total;

  // Freeze the header rows so a long hourly grid stays readable on screen.
  ws['!freeze'] = { xSplit: 0, ySplit: 4, topLeftCell: 'A5', activePane: 'bottomLeft', state: 'frozen' };

  return ws;
}

/**
 * Re-stamps the `{ f }` cells with a real formula and a cached value.
 *
 * `aoa_to_sheet` only recognises a formula when it is the whole cell object AND
 * the sheet keeps zero-indexed cells; the running columns reference rows below
 * themselves, which it cannot infer. Writing them explicitly guarantees Excel
 * opens the file without a repair prompt and shows 0 (not blank) until it
 * recalculates.
 */
function restampFormulas(ws, rows) {
  rows.forEach((line, r) => {
    line.forEach((value, c) => {
      if (!value || typeof value !== 'object' || typeof value.f !== 'string') return;
      const address = ref(r, c);
      ws[address] = { t: 'n', v: 0, f: value.f };
    });
  });
}

function sheetNameFor(row, index) {
  const parts = [row && row.date, (row && (row.line_no || row.employee || row.style)) || `Entry ${index + 1}`];
  return parts.filter(Boolean).join(' ').replace(/[\\/?*[\]:]/g, '-');
}

/**
 * Downloads the workbook. Several rows produce one sheet each, so a multi-line
 * day can be printed as a stack of identical forms.
 */
export function downloadDailyProductionWorkbook(rows, filename = 'daily-production-report.xlsx') {
  const list = Array.isArray(rows) ? rows : [rows];
  if (list.length === 0) {
    if (typeof window !== 'undefined') window.alert('No data to download yet.');
    return;
  }
  const workbook = XLSX.utils.book_new();
  list.forEach((row, index) => {
    const used = workbook.SheetNames;
    const base = sheetNameFor(row, index).slice(0, 31) || `Entry ${index + 1}`;
    let name = base;
    let n = 2;
    while (used.includes(name)) {
      name = `${base.slice(0, 28)}_${n}`;
      n += 1;
    }
    XLSX.utils.book_append_sheet(workbook, buildDailyProductionSheet(row), name);
  });
  XLSX.writeFile(workbook, filename);
}
