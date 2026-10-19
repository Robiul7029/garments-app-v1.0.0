/**
 * ROBIUL GARMENTS ERP — Quality Control report export.
 *
 * Two outputs from one filtered set of QC rows, so the Excel file and the printed
 * PDF can never disagree about a figure:
 *
 *   Excel  — a styled .xlsx: title band, the KPI summary block, the defect-type
 *            ranking and the full summary table, on one sheet.
 *   PDF    — the browser's own print dialog on a purpose-built HTML document.
 *            There is no PDF writer in this app's dependencies, and adding one
 *            for a single screen would be a large dependency to justify. "Export
 *            to PDF" to the person clicking it means a printable sheet they can
 *            save as PDF, which is exactly what this produces.
 *
 * The column order and labels are taken from the screen's own table, so the file
 * a manager opens on the shop floor matches the screen a supervisor just read.
 * Every label is English, as the brief requires.
 */

import XLSX from 'xlsx-js-style';

// ARGB, light-on-white because the sheet is printed.
const INK = {
  ink: 'FF0F172A',
  slate: 'FF334155',
  muted: 'FF64748B',
  line: 'FFCBD5E1',
  band: 'FFF1F5F9',
  head: 'FF1E293B',
  good: 'FF047857',
  goodBg: 'FFD1FAE5',
  warn: 'FFB45309',
  warnBg: 'FFFEF3C7',
  bad: 'FFB91C1C',
  badBg: 'FFFEE2E2',
  white: 'FFFFFFFF',
};

const BORDER = {
  top: { style: 'thin', color: { rgb: INK.line } },
  bottom: { style: 'thin', color: { rgb: INK.line } },
  left: { style: 'thin', color: { rgb: INK.line } },
  right: { style: 'thin', color: { rgb: INK.line } },
};

const boxed = (extra = {}) => ({
  border: BORDER,
  alignment: { vertical: 'center', wrapText: true },
  ...extra,
});

/** A numeric cell, right-aligned so a column of figures lines up. */
const num = (extra = {}) => boxed({ alignment: { horizontal: 'right', vertical: 'center' }, ...extra });

/** The tone a status badge carries, mapped to the printed ink. */
const STATUS_INK = {
  success: { font: INK.good, fill: INK.goodBg },
  warning: { font: INK.warn, fill: INK.warnBg },
  danger: { font: INK.bad, fill: INK.badBg },
};

/** The table's column headers, in the brief's order. English, always. */
export const QUALITY_REPORT_COLUMNS = [
  { key: 'date', label: 'Date', width: 12, align: 'left' },
  { key: 'line', label: 'Line No', width: 12, align: 'left' },
  { key: 'orderNo', label: 'Order No', width: 14, align: 'left' },
  { key: 'style', label: 'Style No', width: 14, align: 'left' },
  { key: 'process', label: 'Process Name', width: 20, align: 'left' },
  { key: 'checkedQty', label: 'Checked Qty', width: 12, align: 'right' },
  { key: 'okPcs', label: 'OK Pcs', width: 10, align: 'right' },
  { key: 'alterPcs', label: 'Alter Pcs', width: 10, align: 'right' },
  { key: 'defectQty', label: 'Defect Qty', width: 11, align: 'right' },
  { key: 'defectRate', label: 'Defect Rate %', width: 13, align: 'right' },
  { key: 'statusLabel', label: 'Status', width: 12, align: 'left' },
];

/** A filename-safe stamp from the filter range, for the download. */
export function qualityReportStamp({ date = '', from = '', to = '' } = {}) {
  if (date) return date;
  if (from || to) return `${from || 'start'}_to_${to || 'end'}`;
  return new Date().toISOString().slice(0, 10);
}

/**
 * One worksheet for a quality report.
 *
 * `rows`      — buildQualitySummaryRows output (already filtered)
 * `summary`   — summariseQuality output for the same filtered set
 * `defects`   — summary.defectTypes, ranked
 * `filters`   — { date, from, to, line, order } for the range note
 */
export function buildQualityReportSheet({ rows = [], summary = {}, filters = {} } = {}) {
  const columns = QUALITY_REPORT_COLUMNS;
  const width = columns.length;
  const sheetRows = [];

  // ---- Title band ----
  sheetRows.push([{
    v: 'Quality Control — Inspection Summary',
    s: boxed({ font: { bold: true, sz: 15, color: { rgb: INK.ink } } }),
  }]);
  sheetRows.push([{
    v: qualityRangeNote(filters),
    s: boxed({ font: { italic: true, sz: 10, color: { rgb: INK.muted } } }),
  }]);
  sheetRows.push([]);

  // ---- KPI block ----
  const pct = (n) => `${n ?? 0}%`;
  const kpiRows = [
    ['Total Checked Qty', summary.totalChecked ?? 0],
    ['Pass / First-Time-Right %', pct(summary.passRate)],
    ['Total Defect / Reject Qty', summary.defectPcs ?? 0],
    ['Defect Rate %', pct(summary.defectRate)],
    ['Pending Alter / Repair Qty', summary.pendingAlter ?? 0],
    ['QC Entries', summary.entries ?? 0],
  ];
  kpiRows.forEach(([label, value]) => {
    sheetRows.push([
      { v: label, s: boxed({ font: { bold: true, color: { rgb: INK.slate } }, fill: { fgColor: { rgb: INK.band } } }) },
      { v: value, s: boxed({ font: { bold: true, color: { rgb: INK.ink } }, alignment: { horizontal: 'left', vertical: 'center' } }) },
    ]);
  });
  sheetRows.push([]);

  // ---- Top defect types ----
  if (Array.isArray(summary.defectTypes) && summary.defectTypes.length > 0) {
    sheetRows.push([{
      v: 'Top Defect Types',
      s: boxed({ font: { bold: true, color: { rgb: INK.white } }, fill: { fgColor: { rgb: INK.head } } }),
    }]);
    sheetRows.push([
      { v: 'Defect Type', s: boxed({ font: { bold: true, color: { rgb: INK.slate } } }) },
      { v: 'Defect Qty', s: boxed({ font: { bold: true, color: { rgb: INK.slate } }, alignment: { horizontal: 'right' } }) },
      { v: 'Share %', s: boxed({ font: { bold: true, color: { rgb: INK.slate } }, alignment: { horizontal: 'right' } }) },
      { v: 'Entries', s: boxed({ font: { bold: true, color: { rgb: INK.slate } }, alignment: { horizontal: 'right' } }) },
    ]);
    summary.defectTypes.forEach((d) => {
      sheetRows.push([
        { v: d.type, s: boxed({ color: { rgb: INK.ink } }) },
        { v: d.defectPcs, s: num() },
        { v: pct(d.share), s: num() },
        { v: d.entries, s: num() },
      ]);
    });
    sheetRows.push([]);
  }

  // ---- Summary table header ----
  const headerRowIndex = sheetRows.length;
  sheetRows.push(columns.map((c, i) => ({
    v: c.label,
    s: boxed({
      font: { bold: true, color: { rgb: INK.white } },
      fill: { fgColor: { rgb: INK.head } },
      alignment: { horizontal: i === 0 ? 'left' : c.align, vertical: 'center', wrapText: true },
    }),
  })));

  // ---- Summary table body ----
  rows.forEach((r, index) => {
    const band = index % 2 === 0 ? INK.white : INK.band;
    const tone = STATUS_INK[r.statusTone] || {};
    sheetRows.push(columns.map((c, i) => {
      const raw = r[c.key];
      const value = c.key === 'defectRate' ? `${raw ?? 0}%` : raw;
      const style = c.align === 'right'
        ? num({ fill: { fgColor: { rgb: band } } })
        : boxed({ fill: { fgColor: { rgb: band } } });
      if (c.key === 'statusLabel') {
        return { v: value, s: boxed({ font: { bold: true, color: { rgb: tone.font || INK.ink } }, fill: { fgColor: { rgb: tone.fill || band } } }) };
      }
      return { v: value, s: style };
    }));
  });

  const sheet = XLSX.utils.aoa_to_sheet(sheetRows);

  sheet['!cols'] = columns.map((c) => ({ wch: c.width }));
  // Freeze under the title band so the header stays visible when scrolled.
  sheet['!freeze'] = { ySplit: headerRowIndex + 1 };
  // Merge the title and the range note across the table width.
  sheet['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(0, width - 1) } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: Math.max(0, width - 1) } },
  ];

  return sheet;
}

function qualityRangeNote({ date = '', from = '', to = '', line = '', order = '' } = {}) {
  const bits = [];
  if (date) bits.push(`Date: ${date}`);
  else if (from || to) bits.push(`Date range: ${from || 'start'} → ${to || 'end'}`);
  else bits.push('Date range: all entries');
  if (line) bits.push(`Line: ${line}`);
  if (order) bits.push(`Order: ${order}`);
  return bits.join(' · ');
}

/** Downloads the quality report as an .xlsx workbook. */
export function downloadQualityReportWorkbook(payload = {}, filename) {
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  if (rows.length === 0) {
    if (typeof window !== 'undefined') window.alert('No data to download yet.');
    return;
  }
  const name = filename || `quality-control-report-${qualityReportStamp(payload.filters)}.xlsx`;
  const workbook = XLSX.utils.book_new();
  const sheet = buildQualityReportSheet(payload);
  const sheetName = 'Quality Control'.replace(/[\\/?*[\]:]/g, '-').slice(0, 31);
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  XLSX.writeFile(workbook, name);
}

/**
 * Downloads the quality report as a print-ready PDF via the browser's print
 * dialog. A popup blocker is handled by saying so rather than failing silently.
 */
export function downloadQualityReportPDF(payload = {}, { title = 'Quality Control — Inspection Summary' } = {}) {
  const { rows = [], summary = {}, filters = {} } = payload || {};
  if (typeof window === 'undefined') return;
  if (!Array.isArray(rows) || rows.length === 0) {
    window.alert('No data to download yet.');
    return;
  }

  const esc = (value) => String(value ?? '').replace(/[&<>"]/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]
  ));
  const pct = (n) => `${n ?? 0}%`;

  const head = `<tr>${QUALITY_REPORT_COLUMNS.map((c) => `<th class="${c.align === 'right' ? 'right' : ''}">${esc(c.label)}</th>`).join('')}</tr>`;

  const body = rows.map((r) => `<tr>${QUALITY_REPORT_COLUMNS.map((c) => {
    const raw = r[c.key];
    const value = c.key === 'defectRate' ? pct(raw) : raw;
    const cls = c.key === 'statusLabel'
      ? `status ${r.statusTone === 'success' ? 'good' : r.statusTone === 'warning' ? 'warn' : 'bad'}`
      : c.align === 'right' ? 'right' : '';
    return `<td class="${cls}">${esc(value)}</td>`;
  }).join('')}</tr>`).join('');

  const defectBlock = Array.isArray(summary.defectTypes) && summary.defectTypes.length > 0
    ? `<h2>Top Defect Types</h2>
       <table class="defects">
         <thead><tr><th>Defect Type</th><th class="right">Defect Qty</th><th class="right">Share %</th><th class="right">Entries</th></tr></thead>
         <tbody>${summary.defectTypes.map((d) => `<tr><td>${esc(d.type)}</td><td class="right">${d.defectPcs}</td><td class="right">${pct(d.share)}</td><td class="right">${d.entries}</td></tr>`).join('')}</tbody>
       </table>`
    : '';

  const kpiBlock = `<div class="kpis">
    <div class="kpi"><span>Total Checked Qty</span><strong>${(summary.totalChecked ?? 0).toLocaleString()}</strong></div>
    <div class="kpi"><span>Pass / First-Time-Right %</span><strong>${pct(summary.passRate)}</strong></div>
    <div class="kpi"><span>Total Defect / Reject Qty</span><strong>${(summary.defectPcs ?? 0).toLocaleString()}</strong></div>
    <div class="kpi"><span>Defect Rate %</span><strong>${pct(summary.defectRate)}</strong></div>
    <div class="kpi"><span>Pending Alter / Repair Qty</span><strong>${(summary.pendingAlter ?? 0).toLocaleString()}</strong></div>
  </div>`;

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(title)}</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #0f172a; margin: 0; padding: 16px; }
  h1 { font-size: 17px; margin: 0 0 2px; }
  h2 { font-size: 13px; margin: 18px 0 8px; }
  p.sub { font-size: 11px; color: #64748b; margin: 0 0 12px; }
  .kpis { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 6px; }
  .kpi { border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px 12px; min-width: 150px; }
  .kpi span { display: block; font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: .04em; }
  .kpi strong { font-size: 18px; }
  table { border-collapse: collapse; width: 100%; font-size: 10px; }
  th, td { border: 1px solid #cbd5e1; padding: 4px 6px; text-align: left; }
  th { background: #1e293b; color: #fff; font-weight: 600; }
  .right { text-align: right; }
  td.status { font-weight: 700; }
  td.status.good { color: #047857; background: #d1fae5; }
  td.status.warn { color: #b45309; background: #fef3c7; }
  td.status.bad { color: #b91c1c; background: #fee2e2; }
  table.defects { width: auto; min-width: 420px; margin-bottom: 4px; }
</style>
</head>
<body>
  <h1>${esc(title)}</h1>
  <p class="sub">${esc(qualityRangeNote(filters))} · Generated ${esc(new Date().toLocaleString())}</p>
  ${kpiBlock}
  ${defectBlock}
  <h2>Inspection Summary</h2>
  <table>
    <thead>${head}</thead>
    <tbody>${body}</tbody>
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
