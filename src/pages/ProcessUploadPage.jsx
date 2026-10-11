import React, { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { useData } from '../context/DataContext';
import { useRole } from '../context/RoleContext';
import SearchableSelect from '../components/SearchableSelect';
import {
  COLLECTIONS,
  parseOperations,
  totalSmvOf,
  buildProcessSheet,
  operationsForStyle,
  selectableOrders,
  orderLabel,
} from '../config/orderWorkflow';
import CapacityPanel from '../components/CapacityPanel';
import {
  CAPACITY_COLLECTION,
  DEFAULT_WORKING_HOURS,
  DEFAULT_EFFICIENCY,
  buildCapacityRecord,
  capacityForStyle,
} from '../config/smvTargetEngine';

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
export default function ProcessUploadPage({ category, item }) {
  const { getData, setRaw } = useData();
  const { isAdmin } = useRole();
  const orders = getData(COLLECTIONS.ORDERS);
  const sheets = getData(COLLECTIONS.PROCESS_SHEETS);
  const capacityRecords = getData(CAPACITY_COLLECTION);

  const fileRef = useRef(null);
  const [style, setStyle] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileKind, setFileKind] = useState('');
  const [parsed, setParsed] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // The capacity inputs. Kept in the page rather than the panel so the value
  // survives the panel re-rendering, and so saving reads the same object the
  // panel is displaying.
  const [capacityInput, setCapacityInput] = useState({
    manpower: '',
    workingHours: DEFAULT_WORKING_HOURS,
    efficiency: DEFAULT_EFFICIENCY,
  });

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

  const totalSmv = useMemo(() => totalSmvOf(parsed), [parsed]);

  /**
   * The operations the capacity panel should price.
   *
   * The rows being edited if there are any — so the panel reacts as operations
   * are added or an SMV corrected — otherwise the sheet already saved for the
   * style, so opening a style shows its existing targets without re-uploading.
   */
  const capacityOperations = parsed.length > 0 ? parsed : existing;

  /**
   * Loads the saved settings into the inputs when a style is chosen.
   *
   * Called from the style picker's onChange rather than an effect, so the fields
   * are correct on the very first render after a selection instead of flashing the
   * defaults and then correcting themselves.
   */
  function selectStyle(nextStyle) {
    setStyle(nextStyle);
    const saved = capacityForStyle(capacityRecords, { style: nextStyle });
    setCapacityInput({
      manpower: saved?.manpower ?? '',
      workingHours: saved?.workingHours ?? DEFAULT_WORKING_HOURS,
      efficiency: saved?.efficiency ?? DEFAULT_EFFICIENCY,
    });
  }

  /**
   * Saves the capacity the panel is showing, against the chosen style.
   *
   * This is the write Daily Production reads. It is an explicit action because the
   * saved figures are what operators are measured against — they must not drift
   * every time the manpower box is nudged while planning.
   */
  function saveCapacity({ settings, capacity }) {
    if (!style) {
      setError('Pick the style these targets belong to.');
      return;
    }
    const record = buildCapacityRecord({
      style,
      order_no: selectedOrder?.order_no || '',
      settings,
      capacity,
    });
    const others = capacityRecords.filter((r) => String(r.style || '') !== String(style));
    setRaw(CAPACITY_COLLECTION, [...others, record]);
    setError('');
    setNotice(
      `Targets saved for ${style}: ${record.lineDailyTarget} pcs/day at ${record.efficiency}% efficiency `
      + `with ${record.manpower} operators. Daily Production will use these.`,
    );
  }

  function reset() {
    setParsed([]);
    setFileName('');
    setFileKind('');
    setError('');
    if (fileRef.current) fileRef.current.value = '';
  }

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
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
        setParsed(parseOperations(grid));
      } catch (err) {
        setParsed([]);
        setError(err?.message || 'Could not read that file.');
      }
    };
    reader.onerror = () => setError('Could not read that file.');
    reader.readAsArrayBuffer(file);
  }

  function setCell(index, field, value) {
    setParsed((rows) => rows.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  }

  function addRow() {
    setParsed((rows) => [...rows, { operation: '', machine: '', smv: 0, section: '' }]);
  }

  function removeRow(index) {
    setParsed((rows) => rows.filter((_, i) => i !== index));
  }

  function save() {
    setError('');
    if (!style) {
      setError('Pick the style this sheet belongs to — the operations are linked through it.');
      return;
    }
    const clean = parsed
      .map((r) => ({ ...r, operation: String(r.operation || '').trim(), smv: Number(r.smv) || 0 }))
      .filter((r) => r.operation);
    if (clean.length === 0) {
      setError('No operations to save. Upload a sheet with an Operation column, or add rows by hand.');
      return;
    }
    const record = buildProcessSheet({
      style,
      order_no: selectedOrder?.order_no || '',
      fileName,
      operations: clean,
    });
    setRaw(COLLECTIONS.PROCESS_SHEETS, [...sheets, record]);
    setNotice(`Saved ${clean.length} operations for ${style} (total SMV ${record.totalSmv}). They are now selectable on Daily Production Entry.`);
    reset();
  }

  function discard() {
    reset();
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
      {error && <div className="erp-notice erp-notice-error dp-notice">{error}</div>}

      {isAdmin && (
        <div className="dp-entry-card">
          <div className="dp-detail-grid" style={{ marginBottom: 14 }}>
            <label className="form-field">
              <span>Style / Order <em className="req-star">*</em></span>
              <SearchableSelect
                value={style}
                onChange={selectStyle}
                options={orderOptions}
                placeholder="Search style or order no…"
                emptyMessage="No orders yet — register one in Order Input first"
                ariaLabel="Select the style this sheet belongs to"
              />
            </label>
            <label className="form-field" style={{ gridColumn: 'span 2' }}>
              <span>Process sheet (.xlsx / .xls / .csv / .pdf)</span>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.pdf" onChange={handleFile} />
            </label>
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
                  <span className="dp-metric-label">Operations ready</span>
                  <span className="dp-metric-value">{parsed.filter((r) => String(r.operation || '').trim()).length}</span>
                </div>
                <div className="dp-metric">
                  <span className="dp-metric-label">Total SMV</span>
                  <span className="dp-metric-value">{totalSmv}</span>
                </div>
                <div className="dp-metric">
                  <span className="dp-metric-label">Source</span>
                  <span className="dp-metric-value" style={{ fontSize: 13 }}>{fileName || 'no file'}</span>
                </div>
              </div>

              <div className="table-wrap">
                <table className="dp-table">
                  <thead>
                    <tr>
                      <th>#</th><th>Operation</th><th>Machine</th><th>Section</th><th>SMV</th>
                      <th><span className="sr-only">Row actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.length === 0 && (
                      <tr>
                        <td colSpan={6} className="empty-row">
                          {fileKind === 'pdf'
                            ? 'Add the operation rows below, or save the PDF as a reference only.'
                            : 'Upload a sheet, or add rows by hand.'}
                        </td>
                      </tr>
                    )}
                    {parsed.map((r, i) => (
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
                          <input type="number" className="dp-hour-input" value={r.smv ?? ''}
                            onChange={(e) => setCell(i, 'smv', e.target.value)} placeholder="0" />
                        </td>
                        <td>
                          <button className="btn-icon" title="Remove this row" onClick={() => removeRow(i)}>🗑️</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="form-actions">
                <button type="button" className="btn btn-outline btn-sm" onClick={addRow}>+ Add Row</button>
                <button type="button" className="btn btn-primary" onClick={save}>Save to Style</button>
                <button type="button" className="btn btn-outline" onClick={discard}>Discard</button>
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
            settings={capacityInput}
            onSettingsChange={setCapacityInput}
            onSave={saveCapacity}
            savedAt={savedCapacity?.savedAt}
            canSave={isAdmin}
            readOnly={!isAdmin}
          />
        )}
      </div>

      <h3 className="dp-recent-title" style={{ marginTop: 22 }}>Uploaded sheets ({sheets.length})</h3>
      <div className="table-wrap" style={{ marginTop: 10 }}>
        <table className="dp-table">
          <thead>
            <tr><th>Style</th><th>Order No</th><th>File</th><th>Operations</th><th>Total SMV</th><th>Uploaded</th></tr>
          </thead>
          <tbody>
            {sheets.length === 0 && (
              <tr><td colSpan={6} className="empty-row">No process sheets uploaded yet.</td></tr>
            )}
            {sheets.map((r) => (
              <tr key={r.id}>
                <td className="mono-cell">{r.style}</td>
                <td className="mono-cell">{r.order_no || '—'}</td>
                <td>{r.fileName || '—'}</td>
                <td className="mono-cell">{(r.operations || []).length}</td>
                <td className="mono-cell">{r.totalSmv ?? '—'}</td>
                <td className="mono-cell">{r.uploadedAt || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
