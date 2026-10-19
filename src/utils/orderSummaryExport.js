/**
 * ROBIUL GARMENTS ERP — Master Buyer & Order Summary export.
 *
 * Two formats, from one data set, for the two ways a factory actually uses this
 * table:
 *
 *   Excel  a working document — the numbers a merchandiser sorts, filters and
 *          pastes into their own report. Built with `xlsx-js-style` for the same
 *          reason the other production exports use it: the community SheetJS
 *          build parses a cell's `.s` on read but never serialises it on write, so
 *          a styled sheet is impossible with it.
 *
 *   PDF    a read-only document — the sheet a manager prints, pins up or emails
 *          to a buyer. Rendered through the browser's own print dialog (the same
 *          "print to PDF" every machine already has) rather than pulling in a PDF
 *          library: it adds no dependency, and the printed page is the on-screen
 *          table the user is already looking at, so what they export is exactly
 *          what they saw.
 *
 * Both take the ALREADY-FILTERED rows the table is showing, so an export can
 * never ship figures the user had filtered out.
 */
import XLSX from 'xlsx-js-style';

// ---- Palette (light-on-white, because the sheet and the PDF are printed) ----
const C = {
  ink: 'FF0F172A',
  slate: 'FF334155',
  muted: 'FF64748B',
  line: 'FFCBD5E1',
  band: 'FFF1F5F9',
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

const num = (extra = {}) => boxed({
  alignment: { horizontal: 'right', vertical: 'center' },
  ...extra,
});

/**
 * The columns of the master table, in order. Shared by the on-screen table's
 * export and the PDF so a column cannot be added to one and forgotten in the
 * other — the label, the key and the alignment live here once.
 */
export const ORDER_SUMMARY_COLUMNS = [
  { key: 'buyer', label: 'Buyer', align: 'left' },
  { key: 'order_no', label: 'Order No', align: 'left' },
  { key: 'style', label: 'Style No', align: 'left' },
  { key: 'item', label: 'Item', align: 'left' },
  { key: 'startDate', label: 'Start Date', align: 'left' },
  { key: 'deliveryDate', label: 'Delivery Date', align: 'left' },
  { key: 'poQty', label: 'PO Qty', align: 'right' },
  { key: 'floor', label: 'Floor', align: 'left' },
  { key: 'line', label: 'Line', align: 'left' },
  { key: 'supervisor', label: 'Supervisor', align: 'left' },
  { key: 'activeEmployees', label: 'Manpower', align: 'right' },
  { key: 'monthOutput', label: 'Cum. Output', align: 'right' },
  { key: 'poProgress', label: 'PO Progress %', align: 'right' },
  { key: 'dailyTarget', label: 'Daily Target', align: 'right' },
  { key: 'dailyOutput', label: 'Daily Output', align: 'right' },
  { key: 'dailyAchievement', label: 'Daily Ach. %', align: 'right' },
  { key: 'monthTarget', label: 'Monthly Target', align: 'right' },
  { key: 'monthOutput', label: 'Monthly Output', align: 'right' },
  { key: 'monthAchievement', label: 'Monthly Ach. %', align: 'right' },
  { key: 'dueLabel', label: 'Variance / Due', align: 'left' },
];

/** The value for one column on one row, formatted as the screen shows it. */
function cellValue(row, key) {
  const v = row?.[key];
  if (v === undefined || v === null) return '';
  if (key === 'dueLabel') return v;
  if (key.endsWith('Achievement') || key === 'poProgress') return `${v}%`;
  if (typeof v === 'number') return v;
  return v;
}

/**
 * Builds the worksheet for the master table. Exported so a test can assert the
 * layout without touching the filesystem.
 */
export function buildOrderSummarySheet({ orders = [], totals = {}, date = '', line = '', search = '' } = {}) {
  const rows = [];
  const width = ORDER_SUMMARY_COLUMNS.length;

  rows.push([{ v: 'Master Buyer & Order Summary', s: boxed({ font: { bold: true, sz: 14, color: { rgb: C.ink } } }) }]);
  const filters = [
    date ? `Date ${date}` : '',
    line ? `Line ${line}` : 'All lines',
    search ? `Search "${search}"` : '',
  ].filter(Boolean).join('   ·   ');
  rows.push([{ v: filters || 'All orders', s: boxed({ font: { italic: true, sz: 10, color: { rgb: C.muted } } }) }]);
  rows.push([]);

  // ---- Header ----
  rows.push(ORDER_SUMMARY_COLUMNS.map((c) => ({
    v: c.label,
    s: boxed({
      font: { bold: true, color: { rgb: C.white } },
      fill: { fgColor: { rgb: C.head } },
      alignment: { horizontal: c.align === 'right' ? 'right' : 'left', vertical: 'center', wrapText: true },
    }),
  })));

  // ---- One row per order ----
  orders.forEach((o, index) => {
    const band = index % 2 === 0 ? C.white : C.band;
    rows.push(ORDER_SUMMARY_COLUMNS.map((col) => {
      const value = cellValue(o, col.key);
      if (col.key === 'buyer') {
        return { v: value, s: boxed({ font: { bold: true, color: { rgb: C.ink } }, fill: { fgColor: { rgb: band } } }) };
      }
      if (col.key === 'dueLabel') {
        const good = o.poQty > 0 && o.remaining <= 0;
        return {
          v: value,
          s: boxed({
            font: { bold: true, color: { rgb: good ? C.good : C.bad } },
            fill: { fgColor: { rgb: good ? C.goodBg : C.badBg } },
          }),
        };
      }
      if (col.key.endsWith('Achievement')) {
        const n = Number(o[col.key]) || 0;
        const tone = n >= 90 ? C.good : n >= 70 ? C.slate : C.bad;
        return { v: value, s: num({ font: { bold: true, color: { rgb: tone } }, fill: { fgColor: { rgb: band } } }) };
      }
      return {
        v: value,
        s: col.align === 'right'
          ? num({ fill: { fgColor: { rgb: band } } })
          : boxed({ fill: { fgColor: { rgb: band } } }),
      };
    }));
  });

  // ---- Total line ----
  if (orders.length > 0) {
    rows.push(ORDER_SUMMARY_COLUMNS.map((col) => {
      const head = boxed({ font: { bold: true, color: { rgb: C.white } }, fill: { fgColor: { rgb: C.head } } });
      const headNum = num({ font: { bold: true, color: { rgb: C.white } }, fill: { fgColor: { rgb: C.head } } });
      switch (col.key) {
        case 'buyer': return { v: `${totals.orders || orders.length} orders`, s: head };
        case 'poQty': return { v: totals.poQty || 0, s: headNum };
        case 'activeEmployees': return { v: totals.activeEmployees || 0, s: headNum };
        case 'monthOutput': return { v: totals.monthOutput || 0, s: headNum };
        case 'poProgress': return { v: `${totals.poProgress || 0}%`, s: headNum };
        case 'dailyTarget': return { v: totals.dailyTarget || 0, s: headNum };
        case 'dailyOutput': return { v: totals.dailyOutput || 0, s: headNum };
        case 'dailyAchievement': return { v: `${totals.dailyAchievement || 0}%`, s: headNum };
        case 'monthTarget': return { v: totals.monthTarget || 0, s: headNum };
        case 'monthAchievement': return { v: `${totals.monthAchievement || 0}%`, s: headNum };
        case 'dueLabel': return { v: `${(totals.remaining || 0).toLocaleString()} Due`, s: headNum };
        default: return { v: '', s: head };
      }
    }));
  }

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = [
    { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 18 }, { wch: 12 },
    { wch: 14 }, { wch: 10 }, { wch: 9 }, { wch: 10 }, { wch: 16 },
    { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
    { wch: 12 }, { wch: 13 }, { wch: 12 }, { wch: 13 }, { wch: 18 },
  ];
  sheet['!freeze'] = { xSplit: 0, ySplit: 4 };
  sheet['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: width - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: width - 1 } },
  ];
  return sheet;
}

/** Downloads the master table as an .xlsx workbook. */
export function downloadOrderSummaryWorkbook(payload, filename = 'master-buyer-order-summary.xlsx') {
  const { orders = [] } = payload || {};
  if (!Array.isArray(orders) || orders.length === 0) {
    if (typeof window !== 'undefined') window.alert('No data to export yet.');
    return;
  }
  const workbook = XLSX.utils.book_new();
  const sheet = buildOrderSummarySheet(payload);
  XLSX.utils.book_append_sheet(workbook, sheet, 'Order Summary');
  XLSX.writeFile(workbook, filename);
}

/**
 * Opens the browser's print dialog for the summary — the route to a PDF.
 *
 * A new window is filled with a self-contained, print-styled copy of the table
 * (dark ERP chrome replaced by light-on-white) and printed, so the output is a
 * clean document rather than a screenshot of the app. If the popup is blocked
 * the caller is told, rather than left wondering why nothing happened.
 *
 * @param {object} payload  { orders, totals, date, line, search }
 */
export function printOrderSummary(payload = {}) {
  if (typeof window === 'undefined') return;
  const { orders = [], totals = {}, date = '', line = '', search = '' } = payload;
  if (orders.length === 0) {
    window.alert('No data to export yet.');
    return;
  }

  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const head = ORDER_SUMMARY_COLUMNS.map((c) => `<th class="${c.align}">${esc(c.label)}</th>`).join('');
  const body = orders.map((o) => {
    const cells = ORDER_SUMMARY_COLUMNS.map((col) => {
      let cls = col.align;
      if (col.key === 'dueLabel') cls += o.poQty > 0 && o.remaining <= 0 ? ' good' : ' bad';
      if (col.key.endsWith('Achievement')) {
        const n = Number(o[col.key]) || 0;
        cls += n >= 90 ? ' good' : n >= 70 ? ' warn' : ' bad';
      }
      return `<td class="${cls}">${esc(cellValue(o, col.key))}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');

  const totalRow = `<tr class="total">
    <td class="left">${esc(`${totals.orders || orders.length} orders`)}</td>
    ${ORDER_SUMMARY_COLUMNS.slice(1).map((col) => {
      let v = '';
      switch (col.key) {
        case 'poQty': v = totals.poQty || 0; break;
        case 'activeEmployees': v = totals.activeEmployees || 0; break;
        case 'monthOutput': v = totals.monthOutput || 0; break;
        case 'poProgress': v = `${totals.poProgress || 0}%`; break;
        case 'dailyTarget': v = totals.dailyTarget || 0; break;
        case 'dailyOutput': v = totals.dailyOutput || 0; break;
        case 'dailyAchievement': v = `${totals.dailyAchievement || 0}%`; break;
        case 'monthTarget': v = totals.monthTarget || 0; break;
        case 'monthAchievement': v = `${totals.monthAchievement || 0}%`; break;
        case 'dueLabel': v = `${(totals.remaining || 0).toLocaleString()} Due`; break;
        default: v = '';
      }
      return `<td class="${col.align}">${esc(v)}</td>`;
    }).join('')}
  </tr>`;

  const filterNote = [date ? `Date ${esc(date)}` : '', line ? `Line ${esc(line)}` : 'All lines', search ? `Search "${esc(search)}"` : '']
    .filter(Boolean).join('   ·   ');

  const html = `<!doctype html><html><head><meta charset="utf-8">
<title>Master Buyer &amp; Order Summary</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Roboto, Arial, sans-serif; color: #0f172a; margin: 18px; }
  h1 { font-size: 17px; margin: 0 0 2px; }
  .note { font-size: 11px; color: #64748b; margin: 0 0 12px; }
  table { border-collapse: collapse; width: 100%; font-size: 10.5px; }
  th, td { border: 1px solid #cbd5e1; padding: 4px 6px; }
  th { background: #1e293b; color: #fff; text-align: center; }
  td.left, th.left { text-align: left; }
  td.right, th.right { text-align: right; font-variant-numeric: tabular-nums; }
  tr:nth-child(even) td { background: #f1f5f9; }
  .good { color: #047857; font-weight: 700; }
  .warn { color: #b45309; font-weight: 700; }
  .bad { color: #b91c1c; font-weight: 700; }
  tr.total td { background: #1e293b; color: #fff; font-weight: 700; }
  @media print { body { margin: 0; } h1 { font-size: 15px; } table { font-size: 9.5px; } }
</style></head><body>
  <h1>Master Buyer &amp; Order Summary</h1>
  <p class="note">${filterNote || 'All orders'}</p>
  <table><thead><tr>${head}</tr></thead><tbody>${body}${totalRow}</tbody></table>
  <script>window.onload = function () { window.focus(); window.print(); };</script>
</body></html>`;

  const win = window.open('', '_blank');
  if (!win) {
    window.alert('Please allow pop-ups to export the summary as PDF.');
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}