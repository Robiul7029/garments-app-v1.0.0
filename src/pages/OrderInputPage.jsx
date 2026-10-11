import React, { useMemo, useState } from 'react';
import { useData } from '../context/DataContext';
import { useRole } from '../context/RoleContext';
import { downloadCSV } from '../utils/csv';
import {
  COLLECTIONS, ORDER_FIELDS, ORDER_FORM_GROUPS, orderValue, variantsOf, splitValues,
} from '../config/orderWorkflow';
import ColorTagInput from '../components/ColorTagInput';
import SizeRangeInput from '../components/SizeRangeInput';
// Shared with Daily Production and the read-only Full Sheet, so the same stored
// value renders identically everywhere rather than three slightly different ways.
import { MultiValueCell as SharedMultiValueCell } from '../components/DailyProductionSheet';

/**
 * Order Management → Order Input.
 *
 * The order master. Everything a downstream screen needs about a style is
 * captured here once — Buyer, Order No, Style, Item, Color, Size Range, PO Qty,
 * Floor, Line, Shift and Supervisor — and saved so the rest of the app can
 * reference it by style rather than have it retyped on every production entry.
 *
 * Writes to `order-model`, the collection the app already used, so the Delivery,
 * Washing, Line Status and older Order / Model screens keep resolving styles from
 * here. The added fields are additive keys on the same documents.
 *
 * A style is the natural key the floor works from, so it is required and the save
 * is refused without it — a nameless order cannot be selected on the production
 * form, which would leave the prefill with nothing to look up.
 */
export default function OrderInputPage({ category, item }) {
  const { getData, addEntry, updateEntry, deleteEntry } = useData();
  const { isAdmin } = useRole();
  const rows = getData(COLLECTIONS.ORDERS);
  const employees = getData('employees');

  const blank = useMemo(() => ({ order_date: new Date().toISOString().slice(0, 10), qty: '' }), []);
  const [form, setForm] = useState(blank);
  const [editingId, setEditingId] = useState(null);
  const [notice, setNotice] = useState('');
  // Per-field validation: the message is keyed by field name and rendered inline
  // under the field it belongs to, rather than as one banner at the top of the
  // form. A user is told exactly which box is blank.
  const [errors, setErrors] = useState({});

  const buyers = useMemo(() => [...new Set(rows.map((r) => r.buyer).filter(Boolean))], [rows]);

  /**
   * The rule for one field: it has no value once trimmed. Multi-value fields
   * (Colour, Size Range) hold a comma-separated string, so they count as filled
   * only when at least one value was chosen or typed.
   */
  function isBlank(field) {
    const raw = form[field.name];
    if (field.type === 'color-tags' || field.type === 'size-multi') {
      return splitValues(raw).length === 0;
    }
    return String(raw ?? '').trim() === '';
  }

  /** Every required field that is currently empty, as { name: message }. */
  function collectErrors() {
    const next = {};
    ORDER_FIELDS.filter((f) => f.required).forEach((f) => {
      if (isBlank(f)) next[f.name] = 'Please fill in this field!';
    });
    return next;
  }

  function set(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
    // Clear the field's warning as soon as it is given a value, so the red mark
    // disappears the moment the user fixes it rather than lingering until save.
    setErrors((prev) => (prev[field] ? { ...prev, [field]: null } : prev));
  }

  function reset() {
    setForm(blank);
    setEditingId(null);
    setErrors({});
  }

  function submit(e) {
    e.preventDefault();

    // Validate EVERY required field up front and show each message under its own
    // input. Nothing is saved while any of them is blank.
    const fieldErrors = collectErrors();
    const style = String(form.style || '').trim();

    // A duplicate style would make the prefill ambiguous: two orders would answer
    // to the same lookup key and the production form could not know which to use.
    // It is not a blank field, but it still belongs inline, under the Style input.
    if (!fieldErrors.style && style) {
      const clash = rows.find(
        (r) => String(r.style || '').trim().toLowerCase() === style.toLowerCase() && r.id !== editingId,
      );
      if (clash) {
        fieldErrors.style = `Style "${style}" already exists on order ${clash.order_no || clash.id}. Use a different style number.`;
      }
    }

    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      setNotice('');
      return;
    }

    const record = {
      ...form,
      style,
      qty: Number(form.qty) || 0,
      // Keep `start_date` in step with `order_date`: older screens read start_date.
      start_date: form.order_date || form.start_date || '',
    };

    if (editingId) {
      updateEntry(COLLECTIONS.ORDERS, editingId, record);
      setNotice(`Order ${style} updated.`);
    } else {
      addEntry(COLLECTIONS.ORDERS, record);
      setNotice(`Order ${style} saved. It is now selectable on Daily Production Entry.`);
    }
    reset();
  }

  function edit(row) {
    setEditingId(row.id);
    setForm({ ...row });
    setNotice('');
    setErrors({});
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div className="module">
      <div className="module-header">
        <h2 style={{ margin: 0 }}>{item.icon} {item.label}</h2>
      </div>

      {notice && <div className="erp-notice erp-notice-success dp-notice">{notice}</div>}

      {isAdmin ? (
        <form className="dp-entry-card" onSubmit={submit}>
          <h3 className="dp-recent-title">{editingId ? 'Edit order' : 'New order'}</h3>
          {ORDER_FORM_GROUPS.map((group) => (
            <section key={group.key} className="dp-section">
              <h4 className="dp-section-title">{group.title}</h4>
              <div className="dp-detail-grid">
                {ORDER_FIELDS.filter((f) => f.group === group.key).map((field) => {
                  const value = form[field.name] ?? '';
                  const message = errors[field.name];
                  const wide = field.type === 'color-tags' || field.type === 'size-multi';
                  // Shared props for the plain inputs and selects below. The two
                  // custom controls (colour dropdown, size dropdown) take `value`
                  // and `onChange` as a string instead of an event, so they are
                  // wired separately rather than through this object.
                  const common = {
                    id: `oi-${field.name}`,
                    value,
                    onChange: (e) => set(field.name, e.target.value),
                    'aria-invalid': message ? true : undefined,
                  };
                  // The two multi-value fields hold a CLICK-driven dropdown, so
                  // they must NOT sit inside a <label>: a label forwards every
                  // click to its first control, which would re-toggle the menu
                  // shut as soon as an option was ticked. A role="group" wrapper
                  // keeps the caption association without that behaviour.
                  const Wrapper = wide ? 'div' : 'label';
                  const wrapperProps = wide ? { role: 'group', 'aria-label': field.label } : {};
                  return (
                    <Wrapper
                      {...wrapperProps}
                      className={`form-field${wide ? ' form-field-wide' : ''}${message ? ' is-invalid' : ''}`}
                      key={field.name}
                    >
                      <span>
                        {field.label}
                        {field.required && <em className="req-star"> *</em>}
                      </span>

                      {/* Colour: one order carries several. */}
                      {field.type === 'color-tags' ? (
                        <ColorTagInput
                          id={`oi-${field.name}`}
                          value={value}
                          onChange={(next) => set(field.name, next)}
                          placeholder="Select colours…"
                          ariaLabel="Colours on this order"
                        />
                      ) : field.type === 'size-multi' ? (
                        /* Size range: routinely 8–10 sizes, chosen from a
                           checkbox dropdown rather than a box that truncates. */
                        <SizeRangeInput
                          id={`oi-${field.name}`}
                          value={value}
                          onChange={(next) => set(field.name, next)}
                          ariaLabel="Size range for this order"
                        />
                      ) : field.type === 'select' ? (
                        <select {...common}>
                          <option value="">Select…</option>
                          {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : field.type === 'employee-select' ? (
                        <>
                          <input list={`oi-list-${field.name}`} {...common} placeholder={field.placeholder || ''} />
                          <datalist id={`oi-list-${field.name}`}>
                            {employees.map((e) => <option key={e} value={e} />)}
                          </datalist>
                        </>
                      ) : (
                        <>
                          <input
                            type={field.type === 'number' ? 'number' : field.type}
                            list={field.name === 'buyer' ? 'oi-buyers' : undefined}
                            {...common}
                            placeholder={field.placeholder || ''}
                          />
                          {field.name === 'buyer' && (
                            <datalist id="oi-buyers">{buyers.map((b) => <option key={b} value={b} />)}</datalist>
                          )}
                        </>
                      )}

                      {/* Inline, field-specific warning: shown directly under the
                          field it belongs to, so the user is told exactly which
                          box is blank rather than reading one banner up top. */}
                      {message && <span className="field-error" role="alert">{message}</span>}
                    </Wrapper>
                  );
                })}
              </div>
            </section>
          ))}

          {/* What the order resolves to: colours × sizes. Stated plainly because
              a multi-value field is easy to under-fill, and the count is the
              quickest check that nothing was left out. */}
          <VariantSummary form={form} />

          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              {editingId ? 'Save Changes' : 'Save Order'}
            </button>
            {editingId && (
              <button type="button" className="btn btn-outline" onClick={reset}>Cancel</button>
            )}
          </div>
        </form>
      ) : (
        <div className="erp-notice erp-notice-info dp-notice">
          <span aria-hidden="true">🔒</span>
          <span>View only — your role can read the order master but not change it.</span>
        </div>
      )}

      <h3 className="dp-recent-title" style={{ marginTop: 22 }}>Order master ({rows.length})</h3>
      <div className="table-wrap" style={{ marginTop: 10 }}>
        <table className="dp-table">
          <thead>
            <tr>
              <th>Style</th><th>Order No</th><th>Buyer</th><th>Item</th>
              <th>Color</th><th>Size Range</th><th>PO Qty</th>
              <th>Floor</th><th>Line</th><th>Shift</th><th>Supervisor</th><th>Delivery</th>
              {isAdmin && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={isAdmin ? 13 : 12} className="empty-row">
                  No orders yet — register one above and it becomes selectable on Daily Production Entry.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className={editingId === r.id ? 'dp-row-editing' : undefined}>
                <td className="mono-cell">{r.style || '—'}</td>
                <td className="mono-cell">{r.order_no || '—'}</td>
                <td>{r.buyer || '—'}</td>
                <td>{r.item || '—'}</td>
                <td><SharedMultiValueCell value={r.color} /></td>
                <td><SharedMultiValueCell value={r.size_range} tone="size" /></td>
                <td className="mono-cell">{r.qty ?? '—'}</td>
                <td>{orderValue(r, 'floor') || '—'}</td>
                <td>{orderValue(r, 'line_no') || '—'}</td>
                <td>{r.shift || '—'}</td>
                <td>{r.supervisor || '—'}</td>
                <td className="mono-cell">{r.ship_date || '—'}</td>
                {isAdmin && (
                  <td className="row-actions">
                    <button className="btn-icon" title="Edit this order" onClick={() => edit(r)}>✏️</button>
                    <button className="btn-icon" title="Delete this order" onClick={() => deleteEntry(COLLECTIONS.ORDERS, r.id)}>🗑️</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length > 0 && (
        <div className="module-actions" style={{ marginTop: 14 }}>
          <button
            className="btn btn-outline"
            onClick={() => downloadCSV('order-master.csv', rows, ORDER_FIELDS.map((f) => ({ name: f.name, label: f.label })))}
          >
            ⬇ Export Order Master
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The colours × sizes a multi-value order resolves to.
 *
 * Stated because it is the number a merchandiser is actually asked for, and
 * because a comma-separated field is easy to under-fill silently — the count is
 * the fastest way to notice a colour that never got added.
 */
function VariantSummary({ form }) {
  const counts = variantsOf(form);
  if (counts.colors === 0 && counts.sizes === 0) return null;
  return (
    <div className="dp-entry-metrics" style={{ marginTop: 4 }}>
      <div className="dp-metric">
        <span className="dp-metric-label">Colours</span>
        <span className="dp-metric-value">{counts.colors}</span>
      </div>
      <div className="dp-metric">
        <span className="dp-metric-label">Sizes</span>
        <span className="dp-metric-value">{counts.sizes}</span>
      </div>
      <div className="dp-metric">
        <span className="dp-metric-label">Size / colour combinations</span>
        <span className="dp-metric-value">{counts.combinations}</span>
      </div>
    </div>
  );
}


