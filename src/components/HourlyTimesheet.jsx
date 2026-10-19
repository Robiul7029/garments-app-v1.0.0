import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useData } from '../context/DataContext';
import { useRole } from '../context/RoleContext';
import { useAuth } from '../context/AuthContext';
import { useErpData } from '../context/ErpDataContext';
import { usePermissions } from '../context/PermissionContext';
import { ACTION, MODULE } from '../config/erpRoles';
import { C } from '../config/erpSchema';
import { useHourlyErpMirror } from '../hooks/useHourlyErpMirror';
import { targetForProcess } from '../utils/calc';
import { downloadCSV } from '../utils/csv';
import SearchableSelect from './SearchableSelect';
import { ConfirmDialog } from './erp/Primitives';
import {
  COLLECTIONS,
  selectableOrders,
  findOrderByStyle,
  processNamesForStyle,
  operationsForStyle,
  latestSheetForStyle,
  withRecomputedTotals,
  colorOptionsFor,
  addColorOption,
  matchingColor,
  colorsOf,
  joinValues,
  splitValues,
} from '../config/orderWorkflow';
import {
  CAPACITY_COLLECTION,
  capacityForStyle,
  targetForOperation,
  autoTargetForOperation,
  completeBodyTarget,
  achievementVsTarget,
  STANDARD_DAY_HOURS,
} from '../config/smvTargetEngine';
import { targetBufferForStyle } from '../config/orderWorkflow';
import {
  DAY_MODE as DAY_SLOT,
  resolveSlots,
  toggleSlot,
  modeOf,
  pruneQty,
  slotLabel,
  isDayRow,
  // The unified entry model: four modes, the QC auto-calculation and the record
  // builders, all in one module so the form and the tests share one definition.
  ENTRY_MODES,
  DEFAULT_ENTRY_MODE,
  isOutputMode,
  modeNeedsEmployee,
  modeNeedsProcess,
  modeNeedsHours,
  slotsForMode,
  resolveEmployee,
  LINE_EMPLOYEE_LABEL,
  QC_COLLECTION,
  computeQcTotals,
  buildQcRecord,
  // The QC form's multi-select wiring: the option lists, the resolved values of a
  // re-opened row, and the add / canonical-spelling helpers. `defectTypeOptions` is
  // the dropdown's own list; `defectTypesInUse` is the same as plain names.
  defectTypeOptions,
  qcMultiValues,
  qcFaultProcessOptions,
  qcOrderColorOptions,
  addToList,
  matchingInList,
  asList,
} from '../config/hourlyEntryMode';
import {
  SHIFT_HOURS,
  LUNCH_START_HOUR,
  PRODUCTIVE_SHIFT_HOURS,
  productiveHours,
  overtimeHoursFrom,
  totalWorkingHours,
  dailyTargetFrom,
} from '../config/workingHours';
import {
  DIRECTORY_COLLECTION,
  supervisorNames,
} from '../config/employeeDirectory';
import { processSheetTargets, targetSourceNote } from '../config/lineOutputSheet';
import {
  monthlyCollectionFor,
  buildLineOutputRecord,
  lineOutputDailyRow,
} from '../config/monthlyLineOutput';

/**
 * ROBIUL GARMENTS ERP — Hourly Production.
 *
 * The hourly shift sheet: one row per employee/process, one column per hour of
 * the working day. Every hour box stays open all day, so a missed 10 o'clock
 * entry can still be recorded at 4.
 *
 * THE PROCESS DROPDOWN COMES FROM THE PROCESS SHEET
 * -------------------------------------------------
 * The operations offered are NOT a hard-coded list. They are read from the
 * `process-breakdown` collection the Process Sheet Upload module writes, for
 * whichever Style/Order is chosen — so the sheet a merchandiser uploaded is
 * exactly what a supervisor can pick here, with no second list to keep in step.
 * A style with no uploaded sheet yet falls back to free text so the form is
 * never blocked, and says so.
 *
 * DAILY TOTALS
 * ------------
 * Every hour of every row is summed per employee. The same figures are surfaced
 * here (a total per worker) and read by the Worker Production page — one
 * collection, two views, so the two can never disagree.
 *
 * MULTI-PROCESS, MULTI-HOUR, AND WHAT GETS STORED
 * ----------------------------------------------
 * One entry can cover SEVERAL processes across several hours. Rather than widen
 * the row shape (which the Worker Production page and the day's grid both read),
 * a multi-process entry is SPLIT on save into one row per process — each row
 * carrying only the hours that process actually ran. The stored shape is
 * therefore exactly what it always was — `{ date, employee, style, order_no,
 * process, hourlyTarget, hours: { 'HH': qty } }` — and every existing reader
 * keeps working without knowing multi-select exists. The day's hours, its OT and
 * its daily target ride along as ADDITIVE keys (`workingHours`, `overtime`,
 * `overtimeStart`, `dailyTarget`) so the Daily Production module can read the
 * same figures without recomputing them.
 *
 * THE PROCESS DROPDOWN CAN GROW
 * -----------------------------
 * The dropdown opens with a checkbox per process and an "Add Other Process" row
 * at its foot. A process typed there appears in the list immediately AND is
 * appended to the uploaded process sheet the whole app reads from, so Hourly
 * Production, Daily Production and Worker Production all offer it from then on.
 *
 * HOURS, AND WHY 13:00 IS WORTH HALF
 * ----------------------------------
 * The shift is 08:00 → 18:30 with an unpaid lunch break of 13:00 → 13:30, so work
 * resumes at 13:30. Ticking the 13:00 slot therefore contributes half an hour,
 * not a whole one, and a full day reads 10 productive hours (10.5 on the clock
 * less the lunch) — see `config/workingHours`. The manual Hourly Target the
 * supervisor types is multiplied by those active hours to give the Daily Target,
 * and the Due is the target less what was achieved, recomputed on every keystroke.
 *
 * ACTIVE HOURS IS A DROPDOWN, LIKE PROCESS
 * ----------------------------------------
 * The hours are chosen from a searchable checkbox dropdown of the same shape as
 * the Process one. Its "Others Time..." footer adds a slot the fixed list does
 * not carry (19:00-20:00, say) and it appears in both the dropdown and the
 * quantity grid at once.
 *
 * THE TABLE GROUPS BY EMPLOYEE AND CARRIES ACTIONS
 * -------------------------------------------------
 * A person who ran several processes has one row per process in storage, so the
 * table renders them as a GROUP: the name is written once in a cell whose
 * `rowSpan` covers that person's rows, and each row keeps its own Edit / Delete
 * buttons. Edit loads the row back into the form and Save writes it in place
 * rather than appending a second copy.
 */
// The shift slots live in config/workingHours so the lunch break and the daily
// target are defined in one place rather than copied per screen.
const HOURS = SHIFT_HOURS;

/**
 * The sentinel slot that means "the whole day, logged as one figure".
 *
 * It is not a clock hour and must never be treated as one: the quantity grid and
 * the day's productive hours both branch on it. The mode rules themselves live in
 * `config/hourlyEntryMode`, so the form and its tests share one definition rather
 * than each spelling the sentinel out.
 */
const DAY_MODE = DAY_SLOT;

/**
 * The hour label, shared by the selector and the quantity grid.
 *
 * A plain clock key ('08') reads as '08:00'. A written slot added from the
 * dropdown's "Others Time..." box is already a label ('18:30-19:30') and is shown
 * as typed, so a custom slot never gets a ':' glued onto the end of it.
 */
const hourLabel = slotLabel;

/** The date key for the day being recorded, defaulting to today. */
const todayKey = () => new Date().toISOString().slice(0, 10);

/**
 * Sum one row's hours into a single figure.
 *
 * Every key on `row.hours` is summed, not just the fixed shift slots, because a
 * day may include a slot added from "Others Time..." and that output belongs in
 * the day's total like any other.
 */
function rowTotal(row) {
  return Object.values(row?.hours || {}).reduce((sum, v) => sum + (Number(v) || 0), 0);
}

/** The same sum for a form's per-hour boxes, without knowing the hour slots. */
function hoursTotal(hours) {
  return Object.values(hours || {}).reduce((sum, v) => sum + (Number(v) || 0), 0);
}

/**
 * The QC multi-value fields of a stored row, resolved for the form.
 *
 * `qcMultiValues` reads BOTH the list (`row.processes`) and the joined string
 * (`row.process`), so a check written before these fields were multi-value comes back
 * with its single process, colour and defect type still selected rather than blank.
 *
 * `defect_type` is also set, because that is the key the form's own state carries for
 * the single-value readers that already exist.
 */
function qcValuesFromRow(row = {}) {
  const values = qcMultiValues(row);
  return {
    qc_processes: values.processes,
    qc_colors: values.colors,
    qc_defect_types: values.defectTypes,
    defect_type: row.defect_type || '',
  };
}

/**
 * The process options a QC check offers, for one order's process sheet.
 *
 * The brief: strictly the order's INPUT and OUTPUT processes, which is what
 * `qcFaultProcessOptions` resolves from the sheet. `latestSheetForStyle` finds the
 * sheet so the component does not have to know which one applies.
 */
function qcProcessOptionList(processSheets, order, chosen) {
  const sheet = latestSheetForStyle(processSheets, order);
  return qcFaultProcessOptions(sheet, chosen);
}

export default function HourlyTimesheet({
  defaultOpen = false,
  defaultMode,
  // When the module hosts this form (Daily Production's Hourly tab), the header's
  // "+ New Entry" button owns the action, so this component hides its own copy of
  // the button rather than showing two. The standalone Hourly Production menu item
  // keeps its own, because nothing above it hosts the action.
  hideHeaderActions = false,
  // Called once with a handle ({ openNewEntry }) so a host can open this form from
  // its own header without the form's state leaving this component.
  onReady,
  // Called after a NEW entry is written (not an edit), with the saved row. The Daily
  // Production module uses it to close the form and switch to the Overall Summary tab,
  // so the day's figures are on screen the moment the supervisor saves — the brief's
  // "display the updated live breakdown immediately". A standalone Hourly Production
  // render passes nothing and behaves exactly as before.
  onSaved,
} = {}) {
  const { getData, addEntry, deleteEntry, updateEntry, setRaw } = useData();
  const { isAdmin } = useRole();
  // The ERP side, for the QC dual-write below. Read through the hooks so a screen
  // rendered outside the ERP providers (a test, or the /login route) still works:
  // `useErpData` returns an inert stub there rather than throwing.
  const erp = useErpData();
  const permissions = usePermissions();
  // The actor recorded on a line entry. Read straight from the auth session rather
  // than through `useRole`, which reports the ROLE and not the person.
  const { user } = useAuth() || {};

  const rows = getData('hourly-timesheet-rows');
  const employees = getData('employees');
  const orders = getData(COLLECTIONS.ORDERS);
  const processSheets = getData(COLLECTIONS.PROCESS_SHEETS);
  const capacityRecords = getData(CAPACITY_COLLECTION);
  // Manpower Management → Line Deployment. The Total Line Output mode offers the
  // supervisors from here, and nobody else — see `supervisorNames`.
  const directory = getData(DIRECTORY_COLLECTION);

  // `defaultOpen` / `defaultMode` exist so a test can render the form — and a
  // particular mode — without driving a click, which a static render cannot do.
  // The running app never passes them, so the form still opens closed on Hourly.
  const [showForm, setShowForm] = useState(defaultOpen);
  // When non-null, the form is EDITING that row rather than adding a new one. The
  // row's id is kept so `submit` can update in place instead of appending, which
  // is what the table's Edit button needs.
  const [editingId, setEditingId] = useState(null);
  const [notice, setNotice] = useState('');
  // Field-by-field validation: which single field is currently flagged, and the
  // tooltip to show directly under it. There is deliberately no form-level error
  // banner — an invalid submit points at ONE field, the next one in order.
  const [fieldError, setFieldError] = useState({ field: '', message: '' });
  // The form fields, so a flagged one can be focused rather than merely outlined.
  const employeeRef = useRef(null);
  const processRef = useRef(null);
  const hoursRef = useRef(null);
  // The Order No control, so a line entry with no order can be focused on the field
  // that needs fixing rather than leaving the reader to find it.
  const orderRef = useRef(null);
  const [entry, setEntry] = useState({
    date: todayKey(),
    employee: '',
    style: '',
    order_no: '',
    // WHICH KIND OF ENTRY THIS IS. The four modes share one form; this key decides
    // which fields are shown and which record is written. `hourly` is the default.
    entryMode: defaultMode || DEFAULT_ENTRY_MODE,
    // SEVERAL processes may run in one entry now, so this is a list.
    processes: [],
    // Which hours are being recorded — chosen, not always the whole day. In DAY
    // mode this holds the single DAY_MODE sentinel instead of clock hours.
    selectedHours: [],
    // 'hourly' or 'day'. The Active Hours / Day control sets this; the quantity
    // grid branches on it, so the two modes never render at once.
    mode: 'hourly',
    // qty[process][hour] — one box per chosen process per chosen hour. In DAY mode
    // the key is DAY_MODE, so a whole-day figure lives in exactly the same shape
    // and every reader (the day total, the CSV, the stored row) is unchanged.
    qty: {},
    // The MANUAL hourly target the day is measured against. Typed by the
    // supervisor; when left blank the sheet's SMV-derived figure is used instead
    // (see `effectiveHourlyTarget`). One figure for the entry, because the brief
    // asks for a single box the supervisor types into.
    hourlyTarget: '',
    // Overtime, logged by the time it started ('19:00').
    overtimeStart: '',
    // The overtime actually committed with the Add button, so typing a time does
    // not move the day's hours until the supervisor confirms it.
    overtimeAdded: '',
    // ---- Total Line Output ----
    // The only figure a line entry asks for: what the line actually made. Its
    // targets are filled in from the order's Process Sheet (see `lineTargets`).
    achievement: '',
    // The colours the day's output covered. OPTIONAL, and a LIST because one line may
    // run several colours in a shift. Stored as a comma-separated string on the record
    // (see `buildLineOutputRecord`), which is the shape every existing reader prints.
    colors: [],
    // The supervisor who ran the line — the "Employee" field, relabelled in this
    // mode. Kept on the entry so the saved record still names the line it covered;
    // the Line dropdown that used to set it is gone from the form, and the Daily
    // Target box stands where it was.
    line_no: '',
    supervisor: '',
    // ---- QC Product Check ----
    // Only shown in the `qc` mode. `total_checked` is DERIVED (ok + alter +
    // defect), never typed — see `computeQcTotals`.
    ok_pcs: '',
    alter_pcs: '',
    defect_pcs: '',
    // A check may name SEVERAL processes, colours and defect types — a line running
    // three colours can produce a skip stitch on two of them at once — so each is a
    // LIST. Stored as the comma-separated string every existing QC reader prints; see
    // `buildQcRecord`. All three are OPTIONAL.
    qc_processes: [],
    qc_colors: [],
    qc_defect_types: [],
    // Retained under their original names so a row re-opened from storage, and the
    // single-value readers that already exist, still find what they expect.
    defect_type: '',
  });

  // Processes added on the fly through the dropdown's "Add Other Process" box.
  // Held in state so they appear in the list immediately; they are appended to the
  // shared process sheet the moment they are added, so every other screen sees
  // them too (see `addOtherProcess`).
  const [addedProcesses, setAddedProcesses] = useState([]);
  // Custom/overtime time slots added through the Active Hours dropdown's
  // "Others Time..." box. Each is a written slot label ('18:30-19:30'); it joins
  // the hour list and its quantities are stored under that label, exactly as a
  // standard clock hour is. Held in state so it appears in the list at once.
  const [addedHourSlots, setAddedHourSlots] = useState([]);
  // Colours created by hand on the Color dropdown's "+ Add" row. Held in state so a
  // colour appears in the list the instant it is added, without waiting for a write to
  // round-trip — the same pattern as the process dropdown's added list.
  const [addedColors, setAddedColors] = useState([]);
  // Defect types created by hand on the QC Defect Type dropdown's "+ Add" row. Held in
  // state for the same reason: the reason appears in the list at once.
  const [addedDefectTypes, setAddedDefectTypes] = useState([]);
  // Only one day is shown at a time; the totals below are for that day.
  const [viewDate, setViewDate] = useState(todayKey());

  /**
   * The INLINE row editor for the day's table.
   *
   * The table's hour boxes used to be live at all times, writing to storage on
   * every keystroke — so merely reading the sheet could change it, and a stray key
   * on a scrolled table silently rewrote somebody's output. Now a row is READ-ONLY
   * until its Edit button is pressed:
   *
   *   editingRowId   the id of the row currently open for inline editing (null = none)
   *   draftHours     that row's hours as a LOCAL copy, typed into without touching
   *                  the store, so Cancel is a true discard and Save is one write
   *
   * Only ONE row is editable at a time: two half-edited rows on screen is how a
   * supervisor saves the wrong one. Starting a new edit commits nothing and simply
   * moves the editor, so the previous row reverts to its stored values.
   */
  const [editingRowId, setEditingRowId] = useState(null);
  const [draftHours, setDraftHours] = useState({});
  // A row's inline save can fail validation (a non-numeric box, say), so the same
  // single-field error pattern the form uses is surfaced here too.
  const [rowError, setRowError] = useState('');
  // The id of the row the delete confirmation is asking about (null = no dialog).
  // The row itself is NOT removed until the dialog's YES is clicked.
  const [pendingDelete, setPendingDelete] = useState(null);

  // ---- Total Line Output wiring -----------------------------------------------

  const lineMode = (entry.entryMode || DEFAULT_ENTRY_MODE) === 'line';

  /**
   * The supervisors the Total Line Output mode offers.
   *
   * Filtered STRICTLY on the designation, from the same Line Deployment roster every
   * other dropdown reads: an operator is never offered here, because the field asks
   * who was in charge of the line, not who worked on it.
   */
  const supervisorOptions = useMemo(
    () => supervisorNames(directory, employees).map((name) => ({ value: name, label: name })),
    [directory, employees],
  );

  // ---- Order / process wiring ------------------------------------------------

  /**
   * The Order No options, read from the saved Order Input records.
   *
   * The value IS the order number, so typing a digit filters the list directly.
   * The style rides along as the hint (and on the option), because the process
   * sheet is looked up by style — the supervisor picks an order, and the
   * processes that order's sheet defines follow from it.
   *
   * The FIRST entry is the explicit "Select Order No" reset option, with an empty
   * value and a NULL order. It is how a picked order is UN-picked: choosing it
   * clears the order (and, via `selectOrder`, the dependent Process and Color
   * fields) instead of leaving the user with no way back to "no order".
   */
  const orderOptions = useMemo(
    () => [
      { value: '', label: 'Select Order No', hint: '', order: null, isClear: true },
      ...selectableOrders(orders)
        .filter((o) => o.order_no || o.orderNo)
        .map((o) => ({
          value: o.order_no || o.orderNo,
          label: o.order_no || o.orderNo,
          hint: [o.style, o.buyer, o.qty ? `${o.qty} pcs` : ''].filter(Boolean).join(' · '),
          order: o,
        })),
    ],
    [orders],
  );

  const currentOrder = useMemo(
    () => findOrderByStyle(orders, entry.order_no) || {},
    [orders, entry.order_no],
  );

  /**
   * The targets the chosen order's Process Sheet states, for a Total Line Output
   * entry.
   *
   * Derived rather than stored in state, so the boxes follow the order the moment it
   * is picked — and follow a re-uploaded sheet — with no "load targets" button and
   * no stale copy to reconcile.
   */
  const lineTargets = useMemo(
    () => (lineMode
      ? processSheetTargets(processSheets, {
        style: entry.style || currentOrder.style,
        order_no: entry.order_no || currentOrder.order_no,
      }, capacityRecords)
      : null),
    [lineMode, processSheets, capacityRecords, entry.style, entry.order_no, currentOrder.style, currentOrder.order_no],
  );

  /**
   * The colours the Color dropdown offers.
   *
   * The SELECTED ORDER's own assigned colours come first — those are the ones the
   * entry is actually about — followed by any colour added by hand on an earlier
   * entry, then the standard suggestions. See `colorOptionsFor` for the precedence
   * and the de-duplication.
   *
   * The options follow the ORDER, so picking a different order immediately offers that
   * order's colours instead of the previous one's. A colour already CHOSEN is kept
   * selectable even when the order changes, or the chips would point at values the
   * list no longer carries.
   *
   * With NO order selected, NO order-specific colour is offered: passing `null` here
   * (rather than the empty `currentOrder` object) is what stops an order's colours
   * leaking into a form that has not chosen one. The colours added by hand and the
   * standard suggestions remain, because a supervisor must be able to record a colour
   * by typing it before — or without — picking an order. Once an order IS picked, its
   * assigned colours are auto-mapped to the top of this same list.
   */
  // Whether an order is chosen, read straight from the entry so this memo does not
  // depend on `orderSelected` (declared further down, with the QC option lists).
  const hasOrderNo = Boolean(String(entry.order_no || '').trim());
  const colorOptions = useMemo(() => {
    // No order → strictly no pre-loaded colour (the custom "+ Add" row fills the list).
    // Order picked → that order's assigned colours, auto-mapped, then hand-added ones,
    // then the standard suggestions as a convenience.
    const options = hasOrderNo
      ? colorOptionsFor(currentOrder, addedColors)
      : colorOptionsFor(null, addedColors);
    const seen = new Set(options.map((o) => o.value.toLowerCase()));
    // A chosen colour the new order does not carry is kept, flagged as such, so a chip
    // is never orphaned by switching orders mid-entry.
    (Array.isArray(entry.colors) ? entry.colors : []).forEach((c) => {
      const clean = String(c || '').trim();
      if (!clean || seen.has(clean.toLowerCase())) return;
      seen.add(clean.toLowerCase());
      options.push({ value: clean, label: clean, hint: 'Selected' });
    });
    return options;
  }, [hasOrderNo, currentOrder, addedColors, entry.colors]);

  /**
   * Every operation on the chosen order's uploaded process sheet, followed by any
   * "other" process the supervisor typed into the dropdown.
   *
   * A process added here is appended to the sheet itself (see `addOtherProcess`),
   * so `processesForStyle` usually already carries it on the next render — the
   * local `addedProcesses` list is what makes it appear INSTANTLY, before the
   * write has round-tripped through storage.
   */
  const processOptions = useMemo(() => {
    const fromSheet = processNamesForStyle(processSheets, {
      style: entry.style || currentOrder.style,
      order_no: entry.order_no || currentOrder.order_no,
    });
    const seen = new Set(fromSheet.map((n) => n.toLowerCase()));
    const extras = addedProcesses.filter((n) => !seen.has(String(n).toLowerCase()));
    return [...fromSheet, ...extras].map((name) => ({ value: name, label: name }));
  }, [
    processSheets, entry.style, entry.order_no, currentOrder.style, currentOrder.order_no,
    addedProcesses,
  ]);

  /** The operations on the sheet, for the derived hourly target on each chosen one. */
  const currentOperations = useMemo(
    () => operationsForStyle(processSheets, {
      style: entry.style || currentOrder.style,
      order_no: entry.order_no || currentOrder.order_no,
    }),
    [processSheets, entry.style, entry.order_no, currentOrder.style, currentOrder.order_no],
  );

  const currentCapacity = useMemo(
    () => capacityForStyle(capacityRecords, {
      style: entry.style || currentOrder.style,
      order_no: entry.order_no || currentOrder.order_no,
    }),
    [capacityRecords, entry.style, entry.order_no, currentOrder.style, currentOrder.order_no],
  );

  /**
   * The percentage buffer agreed for this style.
   *
   * Read from the style's saved capacity first (the figure the Process Sheet
   * module writes when "Save targets for this style" is pressed), then from the
   * uploaded sheet itself, so a style whose sheet carries a buffer but whose
   * capacity has not been saved yet still gets the right percentage.
   */
  const targetBuffer = useMemo(() => {
    if (Number(currentCapacity?.targetBuffer) > 0) return Number(currentCapacity.targetBuffer);
    return targetBufferForStyle(processSheets, {
      style: entry.style || currentOrder.style,
      order_no: entry.order_no || currentOrder.order_no,
    });
  }, [
    currentCapacity, processSheets, entry.style, entry.order_no,
    currentOrder.style, currentOrder.order_no,
  ]);

  /**
   * The AUTO target for one process, from its SMV and the buffer — the brief's
   * formula, run through the shared engine so it cannot drift:
   *
   *   Base Hourly Capacity = 60 / SMV
   *   Auto Hourly Target   = Base Hourly Capacity × (1 + Buffer% / 100)
   *   Auto Daily Target    = Auto Hourly Target × 10
   */
  function autoTargetFor(processName) {
    return autoTargetForOperation({
      operations: currentOperations,
      settings: { ...(currentCapacity || {}), targetBuffer },
      operationName: processName,
      bufferPercent: targetBuffer,
    });
  }

  /**
   * The percentage-adjusted Complete Body Target for the chosen style.
   *
   * Shown alongside the per-process targets so the entry states both what each
   * operation is measured against AND what the whole garment needs — the same
   * figure the Process Sheet, Daily Production and Operator Performance screens
   * show, derived from the same sheet and the same buffer.
   */
  const bodyTarget = useMemo(
    () => completeBodyTarget(currentOperations, { ...(currentCapacity || {}), targetBuffer }),
    [currentOperations, currentCapacity, targetBuffer],
  );

  /**
   * True when the whole day is being logged as one figure.
   *
   * Read from the entry's own mode, and cross-checked against the sentinel slot so
   * the two can never disagree: if `selectedHours` holds DAY_MODE the form is in
   * day mode whatever the flag says, because that is what the stored shape means.
   */
  const dayMode = entry.mode === 'day' || entry.selectedHours.includes(DAY_MODE);

  // ---- The unified entry mode -------------------------------------------------
  // `entryMode` is the supervisor's choice at the top of the form. `dayMode` above
  // is the DERIVED hourly-vs-day distinction the aggregators already read; the two
  // are kept separate because a Total Line Output entry is also a whole-day figure
  // (dayMode true) but is its own mode with its own rules.
  const entryMode = entry.entryMode || DEFAULT_ENTRY_MODE;
  const outputMode = isOutputMode(entryMode);
  const qcMode = entryMode === 'qc';
  const needsEmployee = modeNeedsEmployee(entryMode);
  const needsProcess = modeNeedsProcess(entryMode);
  const needsHours = modeNeedsHours(entryMode);
  // Overtime is entered in the "Active Hours / Day" dropdown's "Overtime Start
  // Time..." field, so there is no separate overtime box to guard here. The
  // config predicate `showsOvertimeSection` stays in the config module (unused by
  // this screen) so the standalone box can be restored without rebuilding it.
  // The QC figures, with the brief's Total Checked = OK + Alter + Defect applied.
  const qcTotals = computeQcTotals({
    okPcs: entry.ok_pcs,
    alterPcs: entry.alter_pcs,
    defectPcs: entry.defect_pcs,
  });

  /**
   * Whether an Order No has been chosen.
   *
   * The gate the brief asks for: Process and Color are populated FROM the order, so
   * until one is picked there is nothing to populate them with. Both are therefore
   * LOCKED with the placeholder "Select Order No first" rather than opening on an
   * empty list — an empty dropdown reads as "this order has no processes", which is a
   * different and misleading statement.
   *
   * Declared BEFORE the two option memos below, which branch on it.
   */
  const orderSelected = Boolean(String(entry.order_no || '').trim());

  /**
   * The processes a QC check offers.
   *
   * EMPTY before an order is chosen: no sheet process is pre-loaded, because the sheet
   * is looked up BY the order. What the list carries then is only what the user put
   * there — the processes added by hand (`addedProcesses`) and the ones already chosen
   * on this check — so the inline "Type custom process..." + "+ Add" row is the way to
   * fill it. This mirrors the Color field beside it exactly.
   *
   * Once an order IS selected, that order's input and output processes from its Process
   * Sheet (`qcFaultProcessOptions`) are auto-mapped in, alongside the hand-added ones,
   * and the "+ Add" row stays accessible below.
   */
  const qcProcesses = useMemo(() => {
    const options = orderSelected
      ? qcProcessOptionList(processSheets, {
        style: entry.style || currentOrder.style,
        order_no: entry.order_no || currentOrder.order_no,
      }, entry.qc_processes)
      : [];
    const seen = new Set(options.map((o) => o.value.toLowerCase()));
    const add = (name, hint) => {
      const clean = String(name || '').trim();
      if (!clean || seen.has(clean.toLowerCase())) return;
      seen.add(clean.toLowerCase());
      options.push({ value: clean, label: clean, hint });
    };
    addedProcesses.forEach((p) => add(p, 'Added by you'));
    asList(entry.qc_processes).forEach((p) => add(p, 'Selected'));
    return options;
  }, [
    orderSelected, processSheets, entry.style, entry.order_no, currentOrder.style,
    currentOrder.order_no, entry.qc_processes, addedProcesses,
  ]);

  /**
   * The colours a QC check offers.
   *
   * EMPTY before an order is chosen: no colour is pre-loaded, because the assigned
   * colours belong to the order, not to the factory. Only what the user put there —
   * colours added by hand and the ones already chosen on this check — is listed, and
   * the inline "Type custom color..." + "+ Add" row stays fully usable.
   *
   * Once an order IS selected, the colours assigned to it in Order Management are
   * auto-mapped into this same list, with the "+ Add" row still below them.
   */
  const qcColors = useMemo(() => {
    const options = qcOrderColorOptions(orderSelected ? currentOrder : null, entry.qc_colors);
    // Hand-added colours ride along, flagged as such, exactly as on the Total Line
    // Output field so the two lists cannot disagree.
    splitValues(addedColors).forEach((c) => {
      const clean = String(c || '').trim();
      if (!clean || options.some((o) => o.value.toLowerCase() === clean.toLowerCase())) return;
      options.push({ value: clean, label: clean, hint: 'Added by you' });
    });
    return options;
  }, [orderSelected, currentOrder, entry.qc_colors, addedColors]);

  /**
   * The defect types a QC check offers: the standard list, anything added by hand on an
   * earlier check, and anything already chosen on this one.
   */
  const qcDefectTypes = useMemo(
    () => defectTypeOptions(addedDefectTypes, entry.qc_defect_types),
    [addedDefectTypes, entry.qc_defect_types],
  );

  /**
   * The "processes" the quantity grid renders a box for.
   *
   * Hourly and Daily list the chosen operations. A Total Line Output entry may
   * have NO process (the figure belongs to the line), so it renders ONE box under
   * the line label — which is also the key the row is stored under, so the figure
   * lands in the reports under a recognisable name rather than a blank.
   */
  const quantityProcesses = entryMode === 'line'
    ? (entry.processes.length > 0 ? entry.processes : [LINE_EMPLOYEE_LABEL])
    : entry.processes;

  /**
   * The hourly target the entry is measured against.
   *
   * A figure typed into the manual Hourly Target box ALWAYS wins — that is the
   * brief's "manual hourly target input". Only when it is left blank does the
   * sheet's SMV-derived target (run through the order's saved capacity, the same
   * engine Daily Production uses) stand in, falling back to the standard
   * per-process target from the config so the figure is never blank.
   */
  function hourlyTargetFor(processName) {
    const manual = Number(entry.hourlyTarget);
    if (Number.isFinite(manual) && manual > 0) return manual;
    // The AUTO target: Base Hourly Capacity × (1 + Buffer%), from the sheet's SMV.
    // This is the figure the brief asks to be filled in the moment a process is
    // chosen, and it is what makes the buffer apply to the day's target too.
    const auto = autoTargetFor(processName);
    if (auto.hasSmv && auto.hourlyTarget > 0) return auto.hourlyTarget;
    const derived = targetForOperation({
      operations: currentOperations,
      settings: currentCapacity || {},
      operationName: processName,
    });
    if (derived.hasSmv && derived.hourlyTarget > 0) return derived.hourlyTarget;
    const perHour = targetForProcess(processName);
    return perHour > 0 ? perHour : 0;
  }

  /**
   * The day's productive hours: the chosen clock hours, minus the lunch half-hour
   * on the 13:00 slot, plus any overtime committed for the day.
   *
   * Counting the 08:00 → 18:00 span as ten full hours would overstate the day by
   * 5%, which is why this runs everything through `workingHours` rather than the
   * raw number of ticked boxes.
   */
  const workedHours = useMemo(
    () => (entryMode === 'line'
      // A line entry records a day's output against a day's target; its hours are
      // the standard shift, since it books no clock slots of its own.
      ? PRODUCTIVE_SHIFT_HOURS
      : dayMode
      // A whole-day entry is the standard productive shift, plus any overtime
      // committed. There are no ticked clock hours to count, so the shift length
      // stands in for them — which is the same ten hours the hourly slots add up
      // to, so the two modes produce the same daily target.
      ? Math.round((PRODUCTIVE_SHIFT_HOURS + overtimeHoursFrom(entry.overtimeAdded || entry.overtimeStart)) * 100) / 100
      : totalWorkingHours(entry.selectedHours, entry.overtimeAdded || entry.overtimeStart)),
    [entryMode, dayMode, entry.selectedHours, entry.overtimeAdded, entry.overtimeStart],
  );

  /** Productive hours alone (no OT), for the per-process target figures. */
  const productiveSelectedHours = useMemo(
    () => (dayMode || entryMode === 'line' ? PRODUCTIVE_SHIFT_HOURS : productiveHours(entry.selectedHours)),
    [dayMode, entryMode, entry.selectedHours],
  );

  /**
   * The options the Active Hours dropdown offers.
   *
   * The standard shift slots first — each labelled with its clock hour, with the
   * 13:00 slot marked as the half-hour lunch break — followed by any slot added
   * through the dropdown's "Overtime Start Time..." field. The value is the stored
   * slot key, so everything downstream (the quantity grid, the day total, the CSV)
   * just reads it like any other hour.
   */
  const hourOptions = useMemo(() => {
    const standard = HOURS.map((h) => ({
      value: h,
      label: hourLabel(h),
      hint: Number(h) === LUNCH_START_HOUR ? 'lunch −0.5h' : '',
    }));
    const extra = addedHourSlots.map((label) => ({ value: label, label, hint: 'Overtime' }));
    // The Day slot sits FIRST, because it is the coarser choice and the one a
    // supervisor reaches for when they only have the day's total: pick it and the
    // hourly boxes are replaced by a single Full Day Output box.
    const day = [{
      value: DAY_MODE,
      label: 'Day',
      hint: `whole day · ${PRODUCTIVE_SHIFT_HOURS}h`,
    }];
    return [...day, ...standard, ...extra];
  }, [addedHourSlots]);

  /**
   * Target vs achievement, per chosen process and in total.
   *
   * The target is `hourlyTarget × productive hours` and the achievement is what
   * has been typed in; the difference is the "Due", which is the figure the brief
   * asks to see while entering. The DAILY TARGET is the hourly target multiplied by
   * the day's active hours (lunch excluded, OT included), so the hourly and daily
   * modules read the same figure. Everything recomputes on every keystroke because
   * it is derived from `entry.qty` rather than stored.
   *
   * The achievement sums every chosen slot, so output booked against a slot added
   * from "Others Time..." counts toward the target exactly like a shift hour. In
   * DAY mode the only "slot" is the DAY_MODE sentinel, so the whole-day figure is
   * read from the same place and the same arithmetic applies — the target is still
   * the hourly rate over the day's hours.
   */
  const targetSummary = useMemo(() => {
    // A line entry's targets are the order's, not a rate the form derives: the
    // Process Sheet already states them and the supervisor never types one.
    if (lineMode) {
      const hourlyTarget = lineTargets?.hourlyTarget || 0;
      const dailyTarget = lineTargets?.dailyTarget || 0;
      const achieved = Number(entry.achievement) || 0;
      return {
        perProcess: [],
        hourlyTarget,
        workedHours,
        dailyTarget,
        target: dailyTarget,
        ...achievementVsTarget(achieved, dailyTarget),
      };
    }
    const perProcess = entry.processes.map((process) => {
      const hourlyTarget = hourlyTargetFor(process);
      const target = hourlyTarget * productiveSelectedHours;
      const achieved = entry.selectedHours.reduce(
        (sum, h) => sum + (Number(entry.qty?.[process]?.[h]) || 0),
        0,
      );
      return {
        process,
        hourlyTarget,
        hoursCount: productiveSelectedHours,
        target,
        ...achievementVsTarget(achieved, target),
      };
    });
    const achieved = perProcess.reduce((sum, p) => sum + p.achieved, 0);
    const target = perProcess.reduce((sum, p) => sum + p.target, 0);
    // The day's target: the entry's hourly target over the day's active hours.
    // Falls back to the summed per-process targets when no hourly figure is set,
    // so the two modules still agree on a day the sheet alone describes.
    const entryHourly = hourlyTargetFor(entry.processes[0]);
    const dailyTarget = entryHourly > 0
      ? dailyTargetFrom(entryHourly, workedHours)
      : target;
    return {
      perProcess,
      hourlyTarget: entryHourly,
      workedHours,
      dailyTarget,
      ...achievementVsTarget(achieved, target),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    entry.processes, entry.selectedHours, entry.qty, entry.hourlyTarget,
    entry.overtimeAdded, entry.overtimeStart, productiveSelectedHours, workedHours,
    currentOperations, currentCapacity, dayMode,
    lineMode, lineTargets, entry.achievement,
  ]);

  /**
   * Picks the order, and drops any process/quantity the new order's sheet lacks.
   *
   * A QC check's Process and Color selections are dropped too, because both lists
   * belong to the order being left: keeping a colour the new order does not carry would
   * record a fault against a garment that was never made in it. The check's own figures
   * and defect reasons are untouched — those are properties of the garment, not of the
   * order.
   *
   * RESET: the dropdown's first entry is "Select Order No" with an empty value. Choosing
   * it is the explicit way to CLEAR the order — the order, its style, the processes it
   * supplied and the dependent Colour selections all go back to empty, so the form is in
   * the same clean state it was before an order was ever picked. The Color field keeps
   * working afterwards: the custom "Type custom color..." + "+ Add" row is still there,
   * it simply no longer pre-populates the cleared order's colours.
   */
  function selectOrder(orderNo) {
    const cleanOrderNo = String(orderNo || '').trim();
    // No order: an explicit RESET. Everything derived from the order is cleared.
    if (!cleanOrderNo) {
      setEntry((prev) => ({
        ...prev,
        order_no: '',
        style: '',
        processes: [],
        qty: {},
        hourlyTarget: '',
        colors: [],
        qc_processes: [],
        qc_colors: [],
      }));
      setFieldError((prev) => (prev.field === 'order_no' ? { field: '', message: '' } : prev));
      return;
    }

    const order = orderOptions.find((o) => String(o.value) === String(orderNo))?.order || {};
    const validOps = processNamesForStyle(processSheets, {
      style: order.style || '',
      order_no: order.order_no || orderNo || '',
    });
    setEntry((prev) => ({
      ...prev,
      order_no: cleanOrderNo,
      style: order.style || '',
      processes: prev.processes.filter((p) => validOps.includes(p)),
      // The order's colours are auto-mapped into the Color dropdown (see `colorOptions`).
      // A colour chosen against the PREVIOUS order is not carried over: it belongs to a
      // garment this entry is no longer about. Re-picking the SAME order keeps it, so a
      // colour the supervisor just chose is never silently discarded.
      ...(String(prev.order_no || '') === cleanOrderNo
        ? {}
        : { colors: [], qc_processes: [], qc_colors: [] }),
    }));
  }

  /** Adds/removes one process and keeps `qty` in step with the chosen list. */
  function setProcesses(next) {
    setEntry((prev) => {
      const qty = {};
      next.forEach((p) => { qty[p] = { ...(prev.qty?.[p] || {}) }; });
      // Auto-target on selection: the moment a process is chosen, its SMV is read
      // off the sheet and the hourly target box is filled with the auto figure —
      // Base Hourly Capacity (60/SMV) × (1 + buffer%). The box stays EDITABLE: a
      // figure the supervisor has typed by hand is never overwritten, which is what
      // the brief means by "auto-fill ... while leaving them editable".
      let hourlyTarget = prev.hourlyTarget;
      if (next.length > 0) {
        const auto = autoTargetFor(next[0]);
        if (auto.hasSmv && auto.hourlyTarget > 0) hourlyTarget = auto.hourlyTarget;
      } else {
        // Nothing selected: clear a figure that was only ever the auto one, so a
        // fresh process does not inherit the previous operation's target.
        hourlyTarget = '';
      }
      return { ...prev, processes: next, qty, hourlyTarget };
    });
  }

  /**
   * Adds a process the sheet does not carry, and writes it into the master sheet.
   *
   * Two things happen, in this order:
   *
   *   1. The name is put in `addedProcesses` so it appears in this dropdown on the
   *      very next render — the supervisor sees their process immediately, without
   *      waiting for a write to round-trip through storage.
   *   2. It is appended to the SAME uploaded process sheet the rest of the app
   *      reads, via `setRaw`, so Hourly Production, Daily Production and Worker
   *      Production all offer it from then on. That is what the brief means by
   *      syncing the global Process Sheet master list. `withRecomputedTotals`
   *      re-adds the sheet's SMV totals from its operations, so the added process
   *      (0 SMV until somebody sets it) cannot leave the sheet advertising a total
   *      its own rows do not add up to.
   *
   * A process with no sheet to attach to is still kept in state so the entry can
   * be recorded; it simply has no master list to join yet.
   */
  function addOtherProcess(name) {
    const clean = String(name || '').trim();
    if (!clean) return;
    const style = entry.style || currentOrder.style || '';
    const orderNo = entry.order_no || currentOrder.order_no || '';

    // The sheet this order reads from, so the process joins the right master list.
    const target = processSheets.find((s) => (
      (style && String(s.style || '') === String(style))
      || (orderNo && String(s.order_no || '') === String(orderNo))
    ));

    if (target) {
      const already = (target.operations || []).some(
        (o) => String(o?.operation || '').trim().toLowerCase() === clean.toLowerCase(),
      );
      if (!already) {
        const updated = withRecomputedTotals({
          ...target,
          operations: [...(target.operations || []), { operation: clean, machine: '', smv: 0, section: '' }],
        });
        setRaw(
          COLLECTIONS.PROCESS_SHEETS,
          processSheets.map((s) => (s.id === target.id ? updated : s)),
        );
      }
    }

    setAddedProcesses((prev) => (
      prev.some((p) => p.toLowerCase() === clean.toLowerCase()) ? prev : [...prev, clean]
    ));
    // Select it straight away: the supervisor added it because they meant to use it.
    setProcesses(entry.processes.includes(clean) ? entry.processes : [...entry.processes, clean]);
    setFieldError((prev) => (prev.field === 'process' ? { field: '', message: '' } : prev));
  }

  /**
   * Adds a colour the dropdown does not carry, from the Color field's "+ Add" row.
   *
   * Three things happen, and each is what the brief asks for:
   *
   *   1. The colour joins `addedColors`, so it is in the list on the very next render
   *      — the supervisor sees it immediately, without waiting for a write.
   *   2. It is SELECTED for this entry, because adding a colour is done to use it.
   *   3. It is PERSISTED for future use, onto the order the entry is booked to when
   *      there is one, so the next entry against that order offers it too; otherwise
   *      into the shared colour master list, so it survives even with no order picked.
   *
   * A colour already carried (in any casing) is not added a second time: the existing
   * spelling is selected instead, so the list keeps one entry per colour.
   */
  function addOtherColor(name) {
    const clean = String(name || '').trim().replace(/\s+/g, ' ');
    if (!clean) return;

    // The list's own spelling when the colour already exists, otherwise the typed one.
    const chosen = matchingColor(clean, colorOptions);

    // 1. Instant visibility + 2. select it for this entry.
    const nextAdded = addColorOption(addedColors, clean, colorOptions);
    if (nextAdded) setAddedColors(nextAdded);
    setEntry((prev) => {
      const current = Array.isArray(prev.colors) ? prev.colors : [];
      if (current.some((c) => String(c).toLowerCase() === chosen.toLowerCase())) return prev;
      return { ...prev, colors: [...current, chosen] };
    });

    // 3. Persist for future use. The order is preferred, because a colour belongs to
    // the garment; the shared master list is the fallback so a colour added before an
    // order is chosen is not lost.
    const orderNo = entry.order_no || currentOrder.order_no;
    if (orderNo) {
      const target = orders.find((o) => String(o.order_no || o.orderNo || '') === String(orderNo));
      if (target) {
        const existing = colorsOf(target);
        if (!existing.some((c) => c.toLowerCase() === chosen.toLowerCase())) {
          setRaw(
            COLLECTIONS.ORDERS,
            orders.map((o) => (o.id === target.id
              ? { ...o, color: joinValues([...existing, chosen]) }
              : o)),
          );
        }
      }
    }
    setFieldError((prev) => (prev.field === 'color' ? { field: '', message: '' } : prev));
  }

  /**
   * Adds a process the order's sheet does not carry, from the QC Process dropdown.
   *
   * A QC check is recorded by LINE, and the operation that caused a defect may not be
   * on the uploaded sheet at all — so this is the route for naming it. The value joins
   * the local list and is SELECTED straight away, because adding it was done to use it.
   *
   * Usable with or without an order: a process named before an order is picked stays in
   * `addedProcesses`, so it is still in the list (and still selected) once an order is
   * chosen and that order's own processes are auto-mapped in alongside it.
   *
   * Deliberately NOT appended to the process sheet master, unlike the output modes'
   * "Add Other Process": a QC check names where a FAULT was found, and writing that
   * into the sheet the targets are derived from would add a zero-SMV operation to every
   * operator's dropdown for the style.
   */
  function addQcProcess(name) {
    const clean = String(name || '').trim().replace(/\s+/g, ' ');
    if (!clean) return;
    const chosen = matchingInList(qcProcesses, clean);
    setAddedProcesses((prev) => (
      prev.some((p) => p.toLowerCase() === chosen.toLowerCase()) ? prev : [...prev, chosen]
    ));
    setEntry((prev) => {
      const current = asList(prev.qc_processes);
      if (current.some((p) => p.toLowerCase() === chosen.toLowerCase())) return prev;
      return { ...prev, qc_processes: [...current, chosen] };
    });
  }

  /**
   * Adds a colour the order does not carry, from the QC Color dropdown.
   *
   * The same three steps as the Total Line Output Color field: it joins the visible
   * list at once, is selected for this check, and is persisted onto the order so the
   * next entry against that order offers it. One colour list for both forms, so the two
   * can never disagree about what a garment's colours are.
   */
  function addQcColor(name) {
    const clean = String(name || '').trim().replace(/\s+/g, ' ');
    if (!clean) return;
    const chosen = matchingColor(clean, qcColors);

    const nextAdded = addColorOption(addedColors, clean, qcColors);
    if (nextAdded) setAddedColors(nextAdded);
    setEntry((prev) => {
      const current = asList(prev.qc_colors);
      if (current.some((c) => c.toLowerCase() === chosen.toLowerCase())) return prev;
      return { ...prev, qc_colors: [...current, chosen] };
    });

    const orderNo = entry.order_no || currentOrder.order_no;
    if (orderNo) {
      const target = orders.find((o) => String(o.order_no || o.orderNo || '') === String(orderNo));
      if (target) {
        const existing = colorsOf(target);
        if (!existing.some((c) => c.toLowerCase() === chosen.toLowerCase())) {
          setRaw(
            COLLECTIONS.ORDERS,
            orders.map((o) => (o.id === target.id
              ? { ...o, color: joinValues([...existing, chosen]) }
              : o)),
          );
        }
      }
    }
  }

  /**
   * Adds a defect reason the standard list does not name, from the QC Defect Type
   * dropdown's "+ Add" row.
   *
   * Held in `addedDefectTypes` so it appears in the list at once, and SELECTED for this
   * check. Unlike a colour it is not written onto the order: a defect reason is not an
   * attribute of the garment, and putting "Oil Spot" on the order record would follow
   * the style around as though it were part of its specification.
   */
  function addQcDefectType(name) {
    const clean = String(name || '').trim().replace(/\s+/g, ' ');
    if (!clean) return;
    const chosen = matchingInList(qcDefectTypes, clean);
    const next = addToList(addedDefectTypes, clean);
    if (next) setAddedDefectTypes(next);
    setEntry((prev) => {
      const current = asList(prev.qc_defect_types);
      if (current.some((d) => d.toLowerCase() === chosen.toLowerCase())) return prev;
      return { ...prev, qc_defect_types: [...current, chosen] };
    });
  }

  /**
   * Adds a custom clock slot from the Active Hours dropdown's "Overtime Start
   * Time..." field.
   *
   * The supervisor types a slot the fixed shift list does not carry — '19:00' for
   * a late run, say. It is trimmed and de-duplicated against both the standard
   * slots and the ones already added, then:
   *
   *   1. joins `addedHourSlots` so the dropdown offers it on the next render, and
   *   2. is SELECTED straight away, so its quantity box opens without a second
   *      click — the supervisor added it because they meant to book output against
   *      it.
   *
   * Anything unreadable is rejected rather than added as an unusable empty slot.
   */
  function addOtherTime(slot) {
    const clean = String(slot || '').trim();
    if (!clean) return;
    const known = [...HOURS, ...addedHourSlots];
    if (known.some((h) => String(h).toLowerCase() === clean.toLowerCase())) {
      // Already offered — select it rather than adding a duplicate.
      if (!entry.selectedHours.includes(clean)) toggleHour(clean);
      return;
    }
    setAddedHourSlots((prev) => [...prev, clean]);
    setEntry((prev) => ({
      ...prev,
      // Adding a clock slot is an hourly-mode act, so a day-mode entry switches
      // back to hourly and keeps only the new slot — the whole-day figure would
      // otherwise sit alongside an hour and be counted twice.
      mode: 'hourly',
      selectedHours: [clean],
      qty: pruneQty(prev.qty, prev.processes, [clean]),
    }));
    setFieldError((prev) => (prev.field === 'hours' ? { field: '', message: '' } : prev));
  }

  /**
   * Replaces the whole hour selection — the shape the Active Hours DROPDOWN
   * reports, since its checkboxes toggle the list as a set rather than one at a
   * time. `qty` is rebuilt to match, so a quantity box exists for exactly the hours
   * that are ticked and unticking an hour drops its output rather than orphaning it.
   */
  function setSelectedHours(next) {
    // The mode rules (Day is exclusive, switching drops the other mode's figures)
    // live in `config/hourlyEntryMode` so the form and its tests share one
    // definition rather than each re-implementing them.
    const { slots, mode } = resolveSlots(next);
    setEntry((prev) => ({
      ...prev,
      selectedHours: slots,
      mode,
      qty: pruneQty(prev.qty, prev.processes, slots),
    }));
  }

  /**
   * Adds/removes one active hour, and its boxes with it.
   *
   * A custom slot keeps its insertion order rather than being sorted, because
   * '18:30-19:30' has no meaningful place in a lexicographic sort of '08'…'18' and
   * would jump around the grid; the fixed clock hours stay in shift order.
   */
  function toggleHour(hour) {
    setEntry((prev) => {
      const slots = toggleSlot(prev.selectedHours, hour);
      return {
        ...prev,
        selectedHours: slots,
        mode: modeOf(slots),
        qty: pruneQty(prev.qty, prev.processes, slots),
      };
    });
  }

  /**
   * Switches between hourly and day logging.
   *
   * This is the mode toggle beside the slots. Selecting Day collapses the hourly
   * boxes into a single Full Day Output box; selecting Hourly restores the clock
   * slots. `qty` is rebuilt so a figure typed in one mode never silently carries
   * into the other — the supervisor re-enters it for the mode they chose.
   */
  function setDayMode(day) {
    setEntry((prev) => {
      const slots = day ? [DAY_MODE] : [];
      return {
        ...prev,
        mode: day ? 'day' : 'hourly',
        selectedHours: slots,
        qty: pruneQty(prev.qty, prev.processes, slots),
      };
    });
    setFieldError((prev) => (prev.field === 'hours' ? { field: '', message: '' } : prev));
  }

  /**
   * Switches the entry between the four modes.
   *
   * Each mode brings its own field set, so switching RESETS what the previous mode
   * had half-filled rather than letting an hourly figure silently become a day
   * total, or a QC figure become an output figure:
   *
   *   hourly  clock slots, employee + process required
   *   daily   one Full Day Output box, employee + process required
   *   line    one Full Day Output box, employee OPTIONAL (whole line)
   *   qc      OK / Alter / Defect boxes, no output at all
   *
   * The order/date/employee the supervisor already picked are KEPT — they describe
   * the day, not the mode — while the figures that belong to the old mode are
   * dropped, so nothing typed under one meaning is saved under another.
   */
  function setEntryMode(nextMode) {
    setEntry((prev) => {
      const slots = slotsForMode(nextMode);
      const isQc = nextMode === 'qc';
      return {
        ...prev,
        entryMode: nextMode,
        // The slot model the aggregators read: hourly keeps its clock hours, the
        // three whole-day modes use the DAY sentinel.
        selectedHours: slots,
        mode: nextMode === 'hourly' ? 'hourly' : 'day',
        // Output figures belong to the output modes; QC figures to the QC mode.
        qty: isQc ? {} : pruneQty(prev.qty, prev.processes, slots),
        processes: isQc ? [] : prev.processes,
        hourlyTarget: isQc ? '' : prev.hourlyTarget,
        overtimeStart: isQc ? '' : prev.overtimeStart,
        overtimeAdded: isQc ? '' : prev.overtimeAdded,
        // Only a Total Line Output entry carries an achievement; switching to
        // another mode drops it so it cannot be saved as someone's hourly output.
        achievement: nextMode === 'line' ? (prev.achievement ?? '') : '',
        line_no: prev.line_no || '',
        supervisor: prev.supervisor || '',
        ok_pcs: isQc ? (prev.ok_pcs ?? '') : '',
        alter_pcs: isQc ? (prev.alter_pcs ?? '') : '',
        defect_pcs: isQc ? (prev.defect_pcs ?? '') : '',
        defect_type: isQc ? (prev.defect_type ?? '') : '',
      };
    });
    setFieldError({ field: '', message: '' });
  }

  /** Types one process's quantity for one hour. */
  function setQty(process, hour, value) {
    setEntry((prev) => ({
      ...prev,
      qty: {
        ...prev.qty,
        [process]: { ...(prev.qty?.[process] || {}), [hour]: value === '' ? undefined : Number(value) },
      },
    }));
  }

  function reset() {
    setEntry({
      date: entry.date || todayKey(),
      employee: '',
      style: '',
      order_no: '',
      entryMode: entry.entryMode || DEFAULT_ENTRY_MODE,
      processes: [],
      selectedHours: [],
      mode: 'hourly',
      qty: {},
      hourlyTarget: '',
      overtimeStart: '',
      overtimeAdded: '',
      achievement: '',
      line_no: '',
      supervisor: '',
      ok_pcs: '',
      alter_pcs: '',
      defect_pcs: '',
      defect_type: '',
    });
    // Custom slots belong to the entry being abandoned, so a fresh entry opens
    // with just the standard shift hours again.
    setAddedHourSlots([]);
    setEditingId(null);
  }

  /**
   * Opens the entry form on a BLANK entry.
   *
   * This is the one action the header's "+ New Entry" button performs, whether it
   * is this component's own button or the Daily Production module's global one —
   * both call this, so the two can never open the form in different states.
   */
  function openNewEntry() {
    setFieldError({ field: '', message: '' });
    setEditingId(null);
    setShowForm(true);
  }

  /**
   * Hands the host a handle on this form's actions, when one asks for it.
   *
   * The Daily Production module hosts this component and puts "+ New Entry" in its
   * own header, so it needs a way to open the form without owning its state. The
   * handle is re-published whenever the callback changes — the module keeps it in a
   * ref, so this settles after the first render.
   */
  useEffect(() => {
    if (typeof onReady === 'function') onReady({ openNewEntry });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onReady]);

  /**
   * Loads one stored row into the form for editing.
   *
   * The row holds a SINGLE process (multi-process entries are split on save), so
   * it is put back as a one-item process list with that process's hours under it —
   * the same shape the form works in. The hours that were recorded become the
   * selected hours, so their boxes open exactly as they were filled.
   */
  function editRow(row) {
    const hours = { ...(row.hours || {}) };
    const process = row.process || '';
    const recordedHours = Object.keys(hours).filter((h) => hours[h] !== undefined && hours[h] !== '');
    // A row saved in DAY mode carries its whole-day figure under the DAY_MODE key,
    // so it re-opens in day mode with the Full Day Output box filled — not as a
    // clock slot, which would be a different record entirely.
    const wasDayMode = isDayRow(row);
    // A row with no recorded hours still opens with its process; fall back to the
    // full standard shift so there is always something to edit against.
    const selectedHours = wasDayMode
      ? [DAY_MODE]
      : (recordedHours.length > 0 ? recordedHours : [...HOURS]);
    setEntry({
      date: row.date || todayKey(),
      employee: row.employee || '',
      style: row.style || '',
      order_no: row.order_no || '',
      // Re-open in the mode the row was saved as. A row without an `entry_type`
      // predates the unified form, so it is inferred from the stored shape: a DAY
      // sentinel means Daily, otherwise Hourly.
      entryMode: row.entry_type || (wasDayMode ? 'daily' : 'hourly'),
      processes: process ? [process] : [],
      selectedHours,
      mode: wasDayMode ? 'day' : 'hourly',
      qty: process ? { [process]: hours } : {},
      hourlyTarget: row.hourlyTarget ?? '',
      overtimeStart: row.overtimeStart || '',
      overtimeAdded: row.overtimeStart || '',
      // A line entry re-opens with its achievement, its line and its supervisor,
      // read from the fields the monthly record stores.
      achievement: row.achievement ?? row.quantity ?? '',
      line_no: row.line_no || row.line || '',
      supervisor: row.supervisor || row.employee || '',
      // The colours re-open as a list, from the comma-separated string the record
      // stores, so the chips come back exactly as they were ticked.
      colors: splitValues(row.color ?? row.colors),
      ok_pcs: '',
      alter_pcs: '',
      defect_pcs: '',
      defect_type: '',
      // A QC check re-opens with its three multi-value fields restored from the record.
      // `qcMultiValues` reads BOTH the list and the joined string, so a row written
      // before these fields were multi-value comes back with its single value still
      // selected rather than blank.
      ...qcValuesFromRow(row),
    });
    // Any custom slot the row recorded that is not a standard shift hour is
    // re-offered in the Active Hours dropdown, so it can be re-ticked.
    const extraSlots = recordedHours.filter((h) => !HOURS.includes(h) && h !== DAY_MODE);
    setAddedHourSlots(extraSlots);
    setEditingId(row.id);
    setFieldError({ field: '', message: '' });
    setShowForm(true);
    setNotice(`Editing the ${row.date || ''} entry for ${row.employee || 'this row'}.`);
  }

  /**
   * Saves a Total Line Output entry.
   *
   * TWO WRITES, and each answers a different question:
   *
   *   1. The MONTH's own collection (`line-output-YYYY-MM`), which is the record the
   *      brief asks for: this line's output for this day, scoped to the active
   *      month so a month is one collection rather than a filter over all history.
   *   2. The day-level `daily-production` row the overall summary and the top KPI
   *      cards already aggregate, so the same entry is reflected there the moment it
   *      is saved — no polling, no second screen to refresh.
   *
   * The targets are COPIED onto the record, not referenced. A month that has been
   * closed must still read the same target a year later, even if the process sheet
   * is re-uploaded with a different SMV.
   */
  function saveLineEntry(date) {
    const record = buildLineOutputRecord({
      date,
      order_no: entry.order_no || '',
      style: entry.style || currentOrder.style || '',
      line_no: entry.line_no || '',
      supervisor: entry.supervisor || '',
      process: lineTargets?.process || '',
      achievement: entry.achievement,
      hourlyTarget: lineTargets?.hourlyTarget || 0,
      dailyTarget: lineTargets?.dailyTarget || 0,
      targetSource: lineTargets?.source || 'none',
      // The colours this day's output covered. OPTIONAL — an empty selection stores an
      // empty string rather than blocking the save.
      color: joinValues(entry.colors || []),
      actor: user?.username || user?.email || '',
    });

    // The month is taken from the ENTRY's date, not from today: a supervisor back-
    // filling last month's last day files it in last month's book, which is where a
    // month-end report looks for it.
    const collection = monthlyCollectionFor(record.date);
    if (!collection) {
      setFieldError({ field: 'line', message: 'Please choose a valid date for this entry.' });
      return;
    }

    const existing = getData(collection);
    // One row per order + line + day. Re-saving the same day's figure corrects it
    // instead of adding a second entry that the month would count twice.
    const rowKey = (r) => `${String(r.order_no || '').trim()}||${String(r.line_no || '').trim()}||${String(r.date || '').slice(0, 10)}`;
    const duplicate = existing.find((r) => r && rowKey(r) === rowKey(record));
    const stored = { ...record, id: duplicate?.id ?? `LO-${Date.now()}` };
    setRaw(collection, duplicate
      ? existing.map((r) => (r.id === duplicate.id ? stored : r))
      : [...existing, stored]);

    // The Overall Summary / KPI copy. `syncDailyFromHourly` derives the same rows
    // from the hourly ones; this one is derived from the line entry, marked
    // `source: 'line-output'` so the two syncs never delete each other's rows.
    const dailyRows = getData('daily-production');
    const daily = lineOutputDailyRow(record);
    const sameDaily = dailyRows.find((r) => r && r.source === 'line-output'
      && r.date === daily.date && String(r.order_no || '') === String(daily.order_no || '')
      && String(r.line_no || '') === String(daily.line_no || ''));
    setRaw('daily-production', sameDaily
      ? dailyRows.map((r) => (r.id === sameDaily.id ? { ...daily, id: sameDaily.id } : r))
      : [...dailyRows, daily]);

    setNotice(
      `Total Line Output saved — ${record.achievement.toLocaleString()} pcs`
      + `${record.line_no ? ` for ${record.line_no}` : ''} on ${record.date}.`,
    );
    notifySaved(stored, { mode: 'line' });
    reset();
    setShowForm(false);
  }

  /**
   * Tells the host that a NEW entry has been written.
   *
   * Called at the end of every save path, and only for an ADD: re-opening an existing
   * row to correct it is an edit, and jumping the supervisor away from the row they
   * are fixing would be wrong. The row is passed so a host can key off the day that
   * was written (the Daily Production module switches to the Overall Summary for that
   * date).
   *
   * A host that passes no `onSaved` — the standalone Hourly Production menu item, or
   * a test — is unaffected: this is a no-op there.
   */
  function notifySaved(row, extra = {}) {
    if (typeof onSaved !== 'function') return;
    onSaved(row, extra);
  }

  function submit(e) {
    e.preventDefault();
    // Sequential field validation: check the fields one by one and flag the FIRST
    // one that is empty, showing its tooltip right under the box and focusing it.
    // The next field is only examined once this one passes — which is why
    // returning here is correct rather than collecting every error at once.
    //
    // WHICH fields are checked depends on the MODE. An employee is required for
    // Hourly and Daily but OPTIONAL for a Total Line Output entry; a process is
    // required for Hourly and Daily but not for Line or QC.
    // A Total Line Output entry has its own rules — which order it is booked to, who
    // ran the line and what it made — and asks for nothing else. Colour is
    // deliberately NOT among them: it is optional, and a supervisor who does not know
    // the colour must still be able to record the day.
    if (entryMode === 'line') {
      // ORDER NO IS REQUIRED. The line's target is read from the order's Process
      // Sheet, so an entry with no order has no target and no buyer, style or PO qty
      // to show on Line Production — it would be a line total nobody can attribute.
      if (!String(entry.order_no || '').trim()) {
        setFieldError({ field: 'order_no', message: 'Please select the order number for this entry.' });
        orderRef.current?.focus?.();
        return;
      }
      if (!String(entry.supervisor || '').trim()) {
        setFieldError({ field: 'supervisor', message: 'Please select the supervisor who ran the line.' });
        employeeRef.current?.focus?.();
        return;
      }
      const achieved = Number(entry.achievement);
      if (!Number.isFinite(achieved) || achieved < 0) {
        setFieldError({ field: 'achievement', message: 'Please enter the achievement (actual output pcs).' });
        return;
      }
      setFieldError({ field: '', message: '' });
      saveLineEntry(entry.date || todayKey());
      return;
    }
    if (needsEmployee && !entry.employee) {
      setFieldError({ field: 'employee', message: 'Please select the employee for this entry.' });
      employeeRef.current?.focus?.();
      return;
    }
    if (needsProcess && entry.processes.length === 0) {
      setFieldError({ field: 'process', message: 'Please choose at least one process for this entry.' });
      processRef.current?.focus?.();
      return;
    }
    if (needsHours && entry.selectedHours.length === 0) {
      setFieldError({
        field: 'hours',
        message: 'Please tick at least one hour, or switch to Daily / Total Line to log the whole day.',
      });
      hoursRef.current?.focus?.();
      return;
    }
    // QC has its own rules: which order was checked, and at least one figure.
    //
    // ORDER NO IS REQUIRED. A QC check is recorded BY LINE against an order, and the
    // Quality Control report groups and filters by it — a check with no order is an
    // inspection nobody can attribute, and it would drop out of every report that
    // reads one. Checked BEFORE the figures, so the first thing flagged is the field
    // the reader has to go back up the form to fix.
    if (qcMode && !String(entry.order_no || '').trim()) {
      setFieldError({ field: 'order_no', message: 'Please select the order number for this check.' });
      orderRef.current?.focus?.();
      return;
    }
    if (qcMode && qcTotals.totalChecked <= 0) {
      setFieldError({ field: 'qc', message: 'Enter at least one of OK, Alter or Defect pieces.' });
      return;
    }
    setFieldError({ field: '', message: '' });

    const date = entry.date || todayKey();

    // ---- QC Product Check: its own record, its own collection ----
    // A QC check records INSPECTION, not production, so it is written to the
    // quality-control collection and never to the hourly output rows — counting
    // it as output would inflate every production figure the factory reads.
    if (qcMode) {
      const record = buildQcRecord({
        ...entry,
        date,
        // The three multi-select fields, passed under the names the record builder
        // reads. Spread from state as lists; `buildQcRecord` joins each into the
        // comma-separated string the Quality Control screen prints, and keeps the
        // list alongside for the dropdown to re-open from.
        processes: entry.qc_processes,
        colors: entry.qc_colors,
        defect_types: entry.qc_defect_types,
        // A QC check is recorded BY LINE, so the employee field was removed from the
        // form. The supervisor who ran the check is carried instead.
        employee: '',
        supervisor: entry.supervisor || '',
      });
      if (editingId) {
        updateEntry(QC_COLLECTION, editingId, record);
        setNotice(`QC check updated — ${record.total_checked} pcs checked.`);
      } else {
        addEntry(QC_COLLECTION, record);
        setNotice(`QC check saved — ${record.total_checked} pcs checked, ${record.defect_pcs} defect.`);
      }
      // ---- The ERP mirror ----
      // The local store is what the Overall Summary, the Daily sheet and the QC
      // dashboard read, so the check is already live on those the moment this
      // returns. The ERP Quality Control screen reads FIRESTORE, however, so
      // without this write the same check would be invisible there — which is the
      // "disconnected workflow" the brief is about: one form, but two storage
      // backends that never met.
      //
      // The write is fire-and-forget on purpose. A QC check must never fail to
      // save locally because a role lacks the ERP write right, or because the
      // network is down: the local record is the one the floor's screens read, and
      // the mirror is an enhancement. A refusal is therefore swallowed rather than
      // shown, and `save` already audits the change when it does land.
      void mirrorQcToErp(record);
      // A NEW check jumps the host to the Overall Summary like any other new entry.
      // An edit stays put, so the supervisor keeps their place in the row they fixed.
      if (!editingId) notifySaved(record, { mode: 'qc' });
      reset();
      setShowForm(false);
      return;
    }

    // ---- The three OUTPUT modes share one stored shape ----
    const hourlyTarget = hourlyTargetFor(entry.processes[0]);
    // The day's productive hours (lunch excluded) and the OT actually committed,
    // so the stored row carries the same figures the form displayed. In day mode
    // this is the standard shift, because there are no clock hours to count.
    const workingHours = workedHours;
    const overtimeStart = entry.overtimeAdded || entry.overtimeStart || '';
    const overtime = overtimeHoursFrom(overtimeStart);
    // The day's target: the hourly target over the active hours. Written to every
    // row so the Daily Production module can read it without recomputing.
    const dailyTarget = dailyTargetFrom(hourlyTarget, workingHours);
    const common = {
      date,
      employee: resolveEmployee(entryMode, entry.employee),
      style: entry.style || '',
      order_no: entry.order_no || '',
      workingHours,
      overtimeStart,
      overtime,
      dailyTarget,
      // Which mode the figure was logged in, so a whole-day entry reloads as one
      // and the Daily / Monthly sheets can tell the kinds apart.
      mode: dayMode ? 'day' : 'hourly',
      // The unified entry type — 'hourly' | 'daily' | 'line'. Carried through the
      // aggregation to the synced daily-production row so a report can say where
      // a line came from.
      entry_type: entryMode,
    };

    persistEntry(common);
    reset();
    setShowForm(false);
  }

  /** The human label for a saved entry, used in the notice. */
  function entryModeLabel(mode) {
    return (ENTRY_MODES.find((m) => m.key === mode) || {}).label || 'Production';
  }

  /**
   * Mirrors a QC Product Check into the ERP `qualityControl` collection.
   *
   * The unified form writes the local `quality-control` store, which the Overall
   * Summary, the Daily sheet and the QC dashboard all read — so the check is live
   * on those the instant it is saved. The ERP Quality Control SCREEN reads
   * Firestore instead, so without this mirror the same check is invisible there.
   *
   * Deliberately best-effort: the local write has already succeeded and is what
   * the floor's screens show, so a refused permission or an offline device must not
   * turn a saved check into an error. The promise is returned rather than awaited
   * so a caller may ignore it, and `erp.save` audits the change when it does land.
   */
  async function mirrorQcToErp(record) {
    // Only when the account actually holds the create right on Quality. Calling
    // `save` without this would still be refused by the context, but it would do so
    // by throwing a console-visible permission error on every save for a role that
    // was never going to be allowed to write there.
    if (!permissions.can(MODULE.QUALITY, ACTION.CREATE)) return;
    try {
      await erp.save(QC_COLLECTION, record, { module: MODULE.QUALITY });
    } catch {
      // Swallowed on purpose — see the note above. The local record stands.
    }
  }

  /**
   * Writes the entry, either adding a new row or updating the one being edited.
   *
   * Editing is deliberately restricted to the single-process case: a stored row
   * IS one process (multi-process entries are split on save), so editing it can
   * only ever write that one process back. Adding stays multi-process.
   *
   * A Total Line Output entry has NO process, so it is written as a single row
   * under the line label — the whole line's output for the day.
   */
  function persistEntry(common) {
    const label = entryModeLabel(common.entry_type);
    // ---- Total Line Output: one row, no process, employee optional ----
    if (common.entry_type === 'line') {
      const process = entry.processes[0] || LINE_EMPLOYEE_LABEL;
      const hours = { ...(entry.qty?.[process] || entry.qty?.[LINE_EMPLOYEE_LABEL] || {}) };
      const record = {
        ...common,
        process,
        hourlyTarget: hourlyTargetFor(process),
        hours,
        dailyTotal: hoursTotal(hours),
      };
      if (editingId) {
        updateEntry('hourly-timesheet-rows', editingId, record);
        setNotice(`Total line output updated — ${record.dailyTotal.toLocaleString()} pcs.`);
      } else {
        addEntry('hourly-timesheet-rows', record);
        setNotice(`Total line output saved — ${record.dailyTotal.toLocaleString()} pcs.`);
      }
      // Mirror the day into Firestore so the ERP dashboard reflects it at once.
      // Not awaited: the local write is what the floor's screens read, and the
      // mirror must never delay or fail the save the supervisor just made. The
      // result is used only to warn when a row could not be mirrored.
      reportMirror(mirrorDayToErp(common.date));
      // A new entry hands the host the saved row so it can show the day's updated
      // breakdown; an edit does not, so a correction leaves the supervisor in place.
      if (!editingId) notifySaved(record, { mode: common.entry_type });
      return;
    }

    if (entry.processes.length === 1) {
      const process = entry.processes[0];
      const hours = { ...(entry.qty?.[process] || {}) };
      const record = {
        ...common,
        process,
        hourlyTarget: hourlyTargetFor(process),
        hours,
        dailyTotal: hoursTotal(hours),
      };
      if (editingId) {
        updateEntry('hourly-timesheet-rows', editingId, record);
        setNotice(`${label} updated for ${common.employee} — ${process}.`);
      } else {
        addEntry('hourly-timesheet-rows', record);
        setNotice(`${label} saved for ${common.employee} — ${process}.`);
      }
      reportMirror(mirrorDayToErp(common.date));
      if (!editingId) notifySaved(record, { mode: common.entry_type });
      return;
    }
    // Several processes: one row each, carrying only the hours that process ran.
    // Splitting on write is what keeps the stored shape unchanged. An edit of a
    // multi-process selection replaces the edited row with the first process and
    // appends the rest, so nothing recorded is silently dropped.
    entry.processes.forEach((process, index) => {
      const hours = { ...(entry.qty?.[process] || {}) };
      const record = {
        ...common,
        process,
        hourlyTarget: hourlyTargetFor(process),
        hours,
        dailyTotal: hoursTotal(hours),
      };
      if (editingId && index === 0) updateEntry('hourly-timesheet-rows', editingId, record);
      else addEntry('hourly-timesheet-rows', record);
      // The FIRST written row is the one handed to the host — enough to name the day.
      if (!editingId && index === 0) notifySaved(record, { mode: common.entry_type });
    });
    setNotice(`${label} saved for ${common.employee} — ${entry.processes.length} processes.`);
    reportMirror(mirrorDayToErp(common.date));
  }

  /**
   * Waits for a mirror result and, when rows could not be mirrored, says so.
   *
   * The mirror itself is fire-and-forget — the local save has already succeeded and
   * must not wait on it — but a row that never reaches the ERP is a real loss, so
   * the notice appends a visible warning rather than leaving it silent. The save's
   * own success message is kept in front of it.
   */
  function reportMirror(pending) {
    Promise.resolve(pending)
      .then((result) => {
        if (!result?.skipped) return;
        const n = result.skipped;
        setNotice((prev) => [
          prev,
          `${n} row${n === 1 ? '' : 's'} could not sync: line not found in master.`,
        ].filter(Boolean).join(' '));
      })
      .catch(() => { /* the mirror never rejects; nothing to add */ });
  }

  /**
   * Mirrors a day's hourly rows into the ERP `hourlyProduction` collection.
   *
   * The reconciliation — resolving the ERP foreign keys, writing one document per
   * hour slot, and removing the orphans a delete or an edited hour leaves behind —
   * lives in `useHourlyErpMirror`, because the SAME work is needed from this form's
   * save, its row delete and the Daily sheet's delete. Three copies would drift.
   *
   * Called WITHOUT awaiting: the local write is what the floor's screens read, so
   * the mirror must never delay or fail the save the supervisor just made.
   */
  const { mirrorDay: mirrorDayToErp, mirrorRows: mirrorRowsToErp } = useHourlyErpMirror();

  /**
   * Opens a row for INLINE editing, copying its hours into a local draft.
   *
   * The store is not touched here: the boxes are populated from the draft, so every
   * keystroke stays local until Save. Cancel simply drops the draft, which is what
   * makes a mis-typed figure recoverable rather than already committed.
   */
  function startRowEdit(row) {
    setEditingRowId(row.id);
    setDraftHours({ ...(row.hours || {}) });
    setRowError('');
  }

  /** Types one hour into the LOCAL draft — no store write, no notification. */
  function setDraftHour(rowId, hour, value) {
    // Only the row being edited may be typed into. A stray change event from any
    // other row is ignored rather than silently applied, which is the second half
    // of "do not trigger onChange from standard table cells".
    if (rowId !== editingRowId) return;
    setDraftHours((prev) => ({
      ...prev,
      [hour]: value === '' ? undefined : Number(value),
    }));
  }

  /**
   * Commits the draft for the row being edited — ONE write, on Save.
   *
   * The daily total is recomputed from the draft so the stored row and the table's
   * own total column agree the moment the write lands.
   */
  function saveRowEdit() {
    const row = rows.find((r) => r.id === editingRowId);
    if (!row) {
      setEditingRowId(null);
      setDraftHours({});
      return;
    }
    // A figure that is not a number is rejected rather than stored as NaN, which
    // would propagate into every total that reads the row.
    const bad = Object.values(draftHours).find((v) => v !== undefined && !Number.isFinite(Number(v)));
    if (bad !== undefined) {
      setRowError('Every box must be a number — correct it and save again.');
      return;
    }
    const nextRow = { ...row, hours: draftHours };
    updateEntry('hourly-timesheet-rows', row.id, { ...nextRow, dailyTotal: rowTotal(nextRow) });
    setEditingRowId(null);
    setDraftHours({});
    setRowError('');
    setNotice(`Updated the ${row.date || ''} hours for ${row.employee || 'this row'}.`);
  }

  /** Discards the draft. Nothing was written, so there is nothing to undo. */
  function cancelRowEdit() {
    setEditingRowId(null);
    setDraftHours({});
    setRowError('');
  }

  /**
   * Asks before deleting: the row to remove is parked in state and the Yes/No
   * confirmation is shown. Nothing is written until YES — NO, Escape or a backdrop
   * click just clears the pending row.
   */
  function removeRow(rowId) {
    setPendingDelete(rowId);
  }

  /** YES — the deletion the confirmation was asking about actually happens. */
  function confirmRemoveRow() {
    const rowId = pendingDelete;
    setPendingDelete(null);
    if (rowId === null || rowId === undefined) return;
    // The inline editor is closed first when the row being deleted is the one open
    // for editing, so a stale draft cannot be saved back onto a deleted row.
    if (editingRowId === rowId) {
      setEditingRowId(null);
      setDraftHours({});
      setRowError('');
    }
    const day = rowDate(rowId);
    const withoutRow = rows.filter((r) => r.id !== rowId);
    deleteEntry('hourly-timesheet-rows', rowId);
    // Reconcile the mirror so the deleted row's ERP documents go with it. Without
    // this the ERP dashboard would keep counting a row the floor has removed.
    //
    // The row list is passed explicitly rather than re-read from the store: this
    // runs in the same tick as the delete, so the store's React state may still
    // hold the old list and the deleted row would look alive for one reconcile.
    reportMirror(mirrorRowsToErp(day, withoutRow));
  }

  /** The date of one local row, so the mirror can reconcile that day after a delete. */
  function rowDate(rowId) {
    const row = rows.find((r) => r.id === rowId);
    return String(row?.date || entry.date || '').slice(0, 10);
  }

  /** NO — cancel the deletion and leave the row exactly as it was. */
  function cancelRemoveRow() {
    setPendingDelete(null);
  }

  // ---- Derived views ---------------------------------------------------------

  const dayRows = useMemo(
    () => rows.filter((r) => String(r.date || '').slice(0, 10) === viewDate),
    [rows, viewDate],
  );

  /**
   * Daily totals per employee for the viewed day.
   *
   * Every row's hours are summed, and rows for the same person are added
   * together, so an operator who ran two processes in the day gets ONE day
   * figure that is the sum of both.
   */
  const dailyTotals = useMemo(() => {
    const byEmployee = new Map();
    dayRows.forEach((r) => {
      const key = r.employee || '(unnamed)';
      const prev = byEmployee.get(key) || { employee: key, total: 0, rows: 0, processes: new Set() };
      prev.total += rowTotal(r);
      prev.rows += 1;
      if (r.process) prev.processes.add(r.process);
      byEmployee.set(key, prev);
    });
    return [...byEmployee.values()]
      .map((e) => ({ ...e, processes: [...e.processes] }))
      .sort((a, b) => b.total - a.total);
  }, [dayRows]);

  const dayGrandTotal = useMemo(
    () => dayRows.reduce((sum, r) => sum + rowTotal(r), 0),
    [dayRows],
  );

  /**
   * The day's rows grouped by employee, so a name is written ONCE.
   *
   * A person who ran several processes has one row per process in storage (a
   * multi-process entry is split on save). Listing them flat repeats the same name
   * down the column and makes it hard to see where one person's work ends and the
   * next begins. Grouping gives `[{ employee, rows: [...] }, …]` and the table
   * renders the name in a single cell with a `rowSpan` covering that person's
   * rows — the brief's "name appears only once".
   *
   * Grouping is by employee name and preserves the order the day was entered in,
   * so the table reads the same way it was filled rather than being re-sorted.
   */
  const groupedDayRows = useMemo(() => {
    const groups = [];
    const index = new Map();
    dayRows.forEach((row) => {
      const key = row.employee || '(unnamed)';
      if (!index.has(key)) {
        index.set(key, groups.length);
        groups.push({ employee: key, rows: [] });
      }
      groups[index.get(key)].rows.push(row);
    });
    return groups;
  }, [dayRows]);

  /**
   * The "Employee" dropdown's options.
   *
   * Total Line Output asks WHO RAN THE LINE, so it offers the supervisors from the
   * Line Deployment roster and nobody else — an operator is never offered there.
   * The other modes keep the full employee list they have always had.
   */
  const employeeOptions = useMemo(
    () => (lineMode
      ? supervisorOptions
      : employees.map((e) => ({ value: e, label: e }))),
    [lineMode, supervisorOptions, employees],
  );

  return (
    <div className="module">
      <div className="module-header">
        <h2 style={{ margin: 0 }}>⏱️ Hourly Production</h2>
      </div>

      {notice && <div className="erp-notice erp-notice-success dp-notice">{notice}</div>}

      {/* ---- Day picker + actions ---- */}
      <div className="hourly-bar">
        <label className="form-field">
          <span>Working Day</span>
          <input type="date" value={viewDate} onChange={(e) => setViewDate(e.target.value)} />
        </label>
        <div className="hourly-bar-actions">
          {/* Hosted by the Daily Production module? Then "+ New Entry" lives in the
              module's global header instead, and this copy is hidden so the two
              do not both appear. Standalone, this is the only one. */}
          {isAdmin && !hideHeaderActions && (
            <button className="btn btn-primary" onClick={openNewEntry}>
              + New Entry
            </button>
          )}
          {!hideHeaderActions && (
          <button
            className="btn btn-outline"
            onClick={() => downloadCSV(
              `hourly-production-${viewDate}.csv`,
              dayRows.map((r) => ({
                date: r.date,
                employee: r.employee,
                style: r.style || '',
                process: r.process,
                hourlyTarget: r.hourlyTarget ?? '',
                dailyTarget: Number(r.dailyTarget)
                  || dailyTargetFrom(Number(r.hourlyTarget) || 0, r.workingHours || PRODUCTIVE_SHIFT_HOURS),
                ...Object.fromEntries(HOURS.map((h) => [h, r.hours?.[h] ?? ''])),
                dailyTotal: rowTotal(r),
              })),
              [
                { name: 'date', label: 'Date' },
                { name: 'employee', label: 'Employee' },
                { name: 'style', label: 'Style' },
                { name: 'process', label: 'Process' },
                { name: 'hourlyTarget', label: 'Hourly Target' },
                { name: 'dailyTarget', label: 'Daily Target' },
                ...HOURS.map((h) => ({ name: h, label: `${h}:00` })),
                { name: 'dailyTotal', label: 'Daily Total' },
              ],
            )}
          >
            ⬇ Download Report
          </button>
          )}
        </div>
      </div>

      {/* ---- Entry form ---- */}
      {showForm && isAdmin && (
        <form className="dp-entry-card hourly-form" onSubmit={submit}>
          <h3 className="dp-recent-title">
            {editingId
              ? `Edit ${entryModeLabel(entryMode)} entry`
              : `New ${entryModeLabel(entryMode)} entry`}
          </h3>

          {/* ---- 1. ENTRY TYPE SELECTOR ----
              The brief's four modes, as one segmented control at the top of the
              form. Picking one changes which fields are shown below — the field
              set, the required markers and the saved record all follow from it. */}
          <div className="hourly-entry-modes" role="group" aria-label="Entry type">
            {ENTRY_MODES.map((m) => {
              const on = m.key === entryMode;
              return (
                <button
                  key={m.key}
                  type="button"
                  className={`hourly-entry-mode${on ? ' active' : ''}`}
                  aria-pressed={on}
                  title={m.hint}
                  onClick={() => setEntryMode(m.key)}
                >
                  <span className="hourly-entry-mode-icon" aria-hidden="true">{m.icon}</span>
                  <span className="hourly-entry-mode-label">{m.label}</span>
                  <span className="hourly-entry-mode-hint">{m.hint}</span>
                </button>
              );
            })}
          </div>

          {/* ---- Header fields, three balanced columns per row ----
              Row 1: Date | Employee | Order No
              Row 2: Active Hours | Hourly Target | Process

              The order a day is booked to sits beside the date and the person who
              worked it, and the three things that define the target — the hours
              worked, the hourly figure, and the operation — line up together on the
              row below. A plain three-column grid, so the columns stay aligned
              rather than depending on how many fields happen to be present. */}
          <div className="dp-detail-grid hourly-header-grid">
            <label className="form-field">
              <span>Date <em className="req-star">*</em></span>
              <input
                type="date"
                value={entry.date}
                onChange={(e) => setEntry((prev) => ({ ...prev, date: e.target.value }))}
              />
            </label>

            {/* In Total Line Output mode this is the SUPERVISOR who ran the line, and
                the dropdown offers the supervisors from Manpower Management → Line
                Deployment only — operators are not people who sign off a line total.

                REMOVED ENTIRELY in QC Product Check mode: a check is recorded BY LINE
                against an order, not against a person, so there is nobody to name. The
                field is not merely hidden — it is not rendered, so it cannot be filled
                by a stray keystroke or read as a required field by a screen reader. */}
            {!qcMode && (
            <label className="form-field">
              <span>
                {lineMode ? 'Supervisor Name' : 'Employee '} {lineMode || needsEmployee
                  ? <em className="req-star">*</em>
                  : <em className="auto-note">(optional — whole line)</em>}
              </span>
              <SearchableSelect
                ref={employeeRef}
                value={lineMode ? entry.supervisor : entry.employee}
                className={fieldError.field === (lineMode ? 'supervisor' : 'employee') ? 'field-invalid' : ''}
                onChange={(v) => {
                  if (lineMode) {
                    setEntry((prev) => ({ ...prev, supervisor: v }));
                    setFieldError((prev) => (prev.field === 'supervisor' ? { field: '', message: '' } : prev));
                    return;
                  }
                  setEntry((prev) => ({ ...prev, employee: v }));
                  // The field just became valid (or is being edited) — clear its tooltip.
                  setFieldError((prev) => (prev.field === 'employee' ? { field: '', message: '' } : prev));
                }}
                options={employeeOptions}
                placeholder={lineMode
                  ? 'Search supervisor…'
                  : (needsEmployee ? 'Search employee…' : 'Optional — leave blank for the whole line')}
                emptyMessage={lineMode
                  ? 'No supervisor found — set a Supervisor designation in Manpower Management → Line Deployment'
                  : 'No employees yet'}
                ariaLabel={lineMode ? 'Select the supervisor name' : 'Select the employee'}
                ariaInvalid={fieldError.field === (lineMode ? 'supervisor' : 'employee')}
              />
              {(fieldError.field === 'employee' || fieldError.field === 'supervisor') && (
                <span className="field-error-tip" role="alert">{fieldError.message}</span>
              )}
            </label>
            )}

            <label className={`form-field hourly-order-no${fieldError.field === 'order_no' ? ' field-invalid' : ''}`}>
              <span>
                Order No {lineMode || qcMode
                  // REQUIRED in Total Line Output: the line's target, buyer, style and
                  // PO qty all come from the order, so an entry without one cannot be
                  // attributed.
                  // REQUIRED in QC Product Check: a check is recorded by line against an
                  // order, and the QC report groups and filters by it — a check with no
                  // order drops out of every report that reads one.
                  ? <em className="req-star">*</em>
                  : <em className="auto-note">(optional)</em>}
              </span>
              <SearchableSelect
                ref={orderRef}
                value={entry.order_no}
                className={fieldError.field === 'order_no' ? 'field-invalid' : ''}
                onChange={(v) => {
                  selectOrder(v);
                  setFieldError((prev) => (prev.field === 'order_no' ? { field: '', message: '' } : prev));
                }}
                options={orderOptions}
                placeholder="Select Order No"
                emptyMessage="No orders yet — register one in Order Management → Order Input"
                ariaLabel="Select the order number"
                ariaInvalid={fieldError.field === 'order_no'}
              />
              {fieldError.field === 'order_no' && (
                <span className="field-error-tip" role="alert">{fieldError.message}</span>
              )}
            </label>

            {/* ---- Color (Total Line Output only, OPTIONAL) ----
                A multi-select of the colours the selected order carries, so one shift
                can record the several colours it ran. The inline "+ Add" row at the
                foot of the list creates a colour the list does not carry; it is added,
                selected and persisted in one action (see `addOtherColor`).

                With no order selected the list carries NO order colours — but the
                custom "Type custom color..." + "+ Add" row stays fully usable, so a
                colour can be typed and added at any time. Picking an Order No
                auto-maps that order's assigned colours into this same list.

                Optional on purpose: a supervisor who does not know the colour must
                still be able to record the day's output. */}
            {lineMode && (
            <div className="form-field hourly-color-field">
              <span>Color <em className="auto-note">(optional)</em></span>
              <SearchableSelect
                multiple
                value={entry.colors}
                onChange={(v) => setEntry((prev) => ({ ...prev, colors: v }))}
                options={colorOptions}
                placeholder="Select color..."
                emptyMessage="No colors on this order — type one below"
                ariaLabel="Select one or more colors for this entry"
                onAddOption={addOtherColor}
                addPlaceholder="Type custom color..."
                addLabel="+ Add"
              />
            </div>
            )}

            {/* ---- Active Hours / Day ----------------
                Shown ONLY in Hourly mode. Daily and Total Line Output log the whole
                day as one figure, so their hours are the standard shift and this
                control is not rendered at all. */}
            {needsHours && (
            <div className="form-field hourly-hours-field" role="group" aria-label="Active hours or day">
              <span>
                Active Hours / Day <em className="req-star">*</em>
                <span className="hourly-hours-readout" title="Working hours, lunch break (13:00–13:30) excluded">
                  {dayMode ? `${workedHours}h (full day)` : `${productiveSelectedHours}h`}
                  {!dayMode && targetSummary.workedHours > productiveSelectedHours
                    && <em className="hourly-hours-ot"> +{Math.round((targetSummary.workedHours - productiveSelectedHours) * 100) / 100}h OT</em>}
                </span>
              </span>

              {/* The mode switch. `role="tab"`-style semantics would overstate it:
                  these are two mutually exclusive choices, so radio semantics with
                  aria-pressed are the honest description. */}
              <div className="hourly-mode-toggle" role="group" aria-label="Log hourly or by the whole day">
                <button
                  type="button"
                  className={`hourly-mode-btn${!dayMode ? ' active' : ''}`}
                  aria-pressed={!dayMode}
                  onClick={() => setDayMode(false)}
                >
                  ⏱️ Hourly
                </button>
                <button
                  type="button"
                  className={`hourly-mode-btn${dayMode ? ' active' : ''}`}
                  aria-pressed={dayMode}
                  onClick={() => setDayMode(true)}
                >
                  📅 Day
                </button>
              </div>

              {dayMode ? (
                // Day mode: the clock slots are collapsed away, and a note says what
                // the single figure will cover rather than leaving an empty dropdown.
                <p className="hourly-day-note">
                  Whole day selected — individual hour boxes are hidden. Enter the day's
                  total once below.
                </p>
              ) : (
                <SearchableSelect
                  multiple
                  ref={hoursRef}
                  value={entry.selectedHours.filter((h) => h !== DAY_MODE)}
                  className={fieldError.field === 'hours' ? 'field-invalid' : ''}
                  onChange={(v) => {
                    setSelectedHours(v);
                    setFieldError((prev) => (prev.field === 'hours' ? { field: '', message: '' } : prev));
                  }}
                  options={hourOptions}
                  placeholder="Search hour… (pick one or more)"
                  emptyMessage="No hours listed — add one below"
                  ariaLabel="Choose the hours this entry records"
                  ariaInvalid={fieldError.field === 'hours'}
                  onAddOption={addOtherTime}
                  addPlaceholder="Overtime Start Time..."
                  addLabel="Add"
                />
              )}
              {fieldError.field === 'hours' && (
                <span className="field-error-tip" role="alert">{fieldError.message}</span>
              )}
              <span className="hourly-hours-hint">Morning 08:00–13:00 · lunch 13:00–13:30 · afternoon 13:30–18:30</span>
            </div>
            )}

            {/* A whole-day mode (Daily / Total Line Output) states its hours rather
                than asking for them, so the day's target is still visible. */}
            {!needsHours && (
              <div className="form-field hourly-day-fixed">
                <span>Working Hours <em className="auto-note">(standard shift)</em></span>
                <span className="hourly-hours-readout">
                  <strong>{workedHours}h</strong> (full day)
                </span>
              </div>
            )}

            {/* ---- Hourly Target (output modes only) ---- */}
            {outputMode && !lineMode && (
            <label className="form-field hourly-target-inline">
              <span>Hourly Target <em className="auto-note">(manual — else the sheet's SMV)</em></span>
              <input
                type="number"
                min="0"
                value={entry.hourlyTarget}
                onChange={(e) => setEntry((prev) => ({ ...prev, hourlyTarget: e.target.value }))}
                placeholder="e.g. 120"
                aria-label="Manual hourly target"
              />
              {/* The "Daily Target = 0 × 10 h = 0 pcs" helper that used to sit here is
                  gone: the Daily Target is stated in its own read-out box below and in
                  the Target vs Achievement strip, so the line only restated it and
                  pushed the fields underneath further down the form. */}
              {/* The auto-target the brief asks for: Base Hourly Capacity (60/SMV)
                  × (1 + buffer), and ×10 for the standard day. Shown as soon as a
                  process is chosen, and left editable by the box above. */}
              {entry.processes.length > 0 && (() => {
                const auto = autoTargetFor(entry.processes[0]);
                if (!auto.hasSmv) return null;
                return (
                  <span className="hourly-auto-target">
                    Auto from SMV {auto.smv} min: <strong>{auto.hourlyTarget}/hr</strong>
                    {' '}→ <strong>{auto.dailyTarget}/day</strong>
                    {targetBuffer > 0 && <em className="auto-note"> (+{targetBuffer}% buffer)</em>}
                  </span>
                );
              })()}
              {/* The percentage-adjusted Complete Body Target, beside the
                  individual process target — the brief's multi-module sync. */}
              {bodyTarget.hasTarget && (
                <span className="hourly-body-target">
                  Complete Body Target: <strong>{bodyTarget.dailyTarget.toLocaleString()}</strong> pcs/day
                  <em className="auto-note">
                    {' '}({bodyTarget.processCount} operations
                    {targetBuffer > 0 ? `, +${targetBuffer}% buffer` : ''}, {STANDARD_DAY_HOURS}h day)
                  </em>
                </span>
              )}
            </label>
            )}

            {/* ---- Total Line Output: the targets the order's Process Sheet states ----
                Hourly Target and Daily Target sit SIDE BY SIDE as two peer fields, which
                is the cell this row's third column carries in every other mode (the
                process picker's place). Both are READ-ONLY because a line entry's target
                is not a decision: it is whatever the uploaded sheet states for the chosen
                Order No. The Daily Target is filled automatically the moment an Order No
                is picked (see `lineTargets`) and re-fills if the sheet is re-uploaded.

                They are one grid CELL rather than two: the header grid is three columns,
                so two separate children would land on different rows (the second under
                Supervisor Name) and leave the third column empty. */}
            {lineMode && (
            <div className="form-field hourly-line-targets">
              <div className="hourly-line-targets-row">
                <label className="hourly-line-target">
                  <span>Hourly Target <em className="auto-note">(from the sheet)</em></span>
                  <input
                    type="number"
                    min="0"
                    value={lineTargets?.hourlyTarget || ''}
                    readOnly
                    disabled={!lineTargets?.hasTarget}
                    placeholder="—"
                    aria-label="Hourly target from the process sheet"
                  />
                </label>
                <label className="hourly-line-target">
                  <span>Daily Target <em className="auto-note">(auto from Order No)</em></span>
                  <input
                    type="number"
                    min="0"
                    value={lineTargets?.dailyTarget || ''}
                    readOnly
                    disabled={!lineTargets?.hasTarget}
                    placeholder="—"
                    aria-label="Daily target, filled automatically from the order number"
                  />
                </label>
              </div>
              <span className="hourly-auto-target">
                {targetSourceNote(lineTargets)}
              </span>
            </div>
            )}

            {/* ---- Process (required for Hourly / Daily; optional for Total Line) ---- */}
            {outputMode && !lineMode && (
            <label className="form-field">
              <span>
                Process {needsProcess
                  ? <em className="req-star">*</em>
                  : <em className="auto-note">(optional — whole line)</em>}
              </span>
              {/* The dropdown opens with a CHECKBOX beside every process (the
                  control's multi-select shape) and carries an "Add Other Process"
                  row at its foot. A process typed there appears in the list at once
                  and joins the uploaded process sheet's master list, so the rest of
                  the app offers it too. */}
              <SearchableSelect
                multiple
                ref={processRef}
                value={entry.processes}
                className={fieldError.field === 'process' ? 'field-invalid' : ''}
                onChange={(v) => {
                  setProcesses(v);
                  setFieldError((prev) => (prev.field === 'process' ? { field: '', message: '' } : prev));
                }}
                options={processOptions}
                placeholder="Search process… (pick one or more)"
                emptyMessage="No operations on this order's uploaded sheet — add one below"
                ariaLabel="Select one or more processes for this entry"
                ariaInvalid={fieldError.field === 'process'}
                onAddOption={addOtherProcess}
                addPlaceholder="Add other process…"
                addLabel="Add"
              />
              {fieldError.field === 'process' && (
                <span className="field-error-tip" role="alert">{fieldError.message}</span>
              )}
            </label>
            )}

            {/* ---- Total Line Output: the line the total belongs to ---- */}
          </div>

          {entry.order_no && processOptions.length === 0 && (
            <p className="hint" style={{ marginTop: 4 }}>
              No process sheet has been uploaded for this order yet — type the process by hand, or
              upload a sheet in Order Management → Process Sheet Upload to get the list.
            </p>
          )}

          {/* ================ QC PRODUCT CHECK ================
              A QC check records INSPECTION, not production, so its fields replace
              the whole output grid. Total Checked is DERIVED below (OK + Alter +
              Defect) and never typed — the brief's auto-calculation. */}
          {qcMode && (
            <>
              <div className="hourly-grid-head">
                <span className="hourly-grid-label">QC Product Check</span>
                <span className="hourly-bar-actions">
                  <span className="hourly-hours-readout">
                    Total Checked: <strong>{qcTotals.totalChecked.toLocaleString()}</strong> pcs
                  </span>
                </span>
              </div>

              <div className="qc-grid">
                <label className="form-field qc-cell qc-ok">
                  <span>OK Body Pcs</span>
                  <input
                    type="number"
                    min="0"
                    value={entry.ok_pcs ?? ''}
                    onChange={(e) => setEntry((prev) => ({ ...prev, ok_pcs: e.target.value }))}
                    placeholder="0"
                    aria-label="OK body pieces"
                  />
                </label>
                <label className="form-field qc-cell qc-alter">
                  <span>Alter Pcs</span>
                  <input
                    type="number"
                    min="0"
                    value={entry.alter_pcs ?? ''}
                    onChange={(e) => setEntry((prev) => ({ ...prev, alter_pcs: e.target.value }))}
                    placeholder="0"
                    aria-label="Alter pieces"
                  />
                </label>
                <label className="form-field qc-cell qc-defect">
                  <span>Defect / Reject Pcs</span>
                  <input
                    type="number"
                    min="0"
                    value={entry.defect_pcs ?? ''}
                    onChange={(e) => setEntry((prev) => ({ ...prev, defect_pcs: e.target.value }))}
                    placeholder="0"
                    aria-label="Defect or reject pieces"
                  />
                </label>
                <label className="form-field qc-cell qc-total">
                  <span>Total Checked <em className="auto-note">(auto)</em></span>
                  <input
                    value={qcTotals.totalChecked.toLocaleString()}
                    readOnly
                    disabled
                    placeholder="0"
                    aria-label="Total checked pieces"
                  />
                </label>
              </div>

              {/* ---- QC multi-selects ----
                  Process and Color are both order-dependent for their ORDER values —
                  picking an Order No auto-maps that order's processes and colours into
                  the two lists — but NEITHER is ever locked. Both keep their inline
                  "Type custom ..." + "+ Add" row usable with no order selected, so a
                  fault can be recorded against a process or colour the order (or the
                  sheet) does not carry. Defect Type is not order-dependent at all — a
                  fault reason is a property of the garment, not of one order.

                  All three are OPTIONAL. A check with no process, colour or defect
                  reason is still a valid record of pieces inspected — only the order
                  and at least one figure are required. */}
              <div className="qc-multi-grid">
                <div className="form-field qc-multi-cell">
                  <span>Process <em className="auto-note">(optional)</em></span>
                  <SearchableSelect
                    multiple
                    // NEVER disabled, exactly like the Color field: the custom
                    // "Type custom process..." + "+ Add" row must work at any time.
                    value={entry.qc_processes}
                    onChange={(v) => setEntry((prev) => ({ ...prev, qc_processes: v }))}
                    options={qcProcesses}
                    placeholder="Select processes..."
                    emptyMessage="No processes yet — type one below"
                    ariaLabel="Select one or more processes for this check"
                    onAddOption={addQcProcess}
                    addPlaceholder="Type custom process..."
                    addLabel="+ Add"
                  />
                  {!orderSelected && (
                    <span className="qc-locked-hint">Order processes appear once an Order No is selected.</span>
                  )}
                </div>

                <div className="form-field qc-multi-cell">
                  <span>Color <em className="auto-note">(optional)</em></span>
                  <SearchableSelect
                    multiple
                    // NEVER disabled: with no order selected the list carries no order
                    // colours, but the custom "Type custom color..." + "+ Add" row must
                    // still let a colour be typed and added (see `qcColors`).
                    value={entry.qc_colors}
                    onChange={(v) => setEntry((prev) => ({ ...prev, qc_colors: v }))}
                    options={qcColors}
                    placeholder="Select color..."
                    emptyMessage="No colors assigned to this order — type one below"
                    ariaLabel="Select one or more colors for this check"
                    onAddOption={addQcColor}
                    // The SAME pattern as the Process dropdown beside it: a box and a
                    // "+ Add" button pinned to the foot of the open menu, so a colour
                    // the order does not carry is created without leaving the form.
                    addPlaceholder="Type custom color..."
                    addLabel="+ Add"
                  />
                  {!orderSelected && (
                    <span className="qc-locked-hint">Order colors appear once an Order No is selected.</span>
                  )}
                </div>

                <div className="form-field qc-multi-cell">
                  <span>Defect Type <em className="auto-note">(optional)</em></span>
                  <SearchableSelect
                    multiple
                    value={entry.qc_defect_types}
                    onChange={(v) => setEntry((prev) => ({ ...prev, qc_defect_types: v }))}
                    options={qcDefectTypes}
                    placeholder="Select defect types..."
                    emptyMessage="No defect types listed"
                    ariaLabel="Select one or more defect types"
                    onAddOption={addQcDefectType}
                    addPlaceholder="Type custom defect type..."
                    addLabel="+ Add"
                  />
                </div>
              </div>

              {fieldError.field === 'qc' && (
                <span className="field-error-tip" role="alert">{fieldError.message}</span>
              )}

              {/* The QC read-out: the brief's Total Checked plus the pass / alter /
                  defect split, so the supervisor sees the classification as they type. */}
              <div className="hourly-achievement qc-summary">
                <div className="hourly-ach-cell">
                  <span className="hourly-ach-label">OK</span>
                  <strong className="dp-good">{qcTotals.okPcs.toLocaleString()}</strong>
                </div>
                <div className="hourly-ach-cell">
                  <span className="hourly-ach-label">Alter</span>
                  <strong>{qcTotals.alterPcs.toLocaleString()}</strong>
                </div>
                <div className="hourly-ach-cell">
                  <span className="hourly-ach-label">Defect / Reject</span>
                  <strong className="dp-bad">{qcTotals.defectPcs.toLocaleString()}</strong>
                </div>
                <div className="hourly-ach-cell">
                  <span className="hourly-ach-label">Total Checked</span>
                  <strong>{qcTotals.totalChecked.toLocaleString()}</strong>
                </div>
                <div className="hourly-ach-cell">
                  <span className="hourly-ach-label">Pass Rate</span>
                  <strong>{qcTotals.passRate}%</strong>
                </div>
                <div className="hourly-ach-cell">
                  <span className="hourly-ach-label">Defect Rate</span>
                  <strong className={qcTotals.defectRate > 8 ? 'dp-bad' : 'dp-good'}>{qcTotals.defectRate}%</strong>
                </div>
              </div>
            </>
          )}

          {/* ---- Selected-hours toolbar ----
              The hours themselves are picked in the Active Hours / Day control
              above; these two are its shortcuts. The readout states the day's
              productive hours and any overtime on top, so the effect of the ticks
              is visible without opening the menu. There is deliberately NO "N slots
              selected" badge: the boxes below already show exactly which slots are
              open, so the count only restated what was on screen.
              Shown only in Hourly mode — the whole-day modes have no slots to pick. */}
          {needsHours && (
          <div className="hourly-grid-head">
            <span className="hourly-grid-label">
              {dayMode
                ? 'Full day logging'
                : (entry.selectedHours.length > 0
                  ? `Recording ${entry.selectedHours.length} hour${entry.selectedHours.length === 1 ? '' : 's'}`
                  : 'No hours selected yet')}
            </span>
            <span className="hourly-bar-actions">
              <span className="hourly-hours-readout" title="Working hours, lunch break (13:00–13:30) excluded">
                Working hours: <strong>{productiveSelectedHours}</strong> / {PRODUCTIVE_SHIFT_HOURS}
                {targetSummary.workedHours > productiveSelectedHours && (
                  <em className="hourly-hours-ot"> +{Math.round((targetSummary.workedHours - productiveSelectedHours) * 100) / 100}h OT</em>
                )}
              </span>
              {!dayMode && (
                <>
                  <button type="button" className="btn btn-mini btn-outline" onClick={() => setSelectedHours([...HOURS, ...addedHourSlots])}>
                    Select all
                  </button>
                  <button type="button" className="btn btn-mini btn-outline" onClick={() => setSelectedHours([])}>
                    Clear
                  </button>
                </>
              )}
            </span>
          </div>
          )}

          {/* ---- Overtime is now entered in the Active Hours dropdown ----
              The separate "Overtime Start Time" box that used to sit here is gone:
              its input, its Add button and its readout restated what the dropdown's
              own add-field already does. An overtime start time is just another
              custom clock slot, so it is entered where the slots are chosen — in the
              "Active Hours / Day" dropdown's "Overtime Start Time..." field — and
              the slot it appends lands in `selectedHours` like any other.

              The old state (`entry.overtimeStart` / `entry.overtimeAdded`) and the
              `overtimeHoursFrom` helper are left in place and unused rather than
              deleted, so the standalone box can be restored from this comment alone
              if a future brief wants it back. */}

          {/* ================ TOTAL LINE OUTPUT ================
              ONE box: the achievement the supervisor actually knows. The targets above
              come from the order's Process Sheet, so nothing else is asked for — no
              process boxes, no hour boxes, no target to retype. The day's verdict is
              shown live underneath, against the target that was loaded. */}
          {lineMode && (
            <>
              <div className="hourly-grid-head">
                <span className="hourly-grid-label">Total Line Output</span>
                <span className="hourly-hours-readout">
                  {entry.order_no ? `Order ${entry.order_no}` : 'No order selected'}
                  {entry.line_no ? ` · ${entry.line_no}` : ''}
                </span>
              </div>

              <div className="hourly-day-grid">
                <label className="hourly-day-cell">
                  <span>Achievement (Actual Output Pcs) <em className="req-star">*</em></span>
                  <input
                    type="number"
                    min="0"
                    value={entry.achievement ?? ''}
                    onChange={(e) => {
                      setEntry((prev) => ({ ...prev, achievement: e.target.value }));
                      setFieldError((prev) => (prev.field === 'achievement' ? { field: '', message: '' } : prev));
                    }}
                    placeholder="0"
                    aria-label="Achievement, actual output pieces"
                  />
                  <span className="hourly-day-hint">
                    Daily target {targetSummary.dailyTarget.toLocaleString()} pcs
                    {targetSummary.hourlyTarget > 0 && ` (${targetSummary.hourlyTarget.toLocaleString()}/hr × ${workedHours}h)`}
                  </span>
                  {fieldError.field === 'achievement' && (
                    <span className="field-error-tip" role="alert">{fieldError.message}</span>
                  )}
                </label>
              </div>

              <div className="hourly-achievement">
                <div className="hourly-ach-cell">
                  <span className="hourly-ach-label">Hourly Target</span>
                  <strong>{targetSummary.hourlyTarget ? targetSummary.hourlyTarget.toLocaleString() : '—'}</strong>
                </div>
                <div className="hourly-ach-cell">
                  <span className="hourly-ach-label">Daily Target</span>
                  <strong>{targetSummary.dailyTarget.toLocaleString()}</strong>
                </div>
                <div className="hourly-ach-cell">
                  <span className="hourly-ach-label">Achieved</span>
                  <strong>{targetSummary.achieved.toLocaleString()}</strong>
                </div>
                <div className="hourly-ach-cell">
                  <span className="hourly-ach-label">Due / Variance</span>
                  <strong className={`hourly-variance-${targetSummary.tone}`}>{targetSummary.label}</strong>
                </div>
                <div className="hourly-ach-cell">
                  <span className="hourly-ach-label">Achievement</span>
                  <strong>{targetSummary.hasTarget ? `${targetSummary.achievementPercent}%` : '—'}</strong>
                </div>
              </div>
            </>
          )}

          {/* ---- Quantity per process (output modes) ----
              HOURLY mode: one input box per chosen process per chosen hour.
              DAY mode:    the hourly boxes are collapsed away and each process gets
                           a single "Full Day Output" box instead.
              LINE mode:   one "Full Day Output" box for the whole line, whether or
                           not a process was named.
              All write to the same `qty[process][slot]` shape — the slot key is
              just DAY_MODE — so the day total, the stored row and the CSV read it
              identically and nothing downstream branches. */}
          {outputMode && !lineMode && (
          <>
          {quantityProcesses.length > 0 && (
            <div className="hourly-grid-head">
              <span className="hourly-grid-label">
                {entryMode === 'line' ? 'Total Line Output' : (dayMode ? 'Full Day Output' : 'Hourly Output')}
              </span>
            </div>
          )}
          {needsProcess && entry.processes.length === 0 && (
            <p className="hint" style={{ marginTop: 10 }}>
              Pick one or more processes above — a quantity box appears for each.
            </p>
          )}
          {needsHours && entry.processes.length > 0 && entry.selectedHours.length === 0 && (
            <p className="hint" style={{ marginTop: 10 }}>
              Tick at least one hour above, or switch to Daily / Total Line to log the whole day.
            </p>
          )}

          {quantityProcesses.map((process) => {
            const hourlyTarget = hourlyTargetFor(process);
            const summary = targetSummary.perProcess.find((p) => p.process === process) || {};
            const isLineTotal = entryMode === 'line';
            return (
              <div key={process} className="hourly-process-block">
                <div className="hourly-process-head">
                  <span className="hourly-process-name">{process}</span>
                  <span className="hourly-target-badge">
                    Target / hr: <strong>{hourlyTarget || '—'}</strong>
                  </span>
                  <span className={`hourly-variance hourly-variance-${summary.tone || 'info'}`}>
                    {summary.label || 'No target set'}
                  </span>
                </div>

                {dayMode ? (
                  // ---- Day mode: ONE box for the whole shift ----
                  <div className="hourly-day-grid">
                    <label className="hourly-day-cell">
                      <span>{isLineTotal ? 'Total Line Output' : 'Full Day Output'} <em className="auto-note">(all hours)</em></span>
                      <input
                        type="number"
                        min="0"
                        value={entry.qty?.[process]?.[DAY_MODE] ?? ''}
                        onChange={(e) => setQty(process, DAY_MODE, e.target.value)}
                        placeholder="0"
                        aria-label={`Full day output for ${process}`}
                      />
                      <span className="hourly-day-hint">
                        Daily target {targetSummary.dailyTarget.toLocaleString()} pcs
                        {hourlyTarget > 0 && ` (${hourlyTarget}/hr × ${productiveSelectedHours}h)`}
                      </span>
                    </label>
                  </div>
                ) : (
                  // ---- Hourly mode: one box per chosen slot ----
                  <div className="hourly-input-grid">
                    {entry.selectedHours.filter((h) => h !== DAY_MODE).map((h) => (
                      <label key={h} className="hourly-input-cell">
                        <span>{hourLabel(h)}</span>
                        <input
                          type="number"
                          min="0"
                          value={entry.qty?.[process]?.[h] ?? ''}
                          onChange={(e) => setQty(process, h, e.target.value)}
                          placeholder="0"
                        />
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          </>
          )}

          {/* ---- Target vs achievement, live (output modes) ---- */}
          {outputMode && !lineMode && entry.processes.length > 0 && entry.selectedHours.length > 0 && (
            <div className="hourly-achievement">
              <div className="hourly-ach-cell">
                <span className="hourly-ach-label">Hourly Target</span>
                <strong>{targetSummary.hourlyTarget ? targetSummary.hourlyTarget.toLocaleString() : '—'}</strong>
              </div>
              <div className="hourly-ach-cell">
                <span className="hourly-ach-label">{dayMode ? 'Daily Target' : 'Target'}</span>
                <strong>{targetSummary.target.toLocaleString()}</strong>
              </div>
              <div className="hourly-ach-cell">
                <span className="hourly-ach-label">Achieved</span>
                <strong>{targetSummary.achieved.toLocaleString()}</strong>
              </div>
              <div className="hourly-ach-cell">
                <span className="hourly-ach-label">Due / Variance</span>
                <strong className={`hourly-variance-${targetSummary.tone}`}>{targetSummary.label}</strong>
              </div>
              <div className="hourly-ach-cell">
                <span className="hourly-ach-label">Daily Target</span>
                <strong>{targetSummary.dailyTarget.toLocaleString()}</strong>
              </div>
              <div className="hourly-ach-cell">
                <span className="hourly-ach-label">Achievement</span>
                <strong>{targetSummary.hasTarget ? `${targetSummary.achievementPercent}%` : '—'}</strong>
              </div>
            </div>
          )}

          <div className="hourly-form-foot">
            <span className="hourly-running-total">
              {qcMode ? (
                <>Total checked: <strong>{qcTotals.totalChecked.toLocaleString()}</strong> pcs</>
              ) : lineMode ? (
                <>Achievement: <strong>{(Number(entry.achievement) || 0).toLocaleString()}</strong> pcs</>
              ) : (
                <>
                  Entry total: <strong>{hoursTotal(
                    Object.assign({}, ...quantityProcesses.map((p) => entry.qty?.[p] || {})),
                  ).toLocaleString()}</strong> pcs
                </>
              )}
            </span>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary">
                {editingId
                  ? 'Save Changes'
                  : (lineMode ? 'Save Total Line Output Entry' : `Save ${entryModeLabel(entryMode)} Entry`)}
              </button>
              <button type="button" className="btn btn-outline" onClick={() => { reset(); setShowForm(false); }}>
                Cancel
              </button>
            </div>
          </div>
        </form>
      )}

      {/* ---- Daily totals per employee ---- */}
      <section className="hourly-totals">
        <h3 className="dp-recent-title">
          Daily totals — {viewDate}
          <span className="rge-card-sub" style={{ marginLeft: 10 }}>
            {dayGrandTotal.toLocaleString()} pcs across {dailyTotals.length} worker
            {dailyTotals.length === 1 ? '' : 's'}
          </span>
        </h3>
        {dailyTotals.length === 0 ? (
          <p className="hint" style={{ marginTop: 8 }}>
            No hourly entries recorded for this day yet.
          </p>
        ) : (
          <div className="hourly-total-chips">
            {dailyTotals.map((t) => (
              <div key={t.employee} className="hourly-total-chip">
                <span className="hourly-total-name" title={t.processes.join(', ')}>
                  {t.employee}
                </span>
                <span className="hourly-total-value">{t.total.toLocaleString()} pcs</span>
                <span className="hourly-total-sub">
                  {t.processes.length} process{t.processes.length === 1 ? '' : 'es'}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---- The day's rows ----
          Every hour box here is READ-ONLY until its own row's Edit button is
          pressed. That is deliberate: the boxes used to write to storage on every
          keystroke, so scrolling the table with a stray key could silently rewrite
          somebody's output. A row now opens a local draft, and only Save writes. */}
      <section style={{ marginTop: 22 }}>
        <div className="hourly-table-head">
          <h3 className="dp-recent-title" style={{ margin: 0 }}>Recorded rows — {viewDate}</h3>
          <span className="hourly-table-hint">
            {isAdmin
              ? (editingRowId
                ? 'Editing one row — Save to keep the changes, Cancel to discard them.'
                : 'Press ✏️ on a row to make its hour boxes editable.')
              : 'View only — the hour boxes are locked.'}
          </span>
        </div>
        {rowError && (
          <div className="erp-notice erp-notice-error dp-notice" role="alert">{rowError}</div>
        )}
        <div className="table-wrap">
          <table className="dp-table hourly-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Process</th>
                <th className="hourly-target-col">Target/hr</th>
                <th className="hourly-target-col">Daily Target</th>
                {HOURS.map((h) => <th key={h} className="hourly-hour-col">{hourLabel(h)}</th>)}
                <th className="hourly-total-col">Daily Total</th>
                <th className="hourly-total-col">Due</th>
                {isAdmin && <th className="hourly-actions-col">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {dayRows.length === 0 && (
                <tr>
                  <td colSpan={HOURS.length + 6 + (isAdmin ? 1 : 0)} className="empty-row">
                    No hourly rows for {viewDate} — add one above.
                  </td>
                </tr>
              )}
              {/* One GROUP per employee: the name is written once in a cell whose
                  `rowSpan` covers every process that person ran that day, so a
                  worker on three processes no longer has their name repeated three
                  times down the column. */}
              {groupedDayRows.map((group) => group.rows.map((r, rowIndex) => {
                const hourly = Number(r.hourlyTarget) || targetForProcess(r.process);
                // While this row is being edited inline, every figure shown is the
                // LOCAL draft, so the totals move as the supervisor types without a
                // single store write until Save.
                const isEditingRow = editingRowId === r.id;
                const shownHours = isEditingRow ? draftHours : (r.hours || {});
                const shownTotal = Object.values(shownHours).reduce(
                  (sum, v) => sum + (Number(v) || 0),
                  0,
                );
                // The stored day target when one was saved, otherwise the hourly
                // figure over the day's productive hours — always the same maths the
                // entry form used.
                const dailyTarget = Number(r.dailyTarget)
                  || dailyTargetFrom(hourly, r.workingHours || PRODUCTIVE_SHIFT_HOURS);
                const due = dailyTarget - shownTotal;
                const isFirstOfGroup = rowIndex === 0;
                return (
                  <tr
                    key={r.id}
                    className={`${isFirstOfGroup ? 'hourly-group-start' : 'hourly-group-cont'}${isEditingRow ? ' hourly-row-editing' : ''}`}
                  >
                    {isFirstOfGroup && (
                      <td rowSpan={group.rows.length} className="hourly-employee-cell">
                        <span className="hourly-employee-name">{group.employee}</span>
                        {group.rows.length > 1 && (
                          <span className="hourly-employee-sub">
                            {group.rows.length} processes
                          </span>
                        )}
                      </td>
                    )}
                    <td>{r.process}</td>
                    <td className="mono-cell hourly-target-col">{hourly}</td>
                    <td className="mono-cell hourly-target-col">{dailyTarget.toLocaleString()}</td>
                    {HOURS.map((h) => (
                      <td key={h} className="hourly-hour-col">
                        <input
                          type="number"
                          className="hour-cell-input"
                          value={shownHours?.[h] ?? ''}
                          // Typing is only possible on the row whose Edit button was
                          // pressed; every other row is a plain read-only figure. The
                          // change handler also refuses a row it does not own, so a
                          // stray event cannot write to the store.
                          onChange={(e) => setDraftHour(r.id, h, e.target.value)}
                          disabled={!isAdmin || !isEditingRow}
                          readOnly={!isEditingRow}
                          placeholder="-"
                          aria-label={`${hourLabel(h)} output for ${r.employee || 'this row'}`}
                        />
                      </td>
                    ))}
                    <td className="mono-cell hourly-total-col"><strong>{shownTotal.toLocaleString()}</strong></td>
                    <td className={`mono-cell hourly-total-col ${due > 0 ? 'hourly-variance-bad' : (due < 0 ? 'hourly-variance-good' : '')}`}>
                      {due === 0 ? '0' : (due > 0 ? `-${due.toLocaleString()}` : `+${Math.abs(due).toLocaleString()}`)}
                    </td>
                    {isAdmin && (
                      <td className="hourly-actions-col">
                        <div className="hourly-row-actions">
                          {isEditingRow ? (
                            // ---- In edit mode: Save commits the draft, Cancel
                            // discards it. Nothing has been written until Save. ----
                            <>
                              <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                title="Save these hours"
                                onClick={saveRowEdit}
                              >Save</button>
                              <button
                                type="button"
                                className="btn btn-outline btn-sm"
                                title="Discard the changes"
                                onClick={cancelRowEdit}
                              >Cancel</button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="btn-icon"
                                title="Edit this row"
                                aria-label={`Edit ${r.employee || 'row'} — ${r.process || ''}`.trim()}
                                onClick={() => startRowEdit(r)}
                              >✏️</button>
                              <button
                                type="button"
                                className="btn-icon"
                                title="Delete this row"
                                aria-label={`Delete ${r.employee || 'row'} — ${r.process || ''}`.trim()}
                                onClick={() => removeRow(r.id)}
                              >🗑️</button>
                            </>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              }))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---- The delete confirmation ----
          Every delete goes through this Yes/No dialog: the row is only removed when
          YES is clicked, so a stray click on 🗑️ cannot destroy a day's figures. The
          title and the message are English only, as the brief requires. */}
      <ConfirmDialog
        open={pendingDelete !== null && pendingDelete !== undefined}
        title="Confirm Deletion"
        message="Are you sure you want to delete this production record? This action cannot be undone."
        confirmLabel="YES"
        cancelLabel="NO"
        danger
        onConfirm={confirmRemoveRow}
        onCancel={cancelRemoveRow}
      />
    </div>
  );
}
