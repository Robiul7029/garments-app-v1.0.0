/**
 * ROBIUL GARMENTS ERP — Monthly Production Matrix export.
 *
 * Builds the .xlsx for the Monthly All-Employee sheet: one row per employee, the
 * 1–31 day grid, and the month-end summary columns the brief asks for (present
 * days, active hours, monthly target vs achieved, defects, efficiency).
 *
 * Why this is its own file rather than a branch of the daily export
 * ---------------------------------------------------------------
 * The daily export reproduces ONE paper form per line/day (title band, order block,
 * hourly grid, end-of-day summary). The monthly sheet is a different document — a
 * wide matrix with a per-employee summary — so sharing the builder would mean
 * every branch in one function deciding which of two layouts to emit. Two small
 * builders are easier to read and cannot regress each other.
 *
 * Like the daily export this uses `xlsx-js-style`, because the community SheetJS
 * build silently drops fonts and fills on write — a cell's `.s` is parsed but never
 * serialised, so a styled sheet is impossible with it.
 */
import XLSX from 'xlsx-js-style';

// ---- Palette ---------------------------------------------------------------
// ARGB, light-on-white because the sheet is printed.
const C = {
  ink: 'FF0F172A',
  slate: 'FF334155',
  muted: 'FF64748B',
  line: 'FFCBD5E1',
  band: 'FFF1F5F9',
  subBand: 'FFE2E8F0',
  head: 'FF1E293B',
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

const boxed = (extra = {}) => ({
  border: BORDER,
  alignment: { vertical: 'center', wrapText: true },
  ...extra,
});

/** A numeric cell, right-aligned so a column of figures lines up. */
const num = (extra = {}) => boxed({ alignment: { horizontal: 'right', vertical: 'center' }, ...extra });

/** The label for a shift/date column, kept identical to the on-screen grid. */
function hourLabel(slot) {
  return /^\d{1,2}$/.test(String(slot)) ? `${slot}:00` : String(slot);
}

/**
 * One worksheet for a month.
 *
 * `monthRows` is the output of `aggregateMonthly`; `dayNumbers` are the day columns
 * to draw (1–31, or the active days only); `totals` is `summariseMonth`'s result.
 *
 * Every figure is written as a VALUE, not a live formula, because the source rows
 * are not on the sheet — a formula referencing cells that do not exist would show
 * `#REF!` the moment the manager opened the file. The daily export can use
 * formulas because its inputs (the hourly grid) are on the same sheet.
 */
export function buildMonthlyMatrixSheet({
  monthRows = [],
  dayNumbers = [],
  totals = {},
  monthKey = '',
  from = '',
  to = '',
}) {
  const header = [
    'Employee',
    ...dayNumbers.map((d) => String(d)),
    'Total Present Days',
    'Total Active Hours',
    'Monthly Target',
    'Achieved Output',
    'Total Defects',
    'Efficiency %',
    'Variance',
  ];

  const rows = [];
  rows.push([{ v: `Monthly Production Matrix — ${monthKey}`, s: boxed({ font: { bold: true, sz: 14, color: { rgb: C.ink } } }) }]);
  const rangeNote = from || to
    ? `Date range: ${from || 'start'} → ${to || 'end'}`
    : 'Date range: whole month';
  rows.push([{ v: rangeNote, s: boxed({ font: { italic: true, sz: 10, color: { rgb: C.muted } } }) }]);
  rows.push([]);

  // ---- Header row ----
  rows.push(header.map((label, i) => ({
    v: label,
    s: boxed({
      font: { bold: true, color: { rgb: C.white } },
      fill: { fgColor: { rgb: C.head } },
      alignment: { horizontal: i === 0 ? 'left' : 'center', vertical: 'center', wrapText: true },
    }),
  })));

  // ---- One row per employee ----
  monthRows.forEach((r, index) => {
    const band = index % 2 === 0 ? C.white : C.band;
    const tone = r.efficiency >= 85 ? C.good : r.efficiency >= 70 ? C.slate : C.bad;
    rows.push([
      { v: r.employee, s: boxed({ font: { bold: true, color: { rgb: C.ink } }, fill: { fgColor: { rgb: band } } }) },
      ...dayNumbers.map((d) => {
        const value = r.days[d - 1] || 0;
        return {
          v: value || '',
          s: num({
            fill: { fgColor: { rgb: value > 0 ? C.goodBg : band } },
            font: { color: { rgb: value > 0 ? C.good : C.muted } },
          }),
        };
      }),
      { v: r.activeDays, s: num({ fill: { fgColor: { rgb: band } } }) },
      { v: r.workingHours, s: num({ fill: { fgColor: { rgb: band } } }) },
      { v: r.totalTarget, s: num({ fill: { fgColor: { rgb: band } } }) },
      { v: r.totalOutput, s: num({ font: { bold: true, color: { rgb: C.ink } }, fill: { fgColor: { rgb: band } } }) },
      { v: r.totalDefects, s: num({ fill: { fgColor: { rgb: band } }, font: { color: { rgb: r.totalDefects > 0 ? C.bad : C.muted } } }) },
      { v: `${r.efficiency}%`, s: num({ font: { bold: true, color: { rgb: tone } }, fill: { fgColor: { rgb: band } } }) },
      {
        v: r.varianceLabel,
        s: num({
          font: { bold: true, color: { rgb: r.varianceTone === 'good' ? C.good : C.bad } },
          fill: { fgColor: { rgb: r.varianceTone === 'good' ? C.goodBg : C.badBg } },
        }),
      },
    ]);
  });

  // ---- Month total ----
  if (monthRows.length > 0) {
    rows.push([
      { v: 'Month total', s: boxed({ font: { bold: true, color: { rgb: C.white } }, fill: { fgColor: { rgb: C.head } } }) },
      ...dayNumbers.map((d) => ({
        v: monthRows.reduce((s, r) => s + (r.days[d - 1] || 0), 0),
        s: num({ font: { bold: true, color: { rgb: C.white } }, fill: { fgColor: { rgb: C.head } } }),
      })),
      { v: totals.presentDays ?? '', s: num({ font: { bold: true, color: { rgb: C.white } }, fill: { fgColor: { rgb: C.head } } }) },
      { v: totals.hours ?? '', s: num({ font: { bold: true, color: { rgb: C.white } }, fill: { fgColor: { rgb: C.head } } }) },
      { v: totals.target ?? '', s: num({ font: { bold: true, color: { rgb: C.white } }, fill: { fgColor: { rgb: C.head } } }) },
      { v: totals.output ?? '', s: num({ font: { bold: true, color: { rgb: C.white } }, fill: { fgColor: { rgb: C.head } } }) },
      { v: totals.defects ?? '', s: num({ font: { bold: true, color: { rgb: C.white } }, fill: { fgColor: { rgb: C.head } } }) },
      { v: `${totals.efficiency ?? 0}%`, s: num({ font: { bold: true, color: { rgb: C.white } }, fill: { fgColor: { rgb: C.head } } }) },
      {
        v: `${(totals.variance ?? 0) >= 0 ? '+' : ''}${totals.variance ?? 0}`,
        s: num({ font: { bold: true, color: { rgb: C.white } }, fill: { fgColor: { rgb: C.head } } }),
      },
    ]);
  }

  const sheet = XLSX.utils.aoa_to_sheet(rows);

  // Column widths: a name column, narrow day columns, wider summary columns.
  sheet['!cols'] = [
    { wch: 24 },
    ...dayNumbers.map(() => ({ wch: 4.5 })),
    { wch: 11 }, { wch: 11 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 11 }, { wch: 16 },
  ];
  // A frozen header (and name column) so a 31-column grid stays readable when it
  // is scrolled sideways — the same courtesy the on-screen table pays.
  sheet['!freeze'] = { xSplit: 1, ySplit: 4 };
  // Merge the title and the range note across the full width.
  const width = header.length;
  sheet['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: width - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: width - 1 } },
  ];

  return sheet;
}

/**
 * Downloads the monthly matrix as an .xlsx workbook.
 *
 * @param {object} payload  { monthRows, dayNumbers, totals, monthKey, from, to }
 * @param {string} filename
 */
export function downloadMonthlyMatrixWorkbook(payload, filename = 'monthly-production-matrix.xlsx') {
  const { monthRows = [], monthKey = '' } = payload || {};
  if (!Array.isArray(monthRows) || monthRows.length === 0) {
    if (typeof window !== 'undefined') window.alert('No data to download yet.');
    return;
  }
  const workbook = XLSX.utils.book_new();
  const sheet = buildMonthlyMatrixSheet(payload);
  // A sheet name may not exceed 31 characters or contain the characters Excel
  // reserves, so the month is sanitised the same way the daily export does it.
  const name = `Matrix ${monthKey}`.replace(/[\\/?*[\]:]/g, '-').slice(0, 31);
  XLSX.utils.book_append_sheet(workbook, sheet, name || 'Monthly Matrix');
  XLSX.writeFile(workbook, filename);
}

/**
 * Downloads the monthly matrix as a print-ready PDF.
 *
 * There is no PDF writer in this app's dependencies, and adding one for a single
 * screen would be a large dependency to justify. Instead this opens the browser's
 * own print dialog on a purpose-built HTML document — which is what "Export to
 * PDF" means to the person clicking it: a printable sheet they can save as PDF.
 *
 * The document is built as a string and written into a new window, so nothing on
 * the app's own page is disturbed. A popup blocker is handled by saying so rather
 * than failing silently.
 */
export function downloadMonthlyMatrixPDF(payload, { title = 'Monthly Production Matrix' } = {}) {
  const { monthRows = [], dayNumbers = [], totals = {}, monthKey = '', from = '', to = '' } = payload || {};
  if (typeof window === 'undefined') return;
  if (!Array.isArray(monthRows) || monthRows.length === 0) {
    window.alert('No data to download yet.');
    return;
  }

  const esc = (value) => String(value ?? '').replace(/[&<>"]/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]
  ));

  const head = `
    <tr>
      <th class="name">Employee</th>
      ${dayNumbers.map((d) => `<th>${d}</th>`).join('')}
      <th>Present<br/>Days</th>
      <th>Active<br/>Hours</th>
      <th>Monthly<br/>Target</th>
      <th>Achieved<br/>Output</th>
      <th>Defects</th>
      <th>Efficiency</th>
      <th>Variance</th>
    </tr>`;

  const body = monthRows.map((r) => `
    <tr>
      <td class="name">${esc(r.employee)}</td>
      ${dayNumbers.map((d) => {
        const value = r.days[d - 1] || 0;
        return `<td class="${value > 0 ? 'hit' : ''}">${value > 0 ? value.toLocaleString() : ''}</td>`;
      }).join('')}
      <td>${r.activeDays}</td>
      <td>${r.workingHours}</td>
      <td>${r.totalTarget.toLocaleString()}</td>
      <td class="strong">${r.totalOutput.toLocaleString()}</td>
      <td>${r.totalDefects.toLocaleString()}</td>
      <td class="strong">${r.efficiency}%</td>
      <td class="${r.varianceTone === 'good' ? 'good' : 'bad'}">${esc(r.varianceLabel)}</td>
    </tr>`).join('');

  const foot = `
    <tr class="total">
      <td class="name">Month total</td>
      ${dayNumbers.map((d) => `<td>${monthRows.reduce((s, r) => s + (r.days[d - 1] || 0), 0).toLocaleString()}</td>`).join('')}
      <td>${totals.presentDays ?? ''}</td>
      <td>${totals.hours ?? ''}</td>
      <td>${(totals.target ?? 0).toLocaleString()}</td>
      <td>${(totals.output ?? 0).toLocaleString()}</td>
      <td>${(totals.defects ?? 0).toLocaleString()}</td>
      <td>${totals.efficiency ?? 0}%</td>
      <td>${(totals.variance ?? 0) >= 0 ? '+' : ''}${(totals.variance ?? 0).toLocaleString()}</td>
    </tr>`;

  const rangeNote = from || to
    ? `Date range: ${esc(from || 'start')} → ${esc(to || 'end')}`
    : 'Date range: whole month';

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(title)} — ${esc(monthKey)}</title>
<style>
  @page { size: A3 landscape; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #0f172a; margin: 0; padding: 16px; }
  h1 { font-size: 16px; margin: 0 0 2px; }
  p.sub { font-size: 11px; color: #64748b; margin: 0 0 12px; }
  table { border-collapse: collapse; width: 100%; font-size: 10px; }
  th, td { border: 1px solid #cbd5e1; padding: 3px 4px; text-align: right; }
  th { background: #1e293b; color: #fff; font-weight: 600; text-align: center; }
  td.name, th.name { text-align: left; font-weight: 600; white-space: nowrap; }
  td.hit { background: #d1fae5; color: #047857; font-weight: 600; }
  td.strong { font-weight: 700; }
  td.good { color: #047857; font-weight: 700; background: #d1fae5; }
  td.bad { color: #b91c1c; font-weight: 700; background: #fee2e2; }
  tr.total td { background: #1e293b; color: #fff; font-weight: 700; }
  tr:nth-child(even) td { background-image: linear-gradient(rgba(241,245,249,.6), rgba(241,245,249,.6)); }
  tr.total td { background-image: none; }
</style>
</head>
<body>
  <h1>${esc(title)} — ${esc(monthKey)}</h1>
  <p class="sub">${rangeNote} · Generated ${esc(new Date().toLocaleString())}</p>
  <table>
    <thead>${head}</thead>
    <tbody>${body}${foot}</tbody>
  </table>
  <script>window.onload = function () { window.print(); };</script>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (!win) {
    window.alert('The print window was blocked. Allow pop-ups for this site to export the PDF.');
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

/** Re-exported so a caller does not re-implement the column label. */
export { hourLabel };