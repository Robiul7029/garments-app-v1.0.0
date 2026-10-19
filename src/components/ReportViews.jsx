import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useData } from '../context/DataContext';
import { useRole } from '../context/RoleContext';
import { useErpData } from '../context/ErpDataContext';
import { usePermissions } from '../context/PermissionContext';
import { C } from '../config/erpSchema';
import { MODULE } from '../config/erpRoles';
import { downloadCSV } from '../utils/csv';
import { targetForProcess, dueLabel } from '../utils/calc';
import {
  resolveReportFilters,
  filterReportRows,
  reportOrderOptions,
  reportMonthOptions,
  describeReportFilters,
  monthLabel,
} from '../config/productionReportFilters';

function rowOutputForReport(row = {}) {
  const hourly = Object.values(row.hours || {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
  return hourly || Number(row.quantity ?? row.output ?? row.dailyTotal ?? row.actual) || 0;
}

/**
 * ROBIUL GARMENTS ERP — Production Report.
 *
 * The production history, narrowed three ways:
 *
 *   1. ORDER ONLY    — pick an Order No and nothing else. The order's complete
 *                      production history is shown, with no date required.
 *   2. DATE RANGE    — a custom window, e.g. the 1st to the 30th of a month.
 *   3. SINGLE MONTH  — one month picker, which expands to that month's full span.
 *
 * Any of the three combines with any other. There is deliberately NO Style
 * dropdown: style is a property of an order, so filtering by order already covers
 * the question, and a second control that could contradict it only invited a
 * combination the reader could not explain.
 *
 * The ORDER dropdown is populated from the live ERP `orders` collection AND from
 * the order numbers that actually appear on the production rows. It carries
 * ARCHIVED orders as well as active ones, on purpose: a shipped order is exactly
 * the one whose history somebody opens this screen to look up, so hiding the
 * finished ones would remove the report's most useful rows. An order number that
 * survives only on a production row (its master record deleted) stays filterable
 * too, so a historical entry never becomes unreachable.
 *
 * Every filter decision is made by `config/productionReportFilters`, which is pure
 * and unit-tested, so the table, the per-style summary and the three export
 * buttons describe one set of rows.
 */
export function ProductionReportView() {
  const { getData } = useData();
  const { isAdmin } = useRole();
  const permissions = usePermissions();
  const erp = useErpData();
  const dailyRows = getData('daily-production');
  const hourlyRows = getData('hourly-timesheet-rows');

  // The order master, read LIVE from Firestore so an order raised in another tab
  // appears in the dropdown without a refresh. Subscribed only when the role may
  // read orders; the report still works from the production rows alone without it.
  const canReadOrders = permissions.canView(MODULE.ORDERS);
  useEffect(() => {
    if (!canReadOrders) return undefined;
    return erp.subscribe('reportOrders', {
      collection: C.ORDERS,
      pageSize: 500,
    });
  }, [canReadOrders, erp.subscribe]);

  const orders = useMemo(() => {
    // The ERP collection when it has answered, otherwise the legacy local order
    // master — so the dropdown is never empty on a deployment that still keeps its
    // orders in the local store.
    const live = canReadOrders ? erp.rows('reportOrders') : [];
    return live.length > 0 ? live : getData('order-model');
  }, [canReadOrders, erp, getData]);

  // The filter controls. `orderFilter` is 'all' when no order is chosen.
  const [filters, setFilters] = useState({ from: '', to: '', month: '', orderNo: 'all' });
  const setFilter = (patch) => setFilters((prev) => ({ ...prev, ...patch }));

  const rows = useMemo(() => {
    const combined = hourlyRows.length ? hourlyRows : dailyRows;
    const byOrder = new Map(orders.map((order) => [String(order.order_no || order.orderNo || order.style || ''), order]));
    return combined.map((row) => {
      const orderKey = String(row.order_no || row.style || '');
      const order = byOrder.get(orderKey) || orders.find((candidate) => String(candidate.style || '') === String(row.style || '')) || {};
      const quantity = rowOutputForReport(row);
      const hoursCount = Object.keys(row.hours || {}).filter((hour) => Number(row.hours[hour]) > 0).length;
      const target = Number(row.daily_target ?? row.dailyTarget) || (Number(row.target) || targetForProcess(row.process)) * Math.max(1, hoursCount || Number(row.working_hours) || 1);
      const due = dueLabel(target, quantity);
      return { ...row, order_no: row.order_no || order.order_no || order.poNo || '', style: row.style || order.style || '', po_qty: row.po_qty ?? order.qty ?? order.totalQty ?? '', quantity, target, due: due.label, ok: due.ok };
    });
  }, [dailyRows, hourlyRows, orders]);

  // The Order dropdown: every order the master holds (active AND archived) plus
  // every order number present on a production row.
  const orderOptions = useMemo(() => reportOrderOptions(orders, rows), [orders, rows]);

  // The months that actually contain production, so the picker can say which ones
  // have data rather than sending the reader through empty ones.
  const monthOptions = useMemo(() => reportMonthOptions(rows), [rows]);

  // One resolved window + one order key, so every figure below agrees.
  const resolved = useMemo(() => resolveReportFilters({
    ...filters,
    orderNo: filters.orderNo === 'all' ? '' : filters.orderNo,
  }), [filters]);

  const filtered = useMemo(() => filterReportRows(rows, resolved), [rows, resolved]);

  const filterSummary = useMemo(() => describeReportFilters({
    ...filters,
    orderNo: filters.orderNo === 'all' ? '' : filters.orderNo,
  }), [filters]);

  const running = filtered.filter((row) => !row.completed && !row.previousOrder && !['Completed', 'Closed', 'Archived', 'Inactive', 'Cancelled', 'Shipped'].includes(String(row.status || '')));
  const previous = filtered.filter((row) => row.completed || row.previousOrder || ['Completed', 'Closed', 'Archived', 'Inactive', 'Cancelled', 'Shipped'].includes(String(row.status || '')));

  // Line-output style summary: total sewn per style, delivered onward to finishing
  const byStyle = {};
  filtered.forEach((r) => {
    const key = r.style || '(no style)';
    if (!byStyle[key]) byStyle[key] = { style: key, target: 0, achieved: 0 };
    byStyle[key].target += r.target;
    byStyle[key].achieved += Number(r.quantity || 0);
  });
  const summary = Object.values(byStyle);

  const columns = [
    { name: 'date', label: 'Date' }, { name: 'employee', label: 'Employee' }, { name: 'order_no', label: 'Order No' }, { name: 'style', label: 'Style' },
    { name: 'department', label: 'Department' }, { name: 'process', label: 'Process' },
    { name: 'target', label: 'Target' }, { name: 'quantity', label: 'Achieved' }, { name: 'due', label: 'Status' },
  ];

  const noMatches = filtered.length === 0;

  return (
    <div className="module">
      <div className="module-header"><h2>📈 Production Report</h2></div>

      <section className="dp-entry-card">
        <h3 className="dp-card-title">Report Filters</h3>
        <div className="dp-detail-grid">
          <label className="form-field">
            <span>Start Date</span>
            <input
              type="date"
              value={filters.from}
              // Choosing a custom bound clears the month picker, so the visible
              // control and the applied window can never disagree.
              onChange={(event) => setFilter({ from: event.target.value, month: '' })}
            />
          </label>
          <label className="form-field">
            <span>End Date</span>
            <input
              type="date"
              value={filters.to}
              onChange={(event) => setFilter({ to: event.target.value, month: '' })}
            />
          </label>
          <label className="form-field">
            <span>Month</span>
            <input
              type="month"
              value={filters.month}
              list="pr-month-options"
              // Picking a month clears the custom bounds: the month IS the window.
              onChange={(event) => setFilter({ month: event.target.value, from: '', to: '' })}
            />
          </label>
          {/* The months that actually hold production, offered as suggestions. */}
          <datalist id="pr-month-options">
            {monthOptions.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </datalist>
          <label className="form-field">
            <span>Order</span>
            <select value={filters.orderNo} onChange={(event) => setFilter({ orderNo: event.target.value })}>
              <option value="all">All Orders</option>
              {orderOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}{option.archived ? ' · Archived' : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="module-actions" style={{ marginTop: 10 }}>
          <span className="hint">Showing: {filterSummary}</span>
          {resolved.isFiltered && (
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => setFilters({ from: '', to: '', month: '', orderNo: 'all' })}
            >
              ✕ Clear Filters
            </button>
          )}
        </div>
      </section>

      {/* The brief's empty state, stated once at the page level so it is seen even
          when both category tables below would each say nothing. */}
      {noMatches && (
        <div className="dp-entry-card" role="status">
          <p className="hint" style={{ margin: 0 }}>No production records match the selected filters</p>
        </div>
      )}

      {!noMatches && (
        <div className="progress-card" style={{ marginBottom: 16 }}>
            <strong style={{ display: 'block', marginBottom: 8 }}>Output by Style</strong>
            {summary.map((s) => (
              <div key={s.style} className="hint" style={{ marginBottom: 4 }}>
                {s.style}: {s.achieved.toLocaleString()} pcs produced of {s.target.toLocaleString()} target
                {' '}({s.achieved >= s.target ? 'on track' : `${s.target - s.achieved} pcs behind`})
              </div>
            ))}
          </div>
      )}

      <ReportCategory title="Running Orders" rows={running} columns={columns} isAdmin={isAdmin} filename="running-production-report" />
      <ReportCategory title="Previous / Completed Orders" rows={previous} columns={columns} isAdmin={isAdmin} filename="completed-production-report" />
    </div>
  );
}

function ReportCategory({ title, rows, columns, isAdmin, filename }) {
  const downloadExcel = () => {
    const sheet = XLSX.utils.json_to_sheet(rows.map((row) => Object.fromEntries(columns.map((column) => [column.label, row[column.name] ?? '']))));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Production Report');
    XLSX.writeFile(workbook, `${filename}.xlsx`);
  };
  const downloadPdf = () => {
    const document = new jsPDF({ orientation: 'landscape' });
    document.setFontSize(14);
    document.text(title, 14, 16);
    autoTable(document, {
      startY: 22,
      head: [columns.map((column) => column.label)],
      body: rows.map((row) => columns.map((column) => String(row[column.name] ?? ''))),
      styles: { fontSize: 8 },
    });
    document.save(`${filename}.pdf`);
  };
  return (
    <section className="dp-entry-card">
      <div className="module-actions"><h3 className="dp-card-title">{title} ({rows.length})</h3>{isAdmin && <div className="ps-row-actions"><button className="btn btn-outline btn-sm" onClick={() => downloadCSV(`${filename}.csv`, rows, columns)}>Download CSV</button><button className="btn btn-outline btn-sm" onClick={downloadExcel}>Download Excel</button><button className="btn btn-outline btn-sm" onClick={downloadPdf}>Download PDF</button></div>}</div>
      <div className="table-wrap"><table><thead><tr>{columns.map((column) => <th key={column.name}>{column.label}</th>)}</tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={columns.length} className="empty-row">No production records match the selected filters</td></tr> : rows.map((row, index) => <tr key={row.id || `${row.date}-${row.order_no}-${index}`}>{columns.slice(0, -1).map((column) => <td key={column.name}>{row[column.name]}</td>)}<td><span className={`erp-chip ${row.ok ? 'erp-chip-good' : 'erp-chip-warning'}`}>{row.due}</span></td></tr>)}</tbody></table></div>
    </section>
  );
}

export function CuttingReportView() {
  const { getData } = useData();
  const { isAdmin } = useRole();
  const rows = getData('cutting-production');

  const computed = rows.map((r) => {
    const target = Number(r.lay_qty || 0) * 10; // 10 pcs per lay, adjust to your real ratio
    const due = dueLabel(target, Number(r.quantity || 0));
    return { ...r, cutting_target: target, due: due.label, ok: due.ok };
  });

  const columns = [
    { name: 'date', label: 'Date' }, { name: 'employee', label: 'Employee' }, { name: 'style', label: 'Style' },
    { name: 'color', label: 'Color' }, { name: 'lay_qty', label: 'Lay' },
    { name: 'cutting_target', label: 'Cutting Target' }, { name: 'quantity', label: 'Cut Qty' }, { name: 'due', label: 'Due' },
  ];

  return (
    <div className="module">
      <div className="module-header"><h2>📄 Cutting Report</h2></div>
      {isAdmin && (
        <div className="module-actions">
          <button className="btn btn-outline" onClick={() => downloadCSV('cutting-report.csv', computed, columns)}>⬇ Download Report</button>
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead><tr>{columns.map((c) => <th key={c.name}>{c.label}</th>)}</tr></thead>
          <tbody>
            {computed.length === 0 && <tr><td colSpan={columns.length} className="empty-row">No entries yet.</td></tr>}
            {computed.map((r) => (
              <tr key={r.id}>
                {columns.slice(0, -1).map((c) => <td key={c.name}>{r[c.name]}</td>)}
                <td style={{ color: r.ok ? '#34d399' : '#f87171' }}>{r.due}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function FinishingReportView() {
  const { getData } = useData();
  const { isAdmin } = useRole();
  const rows = getData('finishing-production');

  const computed = rows.map((r) => {
    const target = targetForProcess(r.process);
    return { ...r, target };
  });

  const columns = [
    { name: 'employee', label: 'Worker Name' }, { name: 'date', label: 'Date' }, { name: 'style', label: 'Style' },
    { name: 'process', label: 'Process' }, { name: 'target', label: 'Target' }, { name: 'quantity', label: 'Output Quantity' },
  ];

  return (
    <div className="module">
      <div className="module-header"><h2>📄 Finishing Report</h2></div>
      {isAdmin && (
        <div className="module-actions">
          <button className="btn btn-outline" onClick={() => downloadCSV('finishing-report.csv', computed, columns)}>⬇ Download Report</button>
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead><tr>{columns.map((c) => <th key={c.name}>{c.label}</th>)}</tr></thead>
          <tbody>
            {computed.length === 0 && <tr><td colSpan={columns.length} className="empty-row">No entries yet.</td></tr>}
            {computed.map((r) => (
              <tr key={r.id}>{columns.map((c) => <td key={c.name}>{r[c.name]}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
