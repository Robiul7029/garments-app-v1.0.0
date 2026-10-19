import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { useData } from '../context/DataContext';
import { usePermissions } from '../context/PermissionContext';
import { MODULE } from '../config/erpRoles';
import SearchableSelect from '../components/SearchableSelect';
import {
  COLLECTIONS,
  parseOperations,
  totalSmvOf,
  buildProcessSheet,
  operationsForStyle,
  latestSheetForStyle,
  selectableOrders,
  orderLabel,
  withRecomputedTotals,
  detectLineOutputProcess,
} from '../config/orderWorkflow';
import CapacityPanel from '../components/CapacityPanel';
import LineBalancingSection from '../components/LineBalancingSection';
import ProcessSheetModals from '../components/ProcessSheetModals';
import {
  CAPACITY_COLLECTION,
  buildCapacityRecord,
  capacityForStyle,
  calculateCapacity,
  detectSmvUnit,
  distributeSmvByWeight,
  readTotalGarmentSmv,
  defaultWeightsFor,
  autoTargetForProcess,
  AUTO_TARGET_ALLOWANCE,
} from '../config/smvTargetEngine';
import { firstInvalid, PROCESS_SHEET_RULES } from '../config/sequentialValidation';

/**
 * Order Management → Process Sheet Upload.
 *
 * Uploads the Operation Breakdown / SMV sheet for a style and links every
 * extracted operation to that style, so the Daily Production form can offer the
 * right operations in its Process dropdown.
 *
 * Two file kinds are accepted:
 *
 *   .xlsx / .xls / .csv — parsed in the browser with SheetJS (the same build the
 *     Excel export uses). The header row is found rather than assumed, aliases
 *     are matched, and blank/total rows are dropped.
 *
 *   .pdf — a PDF is not a spreadsheet and this app has no PDF text extractor, so
 *     it is STORED with the style rather than silently mis-parsed. The sheet is
 *     still attached to the order and listed below, and the operations can be
 *     typed in by hand in the review grid before saving. Claiming to have parsed
 *     a PDF we cannot read would put invented operations in front of the floor.
 *
 * Nothing is saved until the parsed rows have been shown and confirmed — a wrong
 * file is caught here, not on the line tomorrow.
 */
const GENERATOR_STORAGE_KEY = 'process-sheet-line-balancing-state';

function readGeneratorState() {
  try {
    if (typeof window === 'undefined') return {};
    const raw = window.localStorage.getItem(GENERATOR_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function persistGeneratorState(sheet, settings = {}) {
  if (!sheet) return;
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(GENERATOR_STORAGE_KEY, JSON.stringify({
      activeSheetId: sheet.id,
      style: sheet.style || '',
      totalSmv: sheet.totalSmv ?? 0,
      manpower: settings.manpower ?? sheet.manpower ?? '',
      workingHours: settings.workingHours ?? sheet.workingHours ?? 10,
      efficiency: settings.efficiency ?? sheet.efficiency ?? 100,
    }));
  } catch { /* storage can be unavailable or full; the in-memory state still works */ }
}

export default function ProcessUploadPage({ category, item }) {
  const { getData, setRaw, updateEntry, deleteEntry } = useData();
  // Role-based UI triggers, read from the ERP permission matrix. A View-Only
  // general user holds no write action on Order Management, so the
  // "+ Upload Style Process" button and the uploader form are not rendered at
  // all — the parsed-sheet table below stays visible to every role.
  const permissions = usePermissions();
  // Safe fallbacks, answered "no": a missing permission method must render this page
  // read-only, never throw. FALSE (not true) is deliberate — a resolution failure
  // must not hand a View-Only account the uploader.
  //
  // The uploader is offered when the account may UPLOAD, which the matrix derives from
  // CREATE on Order Management — the same rule as before but named, so a provider that
  // exposes `canUpload` (an approved manager does) is honoured directly. `canCreate`
  // stays as the fallback for a provider that does not define it yet.
  const canUpload = Boolean(
    (typeof permissions?.canUpload === 'function'
      ? permissions.canUpload(MODULE.ORDERS)
      : permissions?.canCreate?.(MODULE.ORDERS)),
  );
  // Edit and Delete are checked independently, so the row actions follow the
  // matrix exactly: a role that may change a sheet but not remove one sees Edit
  // and no Delete.
  const canEditSheet = Boolean(permissions?.canEdit?.(MODULE.ORDERS));
  const canDeleteSheet = Boolean(permissions?.canDelete?.(MODULE.ORDERS));
  const orders = getData(COLLECTIONS.ORDERS);
  const sheets = getData(COLLECTIONS.PROCESS_SHEETS);
  const capacityRecords = getData(CAPACITY_COLLECTION);
  const [restoredGeneratorState] = useState(readGeneratorState);
  const restoredSheet = sheets.find((sheet) => String(sheet.id) === String(restoredGeneratorState.activeSheetId))
    || latestSheetForStyle(sheets, { style: restoredGeneratorState.style });

  const fileRef = useRef(null);
  const [style, setStyle] = useState(restoredGeneratorState.style || restoredSheet?.style || '');
  const [fileName, setFileName] = useState('');
  const [fileKind, setFileKind] = useState('');
  const [parsed, setParsed] = useState([]);
  const [previewPage, setPreviewPage] = useState(0);
  const previewPageSize = 10;
  // The unit the sheet's standard times are written in. Breakdown sheets arrive in
  // both — many state seconds (a 4320 s total) — and the operations are normalised
  // to minutes as they are read, so this is kept only to show the user which unit
  // was understood and to record it on the saved sheet.
  const [smvUnit, setSmvUnit] = useState('minutes');
  // The one field the sequential save check is currently stopped on, as
  // { name, message } — or null when the form is clean. Nothing global: the
  // prompt is shown as a tooltip on THAT field, not as a top banner.
  const [activeError, setActiveError] = useState(null);
  // Re-fires the tooltip animation when Save is pressed again on the same
  // still-empty field (the value has not changed, so React would keep the node).
  const [errorNonce, setErrorNonce] = useState(0);
  const [validationMessage, setValidationMessage] = useState('');
  const [requiredMissing, setRequiredMissing] = useState([]);
  const [notice, setNotice] = useState('');
  // The uploader is COLLAPSED by default: the tab opens on a single button, and
  // the style picker, file input and parsed-rows grid appear only when asked for.
  // Saving closes it again, so the screen returns to its resting state rather
  // than sitting on the sheet that was just saved.
  const [formOpen, setFormOpen] = useState(false);
  // The capacity inputs. Kept in the page rather than the panel so the value
  // survives the panel re-rendering, and so saving reads the same object the
  // panel is displaying.
  const [capacityInput, setCapacityInput] = useState({
    manpower: restoredGeneratorState.manpower ?? restoredSheet?.manpower ?? '',
    workingHours: restoredGeneratorState.workingHours ?? restoredSheet?.workingHours ?? 10,
    efficiency: restoredGeneratorState.efficiency ?? restoredSheet?.efficiency ?? 100,
    targetBuffer: restoredSheet?.targetBuffer ?? '',
  });
  // The percentage buffer applied to every auto-derived target on this sheet —
  // typed in the review grid's "Add Percentage (%)" column. Held on the page (not
  // only on the sheet record) so it survives the save round-trip and is written
  // to BOTH the sheet and the style's capacity record, which is what makes the
  // same percentage reach Hourly Production, Daily Production and Operator
  // Performance without any of them re-typing it.
  const [targetBuffer, setTargetBuffer] = useState('');
  // Which operation on the sheet being edited is the LINE OUTPUT — the process
  // whose summed operator output IS the line's output. Set from the file's own
  // "Line Output" column when it has one (Option A), or chosen in this column's
  // dropdown (Option B). Held on the page so it survives the save round-trip and
  // is written to the sheet, where every screen reads it back.
  const [lineOutputProcess, setLineOutputProcess] = useState('');
  // The garment's TOTAL standard time, as the brief asks for it to be entered —
  // e.g. 72 minutes for a pant. This is the input to the SMV distribution: when the
  // sheet's rows carry no SMV of their own, each operation's time is computed from
  // this total and the row's weight (see `distributeSmvByWeight`). Blank means "use
  // whatever the sheet states per row", which is the behaviour before this feature.
  const [totalGarmentSmv, setTotalGarmentSmv] = useState(restoredGeneratorState.totalSmv ?? restoredSheet?.totalSmv ?? '');
  const [inputProcess, setInputProcess] = useState('');
  const [outputProcess, setOutputProcess] = useState('');
  // Whether the distribution is applied. On by default when a total is given: the
  // brief's whole point is that uploading a total should fill the per-operation SMVs
  // without the user doing arithmetic, so the calculation has to run unless it is
  // explicitly switched off to let a hand-typed SMV column stand.
  const [autoDistribute, setAutoDistribute] = useState(true);
  // Which row of the Uploaded Sheets table is open, and in which mode. One piece
  // of state rather than three booleans, because only one dialog can be open at a
  // time and "view + delete at once" is not a state this screen has.
  const [activeSheet, setActiveSheet] = useState(null);
  const [selectedUploadedSheet, setSelectedUploadedSheet] = useState(restoredSheet || null);
  const [sheetMode, setSheetMode] = useState('');

  useEffect(() => {
    if (!selectedUploadedSheet) return;
    persistGeneratorState(selectedUploadedSheet, capacityInput);
  }, [selectedUploadedSheet, capacityInput]);

  function selectUploadedSheet(sheet) {
    if (!sheet) return;
    selectStyle(sheet.style || sheet.order_no || '');
    setSelectedUploadedSheet(sheet);
    setTotalGarmentSmv(sheet.totalSmv ?? '');
    const settings = {
      manpower: sheet.manpower ?? '',
      workingHours: sheet.workingHours ?? 10,
      efficiency: sheet.efficiency ?? 100,
    };
    setCapacityInput((previous) => ({ ...previous, ...settings }));
    persistGeneratorState(sheet, settings);
  }

  function openSheet(sheet, mode) {
    selectUploadedSheet(sheet);
    setActiveSheet(sheet);
    setSheetMode(mode);
    setNotice('');
  }

  function closeSheet() {
    setActiveSheet(null);
    setSheetMode('');
  }

  /**
   * Writes an edited sheet back into the collection.
   *
   * `updateEntry` is keyed on the row's id, so editing a sheet is a targeted
   * update rather than a whole-collection rewrite — two sheets for different
   * styles cannot clobber each other.
   */
  function saveSheet(updated) {
    const clean = withRecomputedTotals(updated);
    updateEntry(COLLECTIONS.PROCESS_SHEETS, clean.id, clean);
    if (String(selectedUploadedSheet?.id) === String(clean.id)) {
      setSelectedUploadedSheet(clean);
      setStyle(clean.style);
      setTotalGarmentSmv(clean.totalSmv);
      const settings = { manpower: clean.manpower ?? '', workingHours: clean.workingHours ?? 10, efficiency: clean.efficiency ?? 100 };
      setCapacityInput((previous) => ({ ...previous, ...settings }));
      persistGeneratorState(clean, settings);
    }
    if (String(selectedUploadedSheet?.id) === String(clean.id)) {
      setSelectedUploadedSheet(clean);
      setStyle(clean.style);
      setTotalGarmentSmv(clean.totalSmv);
      setCapacityInput((previous) => ({ ...previous, manpower: clean.manpower ?? previous.manpower, workingHours: clean.workingHours ?? previous.workingHours, efficiency: clean.efficiency ?? previous.efficiency }));
      persistGeneratorState(clean, { manpower: clean.manpower, workingHours: clean.workingHours, efficiency: clean.efficiency });
    }
    setNotice(
      `Sheet for ${clean.style} updated — ${(clean.operations || []).length} operations, `
      + `total SMV ${clean.totalSmv} min. The process lists now reflect this.`,
    );
    closeSheet();
  }

  /**
   * Removes a sheet after the confirmation dialog.
   *
   * The operations are gone from every dropdown the moment this returns, because
   * they all read the same collection. A saved capacity for the style is left
   * alone on purpose: it is a separate agreement about manpower and efficiency,
   * and deleting the breakdown does not withdraw it.
   */
  function deleteSheet(sheet) {
    deleteEntry(COLLECTIONS.PROCESS_SHEETS, sheet.id);
    if (String(selectedUploadedSheet?.id) === String(sheet.id)) {
      setSelectedUploadedSheet(null);
      setStyle('');
      setTotalGarmentSmv('');
      setCapacityInput((previous) => ({ ...previous, manpower: '', workingHours: 10, efficiency: 100 }));
      try { window.localStorage.removeItem(GENERATOR_STORAGE_KEY); } catch { /* storage may be unavailable */ }
    }
    setNotice(`Sheet for ${sheet.style} deleted. Its processes are no longer offered.`);
    closeSheet();
  }

  const orderOptions = useMemo(
    () => selectableOrders(orders).map((o) => ({
      value: o.style || o.order_no,
      label: orderLabel(o),
      hint: [o.buyer, o.qty ? `${o.qty} pcs` : ''].filter(Boolean).join(' · '),
    })),
    [orders],
  );

  const selectedOrder = useMemo(
    () => orders.find((o) => String(o.style || '') === String(style)) || null,
    [orders, style],
  );

  // What the process dropdown on Daily Production will offer for this style.
  const existing = useMemo(
    () => operationsForStyle(sheets, { style, order_no: selectedOrder?.order_no }),
    [sheets, style, selectedOrder],
  );

  // The capacity already agreed for this style, so re-opening the sheet shows the
  // manpower and efficiency that were last saved instead of resetting them.
  const savedCapacity = useMemo(
    () => capacityForStyle(capacityRecords, { style, order_no: selectedOrder?.order_no }),
    [capacityRecords, style, selectedOrder],
  );
  const selectedProcessSheet = useMemo(
    () => selectedUploadedSheet && String(selectedUploadedSheet.style || '') === String(style)
      ? selectedUploadedSheet
      : latestSheetForStyle(sheets, { style, order_no: selectedOrder?.order_no }),
    [selectedUploadedSheet, sheets, style, selectedOrder],
  );

  const totalSmv = useMemo(() => totalSmvOf(parsed), [parsed]);

  /**
   * The garment total the user typed, in minutes. 0 when the field is blank.
   */
  const garmentSmv = useMemo(() => readTotalGarmentSmv(totalGarmentSmv), [totalGarmentSmv]);

  /**
   * The rows as they should be SAVED: the parsed rows with each operation's SMV
   * computed from the garment total when the distribution is on.
   *
   * This is the single source the review grid renders from and the save writes, so
   * the figure on screen is the figure in the database. When the distribution is off
   * (or no total was given) this is the parsed rows untouched, which is exactly the
   * previous behaviour — the feature is additive.
   *
   * A row the user has typed an SMV into is never overwritten: `distributeSmvByWeight`
   * leaves stated SMVs alone and only fills the blanks. That is what makes manual
   * fine-tuning possible — the user edits one row, and the other distributed rows
   * keep their computed values until the total itself changes.
   */
  const rows = useMemo(() => {
    if (!autoDistribute || garmentSmv <= 0 || parsed.length === 0) return parsed;
    return distributeSmvByWeight(parsed, garmentSmv);
  }, [parsed, autoDistribute, garmentSmv]);

  /**
   * The weight percentages the distribution would use if the sheet carries none.
   * Shown in the preview's Weight % column as a hint, so the split is visible before
   * a total is typed rather than appearing out of nowhere.
   */
  const fallbackWeights = useMemo(() => defaultWeightsFor(parsed), [parsed]);

  /** The total the SAVED rows add up to — the garment total once distributed. */
  const distributedTotalSmv = useMemo(() => totalSmvOf(rows), [rows]);
  const previewPageCount = Math.max(1, Math.ceil(rows.length / previewPageSize));
  const previewRows = rows.slice(previewPage * previewPageSize, (previewPage + 1) * previewPageSize);

  /**
   * The auto-derived target for ONE row, as the brief's formula states it:
   *
   *   Base Hourly Capacity = 60 / Process SMV
   *   Auto Hourly Target   = Base Hourly Capacity × (1 + buffer% / 100)
   *   Auto Daily Target    = Auto Hourly Target × 10
   *
   * The row's OWN `smv` is used when it has one, otherwise the SMV the
   * distribution just computed for it — so the placeholder is correct whether the
   * figure came from the sheet or from the total garment time. Returns null when
   * the row has no SMV yet (a blank row), so the input shows an empty placeholder
   * rather than "0", which would read as a real target.
   */
  function suggestedTarget(row) {
    const smv = Number(row?.smv) > 0 ? Number(row.smv) : Number(row?.autoSmv) || 0;
    if (smv <= 0) return null;
    return autoTargetForProcess(smv, Number(targetBuffer) || 0).hourlyTarget;
  }

  /**
   * The daily target for one row — the same auto figure ×10, so the preview can
   * state the day's goal beside the hour's without the reader doing the sum.
   */
  function suggestedDailyTarget(row) {
    const smv = Number(row?.smv) > 0 ? Number(row.smv) : Number(row?.autoSmv) || 0;
    if (smv <= 0) return null;
    return autoTargetForProcess(smv, Number(targetBuffer) || 0).dailyTarget;
  }

  /**
   * The operations the capacity panel should price.
   *
   * The rows being edited if there are any — so the panel reacts as operations
   * are added or an SMV corrected — otherwise the sheet already saved for the
   * style, so opening a style shows its existing targets without re-uploading.
   */
  const capacityOperations = selectedUploadedSheet
    ? (selectedUploadedSheet.operations || [])
    : rows.length > 0 ? rows : existing;

  /**
   * The capacity for whatever is in view, computed with the SAME engine the panel
   * beside it uses.
   *
   * Done here rather than read back out of CapacityPanel because the line-balancing
   * section below needs one figure from it — the total SMV — and a child cannot
   * hand a value up to a sibling. Using `calculateCapacity` means the number the
   * two sections work from is derived one way, so they cannot disagree.
   */
  const capacity = useMemo(
    () => calculateCapacity(capacityOperations, capacityInput),
    [capacityOperations, capacityInput],
  );

  /**
   * Loads the saved settings into the inputs when a style is chosen.
   *
   * Called from the style picker's onChange rather than an effect, so the fields
   * are correct on the very first render after a selection instead of flashing the
   * defaults and then correcting themselves.
   */
  function selectStyle(nextStyle) {
    const sameActiveStyle = String(selectedUploadedSheet?.style || '') === String(nextStyle);
    if (!sameActiveStyle) setSelectedUploadedSheet(null);
    setRequiredMissing((missing) => missing.filter((field) => field !== 'style'));
    setValidationMessage('');
    setStyle(nextStyle);
    const saved = capacityForStyle(capacityRecords, { style: nextStyle });
    // An UNSAVED style starts blank, so the sequential check on "Save targets for
    // this style" has a real empty box to prompt for rather than a pre-filled
    // default that would silently pass. A style that already has saved figures
    // shows those instead.
    const savedSheet = latestSheetForStyle(sheets, { style: nextStyle });
    const styleSettings = {
      manpower: savedSheet?.manpower ?? saved?.manpower ?? '',
      workingHours: savedSheet?.workingHours ?? saved?.workingHours ?? 10,
      efficiency: savedSheet?.efficiency ?? saved?.efficiency ?? 100,
      targetBuffer: saved?.targetBuffer ?? savedSheet?.targetBuffer ?? '',
    };
    setCapacityInput(styleSettings);
    setSelectedUploadedSheet(savedSheet || null);
    if (savedSheet) persistGeneratorState(savedSheet, styleSettings);
    setTotalGarmentSmv(savedSheet?.totalSmv ?? '');
    // The sheet's own buffer is the fallback when no capacity record carries one,
    // so re-opening a style shows the percentage that was last agreed for it.
    const sheet = savedSheet;
    setTargetBuffer(
      saved?.targetBuffer !== undefined && saved?.targetBuffer !== null && saved?.targetBuffer !== ''
        ? saved.targetBuffer
        : (sheet?.targetBuffer ?? ''),
    );
    // The line output already designated for this style (from a prior upload or an
    // in-app choice), so re-opening the style shows the current designation rather
    // than a blank radio.
    setLineOutputProcess(sheet?.lineOutputProcess || '');
    setInputProcess(sheet?.inputProcess || '');
    setOutputProcess(sheet?.outputProcess || sheet?.lineOutputProcess || '');
  }

  /**
   * Saves the capacity the panel is showing, against the chosen style.
   *
   * This is the write Daily Production reads. It is an explicit action because the
   * saved figures are what operators are measured against — they must not drift
   * every time the manpower box is nudged while planning.
   */
  function saveCapacity({ settings, capacity }) {
    // The capacity is saved AGAINST a style, so a missing style is the first thing
    // the sequence checks — flagged on the Style / Order field, not a banner.
    if (!style) {
      flagField('style', 'Please select Style/Order');
      return;
    }
    // The percentage buffer typed in the review grid is the authoritative figure
    // for this save; the panel's own field is the fallback when the grid is closed.
    const buffer = Number(targetBuffer) > 0
      ? Number(targetBuffer)
      : (Number(settings?.targetBuffer) > 0 ? Number(settings.targetBuffer) : 0);
    const mergedSettings = { ...settings, targetBuffer: buffer };
    const record = buildCapacityRecord({
      style,
      order_no: selectedOrder?.order_no || '',
      settings: mergedSettings,
      // Re-price with the merged settings so the saved per-process and body targets
      // reflect the buffer, rather than the pre-buffer figures the panel passed up.
      capacity: calculateCapacity(capacityOperations, mergedSettings),
    });
    const others = capacityRecords.filter((r) => String(r.style || '') !== String(style));
    setRaw(CAPACITY_COLLECTION, [...others, record]);
    setCapacityInput(mergedSettings);
    setActiveError(null);
    if (selectedUploadedSheet) {
      const updatedSheet = { ...selectedUploadedSheet, manpower: record.manpower, workingHours: record.workingHours, efficiency: record.efficiency };
      setSelectedUploadedSheet(updatedSheet);
      updateEntry(COLLECTIONS.PROCESS_SHEETS, updatedSheet.id, updatedSheet);
    }
    setNotice(
      `Targets saved for ${style}: ${record.lineDailyTarget} pcs/day at ${record.efficiency}% efficiency `
      + `with ${record.manpower} operators`
      + `${buffer > 0 ? `, plus a ${buffer}% buffer (body target ${record.bodyTarget} pcs)` : ''}. `
      + 'Daily Production will use these.',
    );
  }

  function reset() {
    setParsed([]);
    setPreviewPage(0);
    setRequiredMissing([]);
    setValidationMessage('');
    setFileName('');
    setFileKind('');
    setLineOutputProcess('');
    setInputProcess('');
    setOutputProcess('');
    // The garment total and the distribution toggle go back to their defaults too,
    // so reopening the uploader shows a genuinely blank form rather than the total
    // from the sheet that was just saved.
    setTotalGarmentSmv('');
    setAutoDistribute(true);
    setActiveError(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  /**
   * Flag ONE field and put the cursor in it, so the prompt is actionable rather
   * than merely descriptive. Exactly mirrors OrderInputPage's sequential check:
   * called on save, it flags the first empty field and returns, so nothing else
   * is red-bordered and nothing is saved until that one box is filled.
   */
  function flagField(name, message) {
    setActiveError({ name, message });
    setErrorNonce((n) => n + 1);
    setNotice('');
    window.setTimeout(() => {
      const wrap = document.getElementById(`pu-wrap-${name}`);
      if (!wrap) return;
      wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const control = wrap.querySelector('input, select, textarea, [tabindex]');
      try { control?.focus({ preventScroll: true }); } catch { /* older browsers */ }
    }, 0);
  }

  /** The active flag clears the moment ITS field can be evaluated as fixed. */
  function clearErrorIf(name) {
    setActiveError((prev) => (prev && prev.name === name ? null : prev));
  }

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Choosing a file resolves the Process sheet field, so its flag (if it was
    // the one being prompted for) is dropped.
    clearErrorIf('file');
    setNotice('');
    setFileName(file.name);

    const ext = (file.name.split('.').pop() || '').toLowerCase();
    setFileKind(ext);

    if (ext === 'pdf') {
      // Stored, not parsed. Said plainly, with the manual grid offered instead.
      setParsed([]);
      setNotice('PDF attached. This app cannot read operations out of a PDF, so add the operation rows below and save them against the style.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        if (!sheet) throw new Error('The workbook has no sheets.');
        const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
        const rows = parseOperations(grid);
        // Detected from the sheet as a whole, so one heavy operation in an
        // otherwise minute-based sheet is not mistaken for a change of unit.
        setSmvUnit(detectSmvUnit(rows));
        setParsed(rows);
        setPreviewPage(0);
        // OPTION A: a sheet that carries a "Line Output" column designates the
        // operation itself, so it is announced here and rides on the sheet when
        // saved — no in-app selection needed. A sheet without the column says
        // nothing, and the in-app dropdown (Option B) sets it later.
        const designated = detectLineOutputProcess(rows);
        if (designated) {
          setNotice(`Detected "Line Output" in the sheet — "${designated}" is designated as the line output process. You can change it in the Line Output column below.`);
        }
      } catch (err) {
        // Reported ON the file field, as a tooltip — not a top banner.
        setParsed([]);
        flagField('file', err?.message || 'Could not read that file.');
      }
    };
    reader.onerror = () => flagField('file', 'Could not read that file.');
    reader.readAsArrayBuffer(file);
  }

  /**
   * Drops any active flag the CURRENT rows have now satisfied.
   *
   * Both the Process sheet and the Operations prompt are answered by typing an
   * operation, so once a row carries a name BOTH flags are stale and go. Without
   * this the "Please upload a process sheet" prompt would linger beside a
   * perfectly valid hand-typed sheet until the next save.
   */
  function clearResolvedRowFlags(nextRows) {
    const hasOperation = nextRows.some((r) => String(r.operation || '').trim());
    if (!hasOperation) return;
    setActiveError((prev) => (
      prev && (prev.name === 'operations' || prev.name === 'file') ? null : prev
    ));
  }

  /**
   * Writes one grid cell.
   *
   * The grid renders the DISTRIBUTED rows but edits land on the PARSED rows (the
   * source of truth the distribution reads from). That split is what makes manual
   * fine-tuning work:
   *
   *   SMV    typed → the row now STATES its own time, so `distributeSmvByWeight`
   *                  leaves it alone and re-splits only the remaining rows.
   *   Weight typed → the row's stated SMV is dropped, so the row goes back into the
   *                  split and its SMV is recomputed from the new weight share.
   *   other  typed → a plain field edit; the computed SMV is untouched.
   *
   * Without the weight rule above, typing a percentage would have no effect once a
   * row already carried an SMV, which would make the Weight % column look broken.
   */
  function setCell(index, field, value) {
    // Computed from the rows as they WILL be, so the flag clears on the same
    // keystroke that made the sheet valid.
    setValidationMessage('');
    const next = parsed.map((r, i) => {
      if (i !== index) return r;
      const updated = { ...r, [field]: value };
      // A weight change means "re-split this row from the garment total", so the
      // row's own stated SMV (and the derived figures) are cleared for it. The
      // distributed value then reappears in the grid on the next render.
      if (field === 'weight') {
        delete updated.smv;
        delete updated.autoSmv;
      }
      return updated;
    });
    setParsed(next);
    setValidationMessage('');
    clearResolvedRowFlags(next);
  }

  function addRow() {
    setParsed((rows) => [
      ...rows,
      { operation: '', machine: '', smv: 0, section: '' },
    ]);
    setPreviewPage(Math.floor(parsed.length / previewPageSize));
    clearErrorIf('operations');
  }

  function removeRow(index) {
    setParsed((rows) => {
      const next = rows.filter((_, i) => i !== index);
      const maxPage = Math.max(0, Math.ceil(next.length / previewPageSize) - 1);
      setPreviewPage((page) => Math.min(page, maxPage));
      return next;
    });
  }

  /**
   * Save to Style — SEQUENTIAL, one field at a time.
   *
   * The fields are checked in the order the user meets them (Style / Order, then
   * Process sheet, then Operations). The FIRST one found empty or invalid is
   * flagged with its own tooltip and the function RETURNS — later fields are not
   * looked at, and nothing is saved. Filling that field and saving again moves to
   * the next one in the sequence, so the user is walked through the form a single
   * prompt at a time rather than shown one banner listing every problem.
   */
  function save() {
    setValidationMessage('');
    const missingFields = [];
    const missingNames = [];
    if (!style) { missingFields.push('Style / Order'); missingNames.push('style'); }
    if (!(garmentSmv > 0)) { missingFields.push('Total Garment SMV'); missingNames.push('totalGarmentSmv'); }
    if (!(Number(capacityInput.manpower) > 0)) { missingFields.push('Manpower'); missingNames.push('manpower'); }
    setRequiredMissing(missingNames);
    if (missingFields.length) {
      setValidationMessage(`Please fill all required fields: ${missingFields.join(', ')} before saving to style.`);
      setActiveError(null);
      return;
    }
    const clean = rows
      .map((r) => ({ ...r, operation: String(r.operation || '').trim(), smv: Number(r.smv) || 0 }))
      .filter((r) => r.operation);

    // SEQUENTIAL: Style / Order → Process sheet → Operations. `firstInvalid`
    // returns only the FIRST offending field, so exactly one tooltip is shown.
    // The file rule also accepts typed operations, since a PDF reference with
    // manually entered rows is a valid save.
    const problem = firstInvalid(PROCESS_SHEET_RULES, {
      style,
      file: fileName,
      operationCount: clean.length,
    });
    if (problem) {
      flagField(problem.name, problem.message);
      return;
    }

    setActiveError(null);
    setRequiredMissing([]);
    setValidationMessage('');
    const record = buildProcessSheet({
      style,
      order_no: selectedOrder?.order_no || '',
      fileName,
      operations: clean,
      smvUnit,
      // The garment's total standard time, so the per-operation SMVs can be traced
      // back to the figure they were distributed from — and re-distributed later.
      totalGarmentSmv: garmentSmv,
      manpower: Number(capacityInput.manpower) || 0,
      inputProcess,
      outputProcess: outputProcess || lineOutputProcess,
      lineInputProcess: inputProcess,
      lineOutputProcess: outputProcess || lineOutputProcess,
      workingHours: Number(capacityInput.workingHours) || 10,
      efficiency: Number(capacityInput.efficiency) || 70,
      // The "Add Percentage (%)" figure from the grid rides on the sheet, so every
      // reader of the sheet can apply the same buffer to its auto targets.
      targetBuffer,
    });
    // OPTION A + B: whichever designated the line output — the file's own column
    // (recorded by `buildProcessSheet` via `detectLineOutputProcess`) or the radio
    // chosen in this grid — is written onto the sheet. An in-app choice WINS when
    // one was made, because it is the more recent, deliberate act; otherwise the
    // file's designation stands.
    const chosenLineOutput = String(lineOutputProcess || '').trim() || record.lineOutputProcess || '';
    record.lineOutputProcess = String(outputProcess || chosenLineOutput).trim();
    record.outputProcess = record.lineOutputProcess;
    record.lineInputProcess = String(inputProcess || '').trim();
    record.inputProcess = inputProcess;
    record.manpower = Number(capacityInput.manpower) || 0;
    // setRaw writes through DataContext, which persists every change to storage, so
    // the sheet is global the moment this returns: Hourly Production, Daily
    // Production and Worker Production all read `process-breakdown` through
    // `operationsForStyle`, and will offer these operations on their next render.
    setRaw(COLLECTIONS.PROCESS_SHEETS, [...sheets, record]);
    setSelectedUploadedSheet(null);
    setStyle(record.style);
    const savedLineSettings = { manpower: record.manpower, workingHours: record.workingHours || 10, efficiency: record.efficiency || 100 };
    setCapacityInput((previous) => ({ ...previous, ...savedLineSettings }));
    setSelectedUploadedSheet(record);
    persistGeneratorState(record, savedLineSettings);
    setTotalGarmentSmv(record.totalSmv);
    setCapacityInput((previous) => ({
      ...previous,
      manpower: record.manpower || previous.manpower,
      workingHours: record.workingHours || 10,
      efficiency: record.efficiency || 100,
    }));
    // The buffer is also folded into the style's capacity record, because that is
    // what Hourly Production and Daily Production read when they derive a target.
    // Written only when the style already has saved figures — an unsaved style gets
    // its capacity when "Save targets for this style" is pressed.
    const savedCapacity = capacityForStyle(capacityRecords, { style });
    if (savedCapacity) {
      const merged = { ...savedCapacity, targetBuffer: Number(targetBuffer) > 0 ? Number(targetBuffer) : 0 };
      setRaw(CAPACITY_COLLECTION, [
        ...capacityRecords.filter((r) => String(r.style || '') !== String(style)),
        merged,
      ]);
    }
    setNotice(
      `Saved ${clean.length} operations for ${style} (total SMV ${record.totalSmv} min`
      + `${record.smvUnit === 'seconds' ? `, from ${record.totalSmvSeconds} s` : ''}). `
      + `${Number(targetBuffer) > 0 ? `A ${Number(targetBuffer)}% target buffer was applied. ` : ''}`
      + `${record.lineOutputProcess ? `Line output process: ${record.lineOutputProcess}. ` : ''}`
      + 'They are now selectable on Hourly Production and Daily Production Entry.',
    );
    // Clears the style, the file and the parsed rows, then closes the form so
    // the tab returns to its resting state. `reset` runs first so reopening
    // shows a blank uploader rather than the sheet that was just saved.
    reset();
    setFormOpen(false);
  }

  function discard() {
    reset();
    setActiveError(null);
    setValidationMessage('');
    setRequiredMissing([]);
    setNotice('');
  }

  return (
    <div className="module">
      <div className="module-header">
        <div className="breadcrumb">{category.icon} {category.label}</div>
        <h2 style={{ margin: 0 }}>{item.icon} {item.label}</h2>
        <p className="hint" style={{ maxWidth: '80ch' }}>
          Upload the Operation Breakdown / SMV sheet for a style. The operations are linked to that
          style and become the choices in the Operation dropdown on Daily Production Entry. Excel and
          CSV are parsed automatically; a PDF is stored with the style for reference and its operations
          can be typed in the grid below.
        </p>
      </div>

      {notice && <div className="erp-notice erp-notice-success dp-notice">{notice}</div>}

      {/* The resting state: one button, hidden once the uploader is open because
          the form carries its own Save/Discard actions. Only rendered for a role
          that may create a sheet — a View-Only user never sees it. */}
      {canUpload && !formOpen && (
        <div className="module-actions">
          <button type="button" className="btn btn-primary" onClick={() => { setActiveError(null); setNotice(''); setFormOpen(true); }}>
            + Upload Style Process
          </button>
        </div>
      )}

      {canUpload && formOpen && (
        <div className="dp-entry-card pu-upload-card">
          <div className="dp-detail-grid" style={{ marginBottom: 14 }}>
            <div
              className={`form-field pu-field${activeError?.name === 'style' || requiredMissing.includes('style') ? ' has-error' : ''}`}
              id="pu-wrap-style"
            >
              <span>Style / Order <em className="req-star">*</em></span>
              <SearchableSelect
                value={style}
                onChange={selectStyle}
                className={requiredMissing.includes('style') ? 'pu-required-invalid' : ''}
                options={orderOptions}
                placeholder="Search style or order no…"
                emptyMessage="No orders yet — register one in Order Input first"
                ariaLabel="Select the style this sheet belongs to"
              />
              {activeError?.name === 'style' && (
                <span className="oi-tooltip" role="alert" aria-live="assertive" key={`style-${errorNonce}`}>
                  <span aria-hidden="true">⚠</span>{activeError.message}
                </span>
              )}
            </div>
            <div
              className={`form-field pu-field pu-file-field${activeError?.name === 'file' ? ' has-error' : ''}`}
              id="pu-wrap-file"
            >
              <span>Process sheet (.xlsx / .xls / .csv / .pdf)</span>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv,.pdf"
                onChange={handleFile}
                aria-invalid={activeError?.name === 'file' ? true : undefined}
              />
              {activeError?.name === 'file' && (
                <span className="oi-tooltip" role="alert" aria-live="assertive" key={`file-${errorNonce}`}>
                  <span aria-hidden="true">⚠</span>{activeError.message}
                </span>
              )}
            </div>
            <div className={`form-field pu-field pu-smv-field${requiredMissing.includes('totalGarmentSmv') ? ' has-error' : ''}`} id="pu-wrap-totalgarmentsmv">
              {/* Distribute the garment's total standard time across operations using
                  each row's weight or the built-in process complexity weights. */}
              <span>Total Garment SMV (min)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                className={requiredMissing.includes('totalGarmentSmv') ? 'pu-required-invalid' : ''}
                value={totalGarmentSmv}
                aria-invalid={requiredMissing.includes('totalGarmentSmv') || undefined}
                onChange={(e) => { setTotalGarmentSmv(e.target.value); setRequiredMissing((missing) => missing.filter((field) => field !== 'totalGarmentSmv')); setValidationMessage(''); setActiveError(null); }}
                placeholder="72"
                aria-label="Total Garment SMV in minutes"
                title="The garment's total standard time. Used to distribute operation SMVs when the file does not provide them."
              />
              {garmentSmv > 0 && (
                <span className="hint pu-distribute-note">
                  Distributed {garmentSmv} min across {parsed.length} operation{parsed.length === 1 ? '' : 's'}.
                </span>
              )}
            </div>
            <div className={`form-field pu-manpower-field${activeError?.name === 'manpower' || requiredMissing.includes('manpower') ? ' has-error' : ''}`} id="pu-wrap-manpower">
              <span>Manpower</span>
              <input
                type="number"
                min="0"
                step="1"
                className={requiredMissing.includes('manpower') ? 'pu-required-invalid' : ''}
                value={capacityInput.manpower}
                aria-invalid={requiredMissing.includes('manpower') || undefined}
                onChange={(e) => { setCapacityInput((prev) => ({ ...prev, manpower: e.target.value })); setRequiredMissing((missing) => missing.filter((field) => field !== 'manpower')); setValidationMessage(''); setActiveError(null); }}
                placeholder="e.g. 25"
                aria-label="Manpower"
              />
            </div>
            <div className="form-field pu-auto-distribute-field">
              <span>SMV distribution</span>
              <label className="pu-auto-distribute" title="Distribute total garment SMV across operations by weight">
                <input
                  type="checkbox"
                  checked={autoDistribute}
                  onChange={(e) => setAutoDistribute(e.target.checked)}
                />
                Auto-distribute by weight
              </label>
            </div>
          </div>

          {selectedOrder && (
            <p className="hint" style={{ marginTop: -4 }}>
              {selectedOrder.buyer ? `${selectedOrder.buyer} · ` : ''}
              {selectedOrder.item ? `${selectedOrder.item} · ` : ''}
              {selectedOrder.qty ? `${selectedOrder.qty} pcs` : ''}
            </p>
          )}

          {/* Review grid. Shown for both file kinds — the parsed rows for a
              spreadsheet, an empty grid to fill in for a PDF. */}
          {(parsed.length > 0 || fileKind === 'pdf' || fileKind === '') && (
            <>
              <div className="dp-entry-metrics">
                <div className="dp-metric">
                  <span className="dp-metric-label">Hourly Target</span>
                  <span className="dp-metric-value">{capacity.line.hourlyTarget} pcs/hr</span>
                </div>
                <div className="dp-metric">
                  <span className="dp-metric-label">Daily Target</span>
                  <span className="dp-metric-value">{capacity.line.dailyTarget} pcs/day</span>
                </div>
                <div className="dp-metric">
                  <span className="dp-metric-label">Monthly Target</span>
                  <span className="dp-metric-value">{capacity.line.dailyTarget * 26} pcs/month</span>
                </div>
                <div className="dp-metric">
                  <span className="dp-metric-label">Operations ready</span>
                  <span className="dp-metric-value">{rows.filter((r) => String(r.operation || '').trim()).length}</span>
                </div>
                <div className="dp-metric">
                  <span className="dp-metric-label">Total SMV</span>
                  <span className="dp-metric-value">
                    {distributedTotalSmv}
                    {smvUnit === 'seconds' && (
                      <span className="pu-unit-note"> min (from {Math.round(totalSmv * 60 * 100) / 100} s)</span>
                    )}
                  </span>
                </div>
                {/* The garment total the per-operation SMVs were distributed FROM, so
                    the split is traceable back to the figure that produced it. */}
                {garmentSmv > 0 && (
                  <div className="dp-metric">
                    <span className="dp-metric-label">Garment SMV</span>
                    <span className="dp-metric-value">
                      {garmentSmv} min
                      {Math.abs(distributedTotalSmv - garmentSmv) > 0.01 && (
                        <span className="pu-unit-note"> → {distributedTotalSmv} min</span>
                      )}
                    </span>
                  </div>
                )}
                <div className="dp-metric">
                  <span className="dp-metric-label">Source</span>
                  <span className="dp-metric-value" style={{ fontSize: 13 }}>{fileName || 'no file'}</span>
                </div>
              </div>

              <div className="table-wrap pu-preview-table-wrap">
                <table className="dp-table">
                  <thead>
                    <tr>
                      <th>#</th><th>Operation</th><th>Machine</th><th>Section</th>
                      <th>Weight %</th>
                      <th>Process SMV</th>
                      <th>Base Hr Cap</th>
                      <th>Hr Target</th>
                      <th>Daily Target</th>
                      <th>Monthly Target</th>
                      <th>Manpower</th>
                      <th>Add Percentage (%)</th>
                      <th>Manual Target</th>
                      <th>Line Output</th>
                      <th><span className="sr-only">Row actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                            {previewRows.length === 0 && (
                      <tr>
                        <td colSpan={15} className="empty-row">
                          {fileKind === 'pdf'
                            ? 'Add the operation rows below, or save the PDF as a reference only.'
                            : 'Upload a sheet, or add rows by hand.'}
                        </td>
                      </tr>
                    )}
                    {previewRows.map((r, pageIndex) => {
              const i = previewPage * previewPageSize + pageIndex;
              return (
                      <tr key={i}>
                        <td className="mono-cell">{i + 1}</td>
                        <td>
                          <input className="dp-remark-input" value={r.operation || ''}
                            onChange={(e) => setCell(i, 'operation', e.target.value)} placeholder="Collar Attach" />
                        </td>
                        <td>
                          <input className="dp-remark-input" value={r.machine || ''}
                            onChange={(e) => setCell(i, 'machine', e.target.value)} placeholder="Overlock" />
                        </td>
                        <td>
                          <input className="dp-remark-input" value={r.section || ''}
                            onChange={(e) => setCell(i, 'section', e.target.value)} placeholder="Front" />
                        </td>
                        <td>
                          {/* WEIGHT % — the row's share of the garment total. A figure the
                              sheet carried, or one the distribution resolved. Shown as a
                              placeholder when the split used the predefined complexity
                              weights, so the percentage in force is always visible and can
                              be overridden by typing. */}
                          <input
                            type="number"
                            className="dp-hour-input"
                            min="0"
                            step="0.01"
                            value={r.weight ?? ''}
                            onChange={(e) => setCell(i, 'weight', e.target.value)}
                            placeholder={String(
                              r.weightPercent
                              ?? fallbackWeights[i]?.percent
                              ?? '',
                            )}
                            title="This operation's share of the garment total. Leave blank to use the predefined complexity weight shown as a placeholder."
                            aria-label={`Weight percent for ${r.operation || `row ${i + 1}`}`}
                          />
                        </td>
                        <td>
                          {/* PROCESS SMV — computed from the total garment time and the
                              weight when the sheet left it blank (shown as a placeholder),
                              or the sheet's own figure when it stated one. Typing here
                              fine-tunes this row and re-derives its targets instantly. */}
                          <input
                            type="number"
                            className="dp-hour-input"
                            min="0"
                            step="0.01"
                            value={r.smv ?? ''}
                            onChange={(e) => setCell(i, 'smv', e.target.value)}
                            placeholder={String(r.autoSmv ?? '0')}
                            title="Process SMV in minutes. Distributed from the total garment SMV when the sheet left it blank."
                            aria-label={`Process SMV for ${r.operation || `row ${i + 1}`}`}
                          />
                        </td>
                        <td className="mono-cell ps-computed">
                          {(() => { const smv = Number(r.smv) > 0 ? Number(r.smv) : Number(r.autoSmv) || 0; return smv ? Math.round((60 / smv) * 100) / 100 : '—'; })()}
                        </td>
                        <td className="mono-cell ps-computed">
                          {suggestedTarget(r) ?? '—'}
                        </td>
                        <td className="mono-cell ps-computed">
                          {suggestedDailyTarget(r) ?? '—'}
                        </td>
                        <td className="mono-cell ps-computed">
                          {suggestedDailyTarget(r) !== null ? suggestedDailyTarget(r) * 26 : '—'}
                        </td>
                        <td className="mono-cell ps-computed">{capacityInput.manpower || '—'}</td>
                        <td className="mono-cell ps-computed">{Number(targetBuffer) || 0}%</td>
                        <td>
                          {/* Per-operation TARGET override. The buffered auto target is
                              computed for every row and shown in the Hr Target column
                              above; typing here replaces it for this row only. */}
                          <input
                            type="number"
                            className="dp-hour-input"
                            min="0"
                            value={r.target ?? ''}
                            onChange={(e) => setCell(i, 'target', e.target.value)}
                            placeholder={String(suggestedTarget(r) ?? '')}
                            title="Target pieces for this operation. Leave blank to use the buffered auto target shown as a placeholder."
                            aria-label={`Target for ${r.operation || `row ${i + 1}`}`}
                          />
                        </td>
                        <td className="ps-line-output-cell">
                          {/* OPTION B: designate the line output operation in-app.
                              A radio per row, so exactly ONE operation is the line
                              output — a line has one total-output operation. The
                              value is the operation's name, which is what the sheet
                              stores as `lineOutputProcess`. */}
                          <label className="ps-line-radio" title="Set this operation as the line output">
                            <input
                              type="radio"
                              name="line-output-process"
                              checked={String(lineOutputProcess || '').toLowerCase() === String(r.operation || '').trim().toLowerCase() && String(r.operation || '').trim() !== ''}
                              disabled={!String(r.operation || '').trim()}
                              onChange={() => setLineOutputProcess(String(r.operation || '').trim())}
                              aria-label={`Set ${r.operation || 'this operation'} as the line output`}
                            />
                          </label>
                        </td>
                        <td>
                          <button className="btn-icon" title="Remove this row" onClick={() => removeRow(i)}>🗑️</button>
                        </td>
                      </tr>
              );
            })}
                  </tbody>
                </table>
              </div>

                  {rows.length > previewPageSize && (
                <nav className="pu-pagination" aria-label="Process preview pagination">
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setPreviewPage((page) => Math.max(0, page - 1))} disabled={previewPage === 0}>Previous</button>
                  <span>Page {previewPage + 1} of {previewPageCount} · {rows.length} rows</span>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setPreviewPage((page) => Math.min(previewPageCount - 1, page + 1))} disabled={previewPage >= previewPageCount - 1}>Next</button>
                </nav>
              )}
              {validationMessage && <div className="pu-validation-alert" role="alert">{validationMessage}</div>}
              <div className="form-actions pu-upload-actions">
                <div className="pu-ops-field">
                  <button type="button" className="btn btn-outline btn-sm" onClick={addRow}>+ Add Row</button>
                  {activeError?.name === 'operations' && (
                    <span className="oi-tooltip" role="alert" aria-live="assertive" key={`ops-${errorNonce}`}>
                      <span aria-hidden="true">⚠</span>{activeError.message}
                    </span>
                  )}
                </div>
                <button type="button" className="btn btn-primary" onClick={save}>Save to Style</button>
                <button type="button" className="btn btn-outline" onClick={() => { discard(); setFormOpen(false); }}>Discard</button>
              </div>
            </>
          )}

          {existing.length > 0 && (
            <p className="hint" style={{ marginTop: 12 }}>
              {style} already has {existing.length} operation{existing.length === 1 ? '' : 's'} saved
              ({existing.map((o) => o.operation).slice(0, 6).join(', ')}
              {existing.length > 6 ? ', …' : ''}). Saving a new sheet replaces them.
            </p>
          )}
        </div>
      )}

      {/* ---- 2. Capacity & target calculation ----
          Sits directly under the sheet, because the targets are derived FROM it.
          It prices whatever operations are currently in view: the rows being
          edited if there are any, otherwise the sheet already saved for the
          chosen style — so opening a style shows its targets without re-uploading. */}
      <div className="dp-entry-card">
        {!style && existing.length === 0 && parsed.length === 0 ? (
          <p className="hint" style={{ margin: 0 }}>
            Pick a style above to calculate its capacity, or upload a process sheet to derive it.
          </p>
        ) : (
          <CapacityPanel
            operations={capacityOperations}
            settings={{ ...capacityInput, targetBuffer }}
            // Editing the buffer in the panel updates the same state the review
            // grid's "Add Percentage (%)" column writes, so the two controls can
            // never disagree about the percentage in force.
            onSettingsChange={(next) => {
              setCapacityInput(next);
              if (next.targetBuffer !== undefined) setTargetBuffer(next.targetBuffer);
            }}
            onSave={saveCapacity}
            savedAt={savedCapacity?.savedAt}
            canSave={canEditSheet}
            readOnly={!canEditSheet}
          />
        )}
      </div>

      {/* ---- 3. Line balancing & target generator ----
          The planning companion to the panel above: the same sheet's total SMV,
          read the way a line is balanced from it — how many operators the work
          divides into and what each one carries. It sits directly under the
          capacity figures so the two are read together, and it opens on the
          capacity inputs already in force rather than resetting to its own
          defaults — otherwise the two would silently plan different lines. */}
      <LineBalancingSection
        key={selectedProcessSheet?.id || style || 'line-balancing'}
        activeSheetId={selectedProcessSheet?.id || ''}
        activeStyle={style || selectedProcessSheet?.style || ''}
        totalSMV={selectedUploadedSheet?.totalSmv ?? (rows.length > 0 ? distributedTotalSmv : (selectedProcessSheet?.totalSmv ?? totalGarmentSmv ?? capacity.totalSmv))}
        operationsList={capacityOperations}
        smvUnit={selectedProcessSheet?.smvUnit || savedCapacity?.smvUnit}
        defaults={{ ...capacityInput, manpower: capacityInput.manpower, workingHours: capacityInput.workingHours || 10, efficiency: capacityInput.efficiency || 100 }}
        readOnly={!canEditSheet}
      />

      <h3 className="dp-recent-title" style={{ marginTop: 22 }}>Uploaded sheets ({sheets.length})</h3>
      <div className="table-wrap" style={{ marginTop: 10 }}>
        <table className="dp-table">
          <thead>
            <tr>
              <th>Style</th><th>Order No</th><th>File</th><th>Operations</th><th>Total SMV</th>
              <th>Hourly Target</th><th>Daily Target</th><th>Available Minutes</th><th>Monthly Target</th><th>Manpower</th><th>Uploaded</th><th><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {sheets.length === 0 && (
              <tr><td colSpan={12} className="empty-row">No process sheets uploaded yet.</td></tr>
            )}
            {sheets.map((r) => (
              <tr key={r.id} onClick={() => selectUploadedSheet(r)} className={String(selectedUploadedSheet?.id || '') === String(r.id) ? 'ps-selected-sheet-row' : undefined} title="Select this process sheet for line balancing">
                <td className="mono-cell">{r.style}</td>
                <td className="mono-cell">{r.order_no || '—'}</td>
                <td>{r.fileName || '—'}</td>
                <td className="mono-cell">{(r.operations || []).length}</td>
                <td className="mono-cell">{r.totalSmv ?? '—'}</td>
                <td className="mono-cell">{r.manpower && r.totalSmv ? Math.floor((Number(r.manpower) * (Number(r.workingHours) || 10) * 60 * ((Number(r.efficiency) || 100) / 100)) / (Number(r.totalSmv) || 1) / (Number(r.workingHours) || 10)) : '—'}</td>
                <td className="mono-cell">{r.manpower && r.totalSmv ? calculateCapacity(r.operations || [], { manpower: r.manpower, workingHours: r.workingHours || 10, efficiency: r.efficiency || 100 }).line.dailyTarget : '—'}</td>
                <td className="mono-cell">{r.manpower ? Math.floor((Number(r.manpower) || 0) * (Number(r.workingHours) || 10) * 60 * ((Number(r.efficiency) || 100) / 100)) : '—'}</td>
                <td className="mono-cell">{r.operations?.length && r.manpower && r.totalSmv ? Math.floor((Number(r.manpower) || 1) * (Number(r.workingHours) || 10) * 60 * 26 * ((Number(r.efficiency) || 100) / 100) / (Number(r.totalSmv) || 1) * (1 + (Number(r.targetBuffer) || 0) / 100)) : '—'}</td>
                <td className="mono-cell">{r.manpower ?? '—'}</td>
                <td className="mono-cell">{r.uploadedAt || '—'}</td>
                <td>
                  <div className="ps-row-actions">
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={() => openSheet(r, 'view')}
                      title="View the operations on this sheet"
                    >
                      View
                    </button>
                    {canEditSheet && (
                      <>
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          onClick={() => openSheet(r, 'edit')}
                          title="Change the style or file this sheet is saved against"
                        >
                          Edit
                        </button>
                        {canDeleteSheet && (
                          <button
                            type="button"
                            className="btn btn-outline btn-sm ps-btn-delete"
                            onClick={() => openSheet(r, 'delete')}
                            title="Delete this sheet"
                          >
                            Delete
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* View / Edit / Delete for the row that was clicked. Mounted once, outside
          the table, so the table stays a plain list and the dialog owns its own
          draft — edits only reach the store when Save is pressed. */}
      <ProcessSheetModals
        sheet={activeSheet}
        mode={sheetMode}
        orders={orders}
        isAdmin={canEditSheet}
        onClose={closeSheet}
        onSaveSheet={saveSheet}
        onDelete={deleteSheet}
      />
    </div>
  );
}
