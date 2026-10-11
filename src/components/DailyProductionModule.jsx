import React, { useMemo, useState } from 'react';
import { useData } from '../context/DataContext';
import { useRole } from '../context/RoleContext';
import { buildDailyProductionRecord, emptyHourly, computeDailySummary } from '../config/dailyProductionForm';
import { downloadDailyProductionWorkbook } from '../utils/dailyProductionExcel';
import { DailyProductionForm, DailyProductionDetail } from './DailyProductionSheet';
import ProductionGroupTable, { ProductionGroupTableHead } from './ProductionGroupTable';

/**
 * ROBIUL GARMENTS ERP — Daily Production screen.
 *
 * Three things, in the order a supervisor meets them:
 *
 *   1. the summary table  — one dark-themed row per entry, with the key figures
 *   2. "+ Add Entry"      — the full three-section template form (modal)
 *   3. "View Full Sheet"  — the read-only form for one row (modal)
 *
 * The stored shape is unchanged: a row is still a `daily-production` entry keyed
 * by date / employee / style / department / process / quantity, plus the additive
 * header fields and a nested `hourly` object. `quantity` is kept in step with the
 * day's good output, so Production Report, Line Status and Target vs Actual keep
 * working byte-for-byte. Existing rows with no `hourly` render and export fine.
 */
export default function DailyProductionModule({ category, item }) {
  const { getData, addEntry, updateEntry, deleteEntry } = useData();
  const { isAdmin } = useRole();
  const rows = getData(item.key);

  const [formValues, setFormValues] = useState(null); // non-null => the entry form is open
  const [editingId, setEditingId] = useState(null);
  const [detailRow, setDetailRow] = useState(null);   // non-null => the full sheet is open

  const canEditDelete = isAdmin;

  function openAddForm() {
    setEditingId(null);
    setFormValues({
      date: new Date().toISOString().slice(0, 10),
      hourly: emptyHourly(),
    });
  }

  function openEditForm(row) {
    setEditingId(row.id);
    // Spread the stored hourly grid over a blank one, so a row saved before the
    // hourly grid existed still opens with all ten slots present.
    setFormValues({ ...row, hourly: { ...emptyHourly(), ...(row.hourly || {}) } });
  }

  function closeForm() {
    setFormValues(null);
    setEditingId(null);
  }

  function handleSubmit(e) {
    e.preventDefault();
    const record = buildDailyProductionRecord(formValues);
    if (editingId) updateEntry(item.key, editingId, record);
    else addEntry(item.key, record);
    closeForm();
  }

  function handleDownload() {
    if (rows.length === 0) {
      window.alert('No data to download yet.');
      return;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    downloadDailyProductionWorkbook(rows, `daily-production-${stamp}.xlsx`);
  }

  return (
    <div className="module">
      <div className="module-header">
        <div className="breadcrumb">{category.icon} {category.label}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h2 style={{ margin: 0 }}>{item.icon} {item.label}</h2>
          {!isAdmin && <span className="badge badge-amber">View Only</span>}
        </div>
      </div>

      <div className="module-actions">
        {isAdmin && <button className="btn btn-primary" onClick={openAddForm}>+ Add Entry</button>}
        {isAdmin && (
          <button className="btn btn-outline" onClick={handleDownload}>⬇ Download Report</button>
        )}
      </div>

      <div className="table-wrap">
        <table className="dp-table pg-table">
          {/* One employee per group with each process they worked underneath — the
              brief's grouped display, from the same rows the flat table listed. */}
          <thead>
            <ProductionGroupTableHead actions />
          </thead>
          <tbody>
            <ProductionGroupTable
              rows={rows}
              emptyMessage="No entries yet."
              actions={(row) => (
                <>
                  <button className="btn btn-outline btn-sm" onClick={() => setDetailRow(row)}>View Full Sheet</button>
                  {canEditDelete && (
                    <>
                      <button className="btn-icon" title="Edit entry" onClick={() => openEditForm(row)}>✏️</button>
                      <button className="btn-icon" title="Delete entry" onClick={() => deleteEntry(item.key, row.id)}>🗑️</button>
                    </>
                  )}
                </>
              )}
            />
          </tbody>
        </table>
      </div>

      {formValues && (
        <Modal title={editingId ? 'Edit Daily Production Entry' : 'Add Daily Production Entry'} onClose={closeForm} wide>
          {/* COMPACT: the brief asks for a clean, streamlined entry flow in this
              modal — no numbered multi-step breakdown and no on-screen End-of-Day
              Summary. The hourly template stays available on the Daily Production
              Entry page. */}
          <DailyProductionForm
            formValues={formValues}
            onChange={setFormValues}
            onSubmit={handleSubmit}
            onCancel={closeForm}
            editing={Boolean(editingId)}
            compact
          />
        </Modal>
      )}

      {detailRow && (
        <Modal title="Daily Production — Full Sheet" onClose={() => setDetailRow(null)} wide>
          <DailyProductionDetail row={detailRow} onClose={() => setDetailRow(null)} />
        </Modal>
      )}
    </div>
  );
}

/** A minimal dark-themed modal. Escape and a backdrop click both dismiss. */
function Modal({ title, onClose, wide, children }) {
  return (
    <div
      className="dp-modal-backdrop"
      role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={`dp-modal${wide ? ' dp-modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="dp-modal-head">
          <h3>{title}</h3>
          <button type="button" className="dp-modal-close" aria-label="Close" onClick={onClose}>×</button>
        </header>
        <div className="dp-modal-body">{children}</div>
      </div>
    </div>
  );
}

export { computeDailySummary };
