import React, { useMemo, useRef, useState } from 'react';
import { useData } from '../context/DataContext';
import { useRole } from '../context/RoleContext';
import { downloadDailyProductionWorkbook } from '../utils/dailyProductionExcel';
import HourlyTimesheet from './HourlyTimesheet';
import DailyEmployeeSheet from './DailyEmployeeSheet';
import MonthlyMatrixSheet from './MonthlyMatrixSheet';
import OverallSummaryDashboard from './OverallSummaryDashboard';
import { dayHeadline } from '../config/productionAggregation';

/**
 * ROBIUL GARMENTS ERP — Daily Production, the 3-tab screen.
 *
 * Daily Production used to be a form of its own, entered by hand. It is now a set
 * of three VIEWS of the Hourly Production entries, which is the brief's unified
 * architecture: Hourly Production is the single-source-of-truth input, and this
 * page shows what was entered, three ways.
 *
 *   Tab 1  Hourly Production         the input form and the day's hourly sheet —
 *                                     the SAME <HourlyTimesheet> the Hourly
 *                                     Production menu item renders
 *   Tab 2  Overall Summary Dashboard the factory-wide KPIs — the DEFAULT tab the
 *                                     module lands on
 *   Tab 3  Daily All-Employee Sheet  the detailed aggregated rows, grouped by
 *                                     employee, with Edit / Delete per row
 *   Tab 4  Monthly All-Employee Sheet the 1–31 day matrix with totals, active
 *                                     days, hours and monthly efficiency
 *
 * THE FIRST TAB IS THE INPUT FORM, AND IT IS THE SAME COMPONENT
 * -------------------------------------------------------------
 * Editing a row on Tab 1 must not be a fourth, separate editor: that is how two
 * screens end up disagreeing about the same day. So Tab 1's Edit action switches to
 * the Hourly Production form — literally the same <HourlyTimesheet> the Hourly
 * Production menu item renders — with the row's entries loaded. Save writes the
 * hourly rows; the aggregation re-derives itself; the sheet updates. One input, one
 * storage shape, three views.
 *
 * The date is held here rather than in each tab, so switching tabs keeps the day
 * being looked at.
 */
const TABS = [
  { key: 'entry', label: 'Hourly Production (Input & Sheets)', icon: '⏱️' },
  { key: 'summary', label: 'Overall Summary', icon: '📊' },
  { key: 'daily', label: 'Daily All-Employee', icon: '📋' },
  { key: 'monthly', label: 'Monthly All-Employee', icon: '🗓️' },
];

/**
 * The tab the module lands on. "Overall Summary" is the brief's default, so the
 * first thing a supervisor sees is the factory-wide picture rather than a form.
 */
const DEFAULT_TAB = 'summary';

const todayKey = () => new Date().toISOString().slice(0, 10);

export default function DailyProductionTabs() {
  const { getData } = useData();
  const { isAdmin } = useRole();
  const rows = getData('hourly-timesheet-rows');

  const [active, setActive] = useState(DEFAULT_TAB);
  const [date, setDate] = useState(todayKey());
  const [month, setMonth] = useState(() => todayKey().slice(0, 7));
  const [focusEntryIds, setFocusEntryIds] = useState(null);

  /**
   * The Hourly Production form lives INSIDE the Hourly tab's own component, so the
   * header's "+ New Entry" cannot open it directly. It reaches it through this
   * handle instead — the tab publishes its `openNewEntry` once it has mounted, and
   * the button calls it. That keeps the form's state where it belongs (in the tab)
   * while the action stays in the header, global to every tab as the brief asks.
   */
  const entryApi = useRef(null);

  const headline = useMemo(() => dayHeadline(rows, date), [rows, date]);

  /**
   * The records the Download Report button exports.
   *
   * The same `hourly-timesheet-rows` collection the whole module aggregates from,
   * filtered to the day the headline bar is showing — so the workbook matches what
   * the active tab is describing rather than quietly exporting another day.
   */
  const dayRows = useMemo(
    () => rows.filter((r) => String(r.date || '').slice(0, 10) === date),
    [rows, date],
  );

  /**
   * "+ New Entry": open the Hourly Production form.
   *
   * The form is the input half of the module, so the button first switches to the
   * Hourly Production tab — the supervisor sees the form they just opened, and
   * closing it leaves them on the tab they entered the day's figures on. The tab's
   * handle is called on the next frame, after that switch has rendered.
   */
  function handleNewEntry() {
    setActive('entry');
    requestAnimationFrame(() => entryApi.current?.openNewEntry?.());
  }

  /**
   * A NEW entry has been written by the Hourly Production form.
   *
   * The brief: on save, close the form and switch to the Overall Summary so the
   * updated breakdown is on screen immediately, rather than leaving the supervisor
   * on a form wondering whether the figure landed. The form closes itself (its own
   * `setShowForm(false)`), so this only has to move the tab — and, when the entry
   * was for another day, move the module's date with it so the summary is showing
   * the day that was just written rather than the day it happened to be on.
   */
  function handleSaved(row) {
    const savedDate = String(row?.date || '').slice(0, 10);
    if (savedDate) setDate(savedDate);
    setActive('summary');
  }

  /** "Download Report": export the day's rows, or say why there is nothing to export. */
  function handleDownloadReport() {
    if (dayRows.length === 0) {
      window.alert('No production records to download for the selected day.');
      return;
    }
    downloadDailyProductionWorkbook(dayRows, `daily-production-${date}.xlsx`);
  }

  /**
   * Edit a row from the Daily sheet: jump to the entry tab.
   *
   * The ids are handed to the Hourly form so it can highlight the entries being
   * corrected. `focusEntryIds` is a hint, not a filter — the whole day stays
   * visible, because a supervisor correcting one hour usually wants to see the
   * rest of the day around it.
   */
  function editEntries(entries) {
    setFocusEntryIds((entries || []).map((e) => e.id).filter((id) => id !== undefined && id !== null));
    setActive('entry');
  }

  return (
    <div className="module oi-tabs-module dp-tabs-module">
      <div className="module-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0 }}>📋 Daily Production</h2>
          {!isAdmin && <span className="badge badge-amber">View Only</span>}
        </div>
        <p className="hint" style={{ maxWidth: '82ch' }}>
          Every figure on this page is aggregated from Hourly Production — the single source of truth.
          Record work on the <strong>Hourly Production</strong> tab and it appears here immediately.
        </p>

        {/* The GLOBAL actions, in the top-level header rather than inside any one
            tab, so "+ New Entry" and "Download Report" are reachable whichever tab
            is open — the brief's placement, above the tab bar. */}
        <div className="module-actions dp-header-actions">
          {isAdmin && (
            <button type="button" className="btn btn-primary" onClick={handleNewEntry}>
              + New Entry
            </button>
          )}
          <button type="button" className="btn btn-outline" onClick={handleDownloadReport}>
            ⬇ Download Report
          </button>
        </div>
      </div>

      {/* The day's headline, above the tabs, so the state of the day is visible
          whichever tab is open. */}
      <div className="dp-headline-bar">
        <label className="form-field dp-headline-date">
          <span>Working Day</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <div className="dp-headline-stats">
          <span className="dp-headline-stat"><strong>{headline.pieces.toLocaleString()}</strong> pcs</span>
          <span className="dp-headline-stat"><strong>{headline.defects.toLocaleString()}</strong> defects</span>
          <span className="dp-headline-stat"><strong>{headline.achievement}%</strong> of target</span>
          <span className="dp-headline-stat"><strong>{headline.employees}</strong> employees</span>
        </div>
      </div>

      <div className="oi-tabbar" role="tablist" aria-label="Daily Production sections">
        {TABS.map((tab, i) => {
          const on = tab.key === active;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              id={`dp-tab-${tab.key}`}
              aria-selected={on}
              aria-controls={`dp-panel-${tab.key}`}
              tabIndex={on ? 0 : -1}
              className={`oi-tab${on ? ' active' : ''}`}
              onClick={() => setActive(tab.key)}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                e.preventDefault();
                const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
                setActive(next.key);
                document.getElementById(`dp-tab-${next.key}`)?.focus();
              }}
            >
              <span aria-hidden="true">{tab.icon}</span> {tab.label}
            </button>
          );
        })}
      </div>

      <div
        className="oi-tabpanel"
        role="tabpanel"
        id={`dp-panel-${active}`}
        aria-labelledby={`dp-tab-${active}`}
      >
        {active === 'daily' && (
          <DailyEmployeeSheet date={date} onEditEntry={editEntries} />
        )}
        {active === 'monthly' && (
          <MonthlyMatrixSheet month={month} onMonthChange={setMonth} />
        )}
        {active === 'summary' && (
          <OverallSummaryDashboard date={date} />
        )}
        {active === 'entry' && (
          <>
            {focusEntryIds && focusEntryIds.length > 0 && (
              <div className="erp-notice erp-notice-info dp-notice">
                Correcting {focusEntryIds.length} hourly entr{focusEntryIds.length === 1 ? 'y' : 'ies'} from the
                daily sheet. Save writes the hourly rows, and the sheet above re-derives itself.
              </div>
            )}
            {/* The SAME component the Hourly Production menu item renders. There is
                no second editor to keep in step. `onReady` hands the header's
                "+ New Entry" button the form's opener, so the global action opens
                this tab's form without the form's state leaving this tab. `onSaved`
                switches to the Overall Summary once a new entry lands, so the updated
                breakdown is what the supervisor sees next. */}
            <HourlyTimesheet
              onReady={(api) => { entryApi.current = api; }}
              onSaved={handleSaved}
              hideHeaderActions
            />
          </>
        )}
      </div>
    </div>
  );
}