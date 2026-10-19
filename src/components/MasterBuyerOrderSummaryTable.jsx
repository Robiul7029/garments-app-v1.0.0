import React, { useState } from 'react';
import { useOrderSummary } from '../hooks/useOrderSummary';
import { effTone } from './DailyEmployeeSheet';
import {
  downloadOrderSummaryWorkbook,
  printOrderSummary,
} from '../utils/orderSummaryExport';

/**
 * ROBIUL GARMENTS ERP — Master Buyer & Order Summary table.
 *
 * The second half of the Overall Summary tab: below the four factory-wide KPI
 * cards, one line per ORDER, so a merchandiser can read how each buyer's PO is
 * tracking today and month-to-date without leaving the page.
 *
 * ORDER NO IS THE THREAD
 * ----------------------
 * Each line is keyed on the Order No the hourly entries were booked against, and
 * its static facts (Buyer, Style No, PO Qty, Floor, Line, Supervisor) are pulled
 * from the order master — so nothing is retyped and the table cannot disagree
 * with Order Management. The movement (output, defects, manpower) comes from the
 * same hourly rows the KPI cards above read, so the two halves of the tab are
 * views of one data set by construction.
 *
 * WHAT A LINE SHOWS
 * -----------------
 *   Manpower            employees active on the order for the selected date
 *   PO Qty / Cum. Output / PO Progress %   how much of the order is done
 *   Daily Target / Output / Ach. %         today
 *   Monthly Target / Output / Ach. %       the month the date falls in
 *   Variance / Due                         what is left of the PO
 *
 * The filters (Buyer/Order search, Line dropdown, Date) narrow the SAME list the
 * footer totals and both exports read, so what is exported is what is on screen.
 */
export default function MasterBuyerOrderSummaryTable({ date }) {
  const {
    date: activeDate,
    setDate,
    search,
    setSearch,
    line,
    setLine,
    lineOptions,
    orders,
    totals,
    totalOrders,
  } = useOrderSummary(date);

  const payload = { orders, totals, date: activeDate, line, search };
  // Typing filters immediately. The explicit icon/search submit uses the same
  // controlled query (setting the current value also supports assistive input).
  const [searchDraft, setSearchDraft] = useState(search);

  const handleExcel = () => downloadOrderSummaryWorkbook(
    payload,
    `master-buyer-order-summary-${activeDate || 'export'}.xlsx`,
  );

  const handlePdf = () => printOrderSummary(payload);

  return (
    <section className="dp-card dp-order-summary">
      <div className="dp-order-summary-head">
        <h3 className="dp-card-title">
          Master Buyer &amp; Order Summary
          <span className="dp-card-sub">
            {totals.orders} order{totals.orders === 1 ? '' : 's'} · {activeDate}
          </span>
        </h3>
        <div className="dp-order-summary-actions">
          <button type="button" className="btn btn-outline btn-sm" onClick={handleExcel}>⬇ Export Excel</button>
          <button type="button" className="btn btn-outline btn-sm" onClick={handlePdf}>🧾 Export PDF</button>
        </div>
      </div>

      {/* ---- Filters: search, line, date ---- */}
      <div className="dp-order-summary-filters">
        <form
          className="form-field dp-filter-search"
          role="search"
          onSubmit={(event) => { event.preventDefault(); setSearch(searchDraft); }}
        >
          <label htmlFor="dp-order-summary-search">Search Buyer / Order No</label>
          <div className="dp-search-input-wrap">
            <input
              id="dp-order-summary-search"
              type="search"
              value={searchDraft}
              placeholder="Search Buyer / Order No"
              onChange={(event) => {
                const value = event.target.value;
                setSearchDraft(value);
                setSearch(value);
              }}
            />
            <button
              type="submit"
              className="dp-search-submit"
              aria-label="Search orders"
              title="Search"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none">
                <circle cx="10.8" cy="10.8" r="6.5" stroke="currentColor" strokeWidth="2.2" />
                <path d="m16 16 4.2 4.2" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </form>
        <label className="form-field dp-filter-line">
          <span>Line</span>
          <select value={line} onChange={(e) => setLine(e.target.value)}>
            <option value="">All lines</option>
            {lineOptions.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
        <label className="form-field dp-filter-date">
          <span>Date</span>
          <input
            type="date"
            value={activeDate || ''}
            onChange={(e) => setDate(e.target.value || null)}
          />
        </label>
        {(search || line) && (
          <button
            type="button"
            className="btn-icon dp-filter-clear"
            title="Clear filters"
            onClick={() => { setSearchDraft(''); setSearch(''); setLine(''); }}
          >
            ✕ Clear
          </button>
        )}
      </div>

      {orders.length === 0 ? (
        <p className="dp-empty">
          {totalOrders === 0
            ? 'No order production recorded for this month yet. Record work on the Hourly Entry tab and pick its Order No.'
            : 'No orders match the current filters.'}
        </p>
      ) : (
        <div className="table-wrap dp-order-summary-wrap">
          <table className="dp-table dp-order-table">
            <thead>
              <tr>
                <th>Buyer</th>
                <th>Order No</th>
                <th>Style No</th>
                <th>Item</th>
                <th>Start Date</th>
                <th>Delivery Date</th>
                <th className="dp-num">PO Qty</th>
                <th>Floor</th>
                <th>Line</th>
                <th>Supervisor</th>
                <th className="dp-num">Manpower</th>
                <th className="dp-num">Cum. Output</th>
                <th className="dp-num">PO Progress</th>
                <th className="dp-num">Daily Target</th>
                <th className="dp-num">Daily Output</th>
                <th className="dp-num">Daily Ach.</th>
                <th className="dp-num">Monthly Target</th>
                <th className="dp-num">Monthly Output</th>
                <th className="dp-num">Monthly Ach.</th>
                <th className="dp-num">Variance / Due</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.key}>
                  <td className="dp-order-buyer">{o.buyer || '—'}</td>
                  <td className="mono-cell">{o.order_no || '—'}</td>
                  <td className="mono-cell">{o.style || '—'}</td>
                  <td className="dp-order-item" title={o.item || ''}>{o.item || '—'}</td>
                  <td className="mono-cell">{o.startDate || '—'}</td>
                  <td className="mono-cell">{o.deliveryDate || '—'}</td>
                  <td className="mono-cell dp-num">{o.poQty ? o.poQty.toLocaleString() : '—'}</td>
                  <td>{o.floor || '—'}</td>
                  <td>{o.line || '—'}</td>
                  <td className="dp-order-supervisor" title={o.supervisor || ''}>{o.supervisor || '—'}</td>
                  <td className="mono-cell dp-num">{o.activeEmployees}</td>
                  <td className="mono-cell dp-num">{o.monthOutput.toLocaleString()}</td>
                  <td className="mono-cell dp-num">
                    <span className={`dp-eff-badge ${effTone(o.poProgress)}`}>{o.poProgress}%</span>
                  </td>
                  <td className="mono-cell dp-num" title="Monthly target divided by this calendar month's standard working days.">{o.dailyTarget.toLocaleString()}</td>
                  <td className="mono-cell dp-num">{o.dailyOutput.toLocaleString()}</td>
                  <td className="mono-cell dp-num">
                    <span className={`dp-eff-badge ${effTone(o.dailyAchievement)}`}>{o.dailyAchievement}%</span>
                  </td>
                  <td className="mono-cell dp-num" title="PO quantity divided by the calendar duration from Start Date to Delivery Date.">{o.monthTarget.toLocaleString()}</td>
                  <td className="mono-cell dp-num">{o.monthOutput.toLocaleString()}</td>
                  <td className="mono-cell dp-num">
                    <span className={`dp-eff-badge ${effTone(o.monthAchievement)}`}>{o.monthAchievement}%</span>
                  </td>
                  <td className={`mono-cell dp-num ${o.poQty > 0 && o.remaining <= 0 ? 'dp-good' : 'dp-bad'}`}>
                    {o.dueLabel}
                  </td>
                </tr>
              ))}
            </tbody>
            {/* Totals, summed from exactly the rows above, so the footer always
                matches what the filters left on screen. */}
            <tfoot>
              <tr className="dp-order-total">
                <td colSpan={6}>{totals.orders} order{totals.orders === 1 ? '' : 's'}</td>
                <td className="mono-cell dp-num">{totals.poQty.toLocaleString()}</td>
                <td colSpan={3} />
                <td className="mono-cell dp-num">{totals.activeEmployees}</td>
                <td className="mono-cell dp-num">{totals.monthOutput.toLocaleString()}</td>
                <td className="mono-cell dp-num">{totals.poProgress}%</td>
                <td className="mono-cell dp-num">{totals.dailyTarget.toLocaleString()}</td>
                <td className="mono-cell dp-num">{totals.dailyOutput.toLocaleString()}</td>
                <td className="mono-cell dp-num">{totals.dailyAchievement}%</td>
                <td className="mono-cell dp-num">{totals.monthTarget.toLocaleString()}</td>
                <td className="mono-cell dp-num">{totals.monthOutput.toLocaleString()}</td>
                <td className="mono-cell dp-num">{totals.monthAchievement}%</td>
                <td className="mono-cell dp-num dp-bad">{totals.remaining.toLocaleString()} Due</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}