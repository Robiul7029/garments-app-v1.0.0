import React, { useEffect, useMemo, useState } from 'react';
import { useData } from '../context/DataContext';
import { usePermissions } from '../context/PermissionContext';
import { MODULE } from '../config/erpRoles';
import {
  COLLECTIONS, ORDER_FIELDS, ORDER_FORM_GROUPS, ORDER_REQUIRED_FIELDS,
  variantsOf, splitValues, orderValue, colorsOf, sizesOf,
} from '../config/orderWorkflow';
import ColorTagInput from '../components/ColorTagInput';
import SizeRangeInput from '../components/SizeRangeInput';

/** How many recent months the board shows — the running month plus the two before it. */
const BOARD_MONTHS = 3;

/** The columns the recent-months board below the form shows, in order. */
const BOARD_COLUMNS = [
  { name: 'style', label: 'Style No' },
  { name: 'order_no', label: 'Order No' },
  { name: 'buyer', label: 'Buyer' },
  { name: 'item', label: 'Product / Item' },
  { name: 'qty', label: 'PO Qty', type: 'number' },
  { name: 'color', label: 'Color', type: 'color-tags' },
  { name: 'size_range', label: 'Size Range', type: 'size-multi' },
  { name: 'order_date', label: 'Order Date' },
  { name: 'ship_date', label: 'Delivery Date' },
];

/**
 * The "YYYY-MM" keys for the last `count` months, newest first.
 *
 * The board shows the running month AND the two before it, so an order raised
 * last month does not vanish the moment the calendar turns. "Which month is it"
 * is the machine's own month, so the window follows the calendar the factory is
 * working in rather than a month the user must pick.
 */
function recentMonthKeys(count = BOARD_MONTHS) {
  const now = new Date();
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
}

/** The "2026-10" key for a stored date, or '' when there is none. */
function monthKeyOf(value) {
  const raw = String(value || '').trim();
  return /^\d{4}-\d{2}/.test(raw) ? raw.slice(0, 7) : '';
}

/** "2026-10" -> "October 2026", for the board's heading. */
function monthLabel(key) {
  const [y, m] = String(key).split('-').map(Number);
  if (!y || !m) return key;
  return new Date(y, m - 1, 1).toLocaleString('en-GB', { month: 'long', year: 'numeric' });
}
// Shared with Daily Production and the read-only Full Sheet, so the same stored
// value renders identically everywhere rather than three slightly different ways.

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
  // Role-based UI triggers, read from the ERP permission matrix rather than the
  // legacy session role. A general user holds view only, so `canCreate`,
  // `canEdit` and `canDelete` are all false and NO action control is rendered:
  // no "+ Add Order Input" button, no Edit / Delete row actions and no form. A
  // manager or admin holds the write actions and sees all of them. The data
  // table below stays visible to every role.
  const permissions = usePermissions();
  // Safe fallbacks, answered "no". A permission method that is missing (a provider
  // replaced in a preview route, a stale context shape) must render the page
  // read-only, never throw a TypeError. The fallback is deliberately FALSE, not
  // true: silently granting write access on a name-resolution error would let a
  // View-Only account edit orders.
  const canCreate = Boolean(permissions?.canCreate?.(MODULE.ORDERS));
  const canEdit = Boolean(permissions?.canEdit?.(MODULE.ORDERS));
  const canDelete = Boolean(permissions?.canDelete?.(MODULE.ORDERS));
  const canWrite = canCreate || canEdit || canDelete;

  // A missing permission method is a wiring bug, not a user error. Logged ONCE per
  // mount, in English, instead of throwing — so the page still renders and the
  // problem is visible in the console.
  useEffect(() => {
    if (typeof permissions?.canCreate === 'function' && typeof permissions?.canEdit === 'function') return;
    console.warn('[OrderInput] Permission helpers are missing from the provider; the page is rendered read-only.');
  }, [permissions]);
  const allRows = getData(COLLECTIONS.ORDERS);
  const employees = getData('employees');
  // The RECENT MONTHS window — the running month plus the two before it.
  const windowMonths = useMemo(() => recentMonthKeys(BOARD_MONTHS), []);
  // The board shows everything entered in the last three months, newest first, so
  // an order raised this month AND the two prior months stays in view here. Older
  // orders are found on the Order List tab, whose month filter looks them up.
  const rows = useMemo(
    () => allRows
      .filter((r) => {
        const key = monthKeyOf(r.order_date) || monthKeyOf(r.start_date);
        return windowMonths.includes(key);
      })
      .sort((a, b) => String(b.order_date || b.start_date || '').localeCompare(String(a.order_date || a.start_date || ''))),
    [allRows, windowMonths],
  );
  // A short, human label for the window, e.g. "August – October 2026".
  const windowLabel = useMemo(() => {
    const newest = windowMonths[0];
    const oldest = windowMonths[windowMonths.length - 1];
    if (newest.slice(0, 4) === oldest.slice(0, 4)) {
      return `${monthLabel(oldest).split(' ')[0]} – ${monthLabel(newest)}`;
    }
    return `${monthLabel(oldest)} – ${monthLabel(newest)}`;
  }, [windowMonths]);

  const blank = useMemo(() => ({ order_date: new Date().toISOString().slice(0, 10), qty: '' }), []);
  const [form, setForm] = useState(blank);
  const [editingId, setEditingId] = useState(null);
  const [notice, setNotice] = useState('');
  // Sequential validation state.
  //
  // ONE field is ever flagged at a time — `activeError` holds { name, message }
  // for the single field the save check stopped on, and nothing else — so the
  // form can no longer red-border every blank box at once. The flag clears the
  // moment that field is given a value, ready for the next save to check the
  // next one in the sequence.
  const [activeError, setActiveError] = useState(null);
  // The form is COLLAPSED by default. The tab opens on the order book's entry
  // button, not on an empty 13-field form: raising an order is the less common
  // action, and a form that is always open pushes the page down and invites a
  // half-filled draft. Opening it is one click, and saving closes it again so
  // the user is returned to a clean screen rather than an empty form.
  const [formOpen, setFormOpen] = useState(false);
  // A short bump counter that re-fires the popup animation on the SAME field
  // when the user presses Save again without having filled it: the value has
  // not changed, so React would keep the existing node and its animation would
  // not replay. Keying the popup on the counter restarts it.
  const [errorNonce, setErrorNonce] = useState(0);

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

  /**
   * The FIRST required field that is still empty, walking the sequence
   * Buyer → Order No → Style → Product → Color → Size → PO Qty → Dates →
   * Floor / Line / Shift. Returns null when every one of them is filled.
   *
   * Only the first is returned, which is what makes the check sequential: the
   * user is told about one missing box, fills it, and the next save moves on to
   * the next. Showing all of them at once is exactly what this replaces.
   */
  function firstBlankField() {
    return ORDER_REQUIRED_FIELDS.find((f) => isBlank(f)) || null;
  }

  /**
   * Show the popup for one field, scroll it into view and put the cursor in it.
   *
   * Focusing the field is what makes the prompt actionable rather than merely
   * descriptive — the user is standing in the box they were asked about. It is
   * guarded because the custom colour/size controls expose an input under a
   * wrapper id, and a browser that refuses focus (hidden tab) must not break
   * the save path.
   */
  function flagField(field) {
    setActiveError({ name: field.name, message: field.errorMessage || `Please fill in the ${field.label}` });
    setErrorNonce((n) => n + 1);
    setNotice('');
    // After paint, so the element exists and is flagged before we scroll to it.
    window.setTimeout(() => {
      const el = document.getElementById(`wrap-oi-${field.name}`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const control = el.querySelector('input, select, textarea, [tabindex]');
      try { control?.focus({ preventScroll: true }); } catch { /* older browsers */ }
    }, 0);
  }

  function set(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
    // The single active flag clears as soon as IT is given a value — the popup
    // and border go with it, so the form is clean again and the next save
    // checks the next field in the sequence.
    setActiveError((prev) => (prev && prev.name === field ? null : prev));
  }

  function reset() {
    setForm(blank);
    setEditingId(null);
    setActiveError(null);
  }

  function submit(e) {
    e.preventDefault();

    // STEP-BY-STEP CHECK. Stop at the first required field that is empty and
    // flag ONLY that one; the form is not marked up all over, and nothing is
    // saved while a required box is blank. Filling it and pressing Save again
    // re-enters here and moves on to the next empty field, so the user is walked
    // through the form one prompt at a time.
    const missing = firstBlankField();
    if (missing) {
      flagField(missing);
      return;
    }

    const style = String(form.style || '').trim();

    // A duplicate style would make the prefill ambiguous: two orders would answer
    // to the same lookup key and the production form could not know which to use.
    // It is not a blank field, so it is checked once every required box is filled
    // — and it is still raised on the Style field, in the same popup.
    // Runs against EVERY order, not just this month's, so the style stays unique
    // across the whole book.
    const clash = allRows.find(
      (r) => String(r.style || '').trim().toLowerCase() === style.toLowerCase() && r.id !== editingId,
    );
    if (clash) {
      flagField({
        name: 'style',
        label: 'Style No',
        // English only, like every other tooltip on this form.
        errorMessage: `Style "${style}" already exists on order ${clash.order_no || clash.id}. Use a different style number.`,
      });
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
    // Clears the fields AND closes the form, so the tab returns to its resting
    // state. `reset` also drops the editing id and any active validation flag,
    // so reopening shows a genuinely blank form rather than the last attempt.
    reset();
    setFormOpen(false);
  }

  /** Opens the form empty, so "Add" never inherits a previous row's values. */
  function openNewForm() {
    reset();
    setNotice('');
    setFormOpen(true);
  }

  /**
   * Row action — edit. Loads the clicked order into the SAME form the Add button
   * uses, so there is still exactly one editing surface and one validation path.
   * Every field the form knows is copied across with the alias-aware reader, so a
   * row saved by an older screen opens with its values rather than blanks.
   */
  function editOrder(row) {
    const next = { ...blank };
    ORDER_FIELDS.forEach((f) => {
      const value = orderValue(row, f.name);
      if (value !== undefined && value !== null && value !== '') next[f.name] = value;
    });
    setForm(next);
    setEditingId(row.id);
    setActiveError(null);
    setNotice('');
    setFormOpen(true);
    // The form sits ABOVE the table, so opening it from a row far down the list
    // would otherwise populate a box the user cannot see. Bring it into view
    // after paint, once the form exists in the DOM.
    window.setTimeout(() => {
      document.getElementById('oi-form-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }

  /** Row action — delete, confirmed first because it cannot be undone. */
  function removeOrder(row) {
    const label = row.style || row.order_no || row.id;
    if (!window.confirm(`Delete order ${label}? This cannot be undone.`)) return;
    // Writes straight to the shared `order-model` store, so the row disappears
    // from this board AND from the Order List tab on the same render — the two
    // views read one source, there is no second copy to keep in step.
    deleteEntry(COLLECTIONS.ORDERS, row.id);
    // If the row being deleted is the one open in the form, close it so the user
    // is not left editing a record that no longer exists.
    if (editingId === row.id) {
      reset();
      setFormOpen(false);
    }
    setNotice(`Order ${label} deleted.`);
  }

  return (
    <div className="module">
      <div className="module-header">
        <h2 style={{ margin: 0 }}>{item.icon} {item.label}</h2>
      </div>

      {notice && <div className="erp-notice erp-notice-success dp-notice">{notice}</div>}

      {/* No separate Add button up here: the board below carries it beside the
          month heading, so the action sits with the rows it adds to rather than
          floating above them on its own. The form is collapsed until it is
          clicked, and hidden while the form is open because the form carries its
          own Save/Cancel. */}
      {/* The form is only built for a role that may write. A View-Only user
          never reaches it: `canWrite` is false, so neither the collapsed
          "+ Add Order Input" button nor this form exists in the tree. */}
      {canWrite ? (
        formOpen && (
        <form id="oi-form-card" className={`dp-entry-card oi-form${editingId ? ' oi-form-editing' : ''}`} onSubmit={submit}>
          <h3 className="dp-recent-title">
            {editingId ? `✏️ Edit order — ${form.style || ''}`.trim() : '+ Add Order Input'}
          </h3>
          {ORDER_FORM_GROUPS.map((group) => (
            <section key={group.key} className="dp-section">
              <h4 className="dp-section-title">{group.title}</h4>
              <div className="dp-detail-grid">
                {ORDER_FIELDS.filter((f) => f.group === group.key).map((field) => {
                  const value = form[field.name] ?? '';
                  // Only the ONE field the check stopped on is flagged. Every
                  // other box, filled or empty, renders untouched.
                  const flagged = activeError?.name === field.name;
                  const message = flagged ? activeError.message : '';
                  // Colour and Size Range each take TWO standard columns, so
                  // their boxes match the width of the single fields above them
                  // exactly (Buyer, Order No, Style No, Product). A tag row plus
                  // a counter needs a little more room than a plain text input,
                  // and two columns is precisely that — the grid stays uniform
                  // instead of stretching them to the full form width.
                  const wide = field.type === 'color-tags' || field.type === 'size-multi';
                  // Shared props for the plain inputs and selects below. The two
                  // custom controls (colour dropdown, size dropdown) take `value`
                  // and `onChange` as a string instead of an event, so they are
                  // wired separately rather than through this object.
                  const common = {
                    id: `oi-${field.name}`,
                    value,
                    onChange: (e) => set(field.name, e.target.value),
                    // Only an EMPTY flagged field is aria-invalid. A duplicate
                    // style is wrong on a field that is filled, and telling a
                    // screen reader it is empty would be a lie.
                    'aria-invalid': flagged && isBlank(field) ? true : undefined,
                    'aria-describedby': flagged ? `oi-err-${field.name}` : undefined,
                  };
                  // The two multi-value fields hold a CLICK-driven dropdown, so
                  // they must NOT sit inside a <label>: a label forwards every
                  // click to its first control, which would re-toggle the menu
                  // shut as soon as an option was ticked. A role="group" wrapper
                  // keeps the caption association without that behaviour.
                  const Wrapper = wide ? 'div' : 'label';
                  const wrapperProps = wide
                    ? { role: 'group', 'aria-label': field.label, 'data-multi-field': field.name }
                    : {};
                  return (
                    <Wrapper
                      {...wrapperProps}
                      id={`wrap-oi-${field.name}`}
                      // `.has-error` carries the red border while the popup is
                      // up; the popup itself is absolutely positioned so it
                      // floats over the form instead of pushing the grid rows
                      // around as it appears and disappears.
                      className={`form-field oi-field${wide ? ' oi-field-multi' : ''}${flagged ? ' is-invalid has-error' : ''}`}
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

                      {/* The floating prompt. Anchored to the field it is about,
                          keyed on the nonce so it replays when Save is pressed
                          again on the same unfilled field, and removed entirely
                          once the field holds a value. */}
                      {flagged && (
                        <span
                          className="oi-tooltip"
                          id={`oi-err-${field.name}`}
                          role="alert"
                          aria-live="assertive"
                          key={errorNonce}
                        >
                          <span aria-hidden="true">⚠</span>
                          {message}
                        </span>
                      )}
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
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => { reset(); setFormOpen(false); }}
            >
              Cancel
            </button>
          </div>
        </form>
        )
      ) : (
        <div className="erp-notice erp-notice-info dp-notice">
          <span aria-hidden="true">🔒</span>
          <span>View only — your role can read the order master but not change it.</span>
        </div>
      )}
      {/* The board of the LAST THREE MONTHS — the running month and the two
          before it, newest first. Every row can be edited or deleted from here
          without leaving the tab; both actions write to the same `order-model`
          store the Order List tab reads, so the two views stay in step. */}
      <div className="oi-current">
        <div className="oi-list-bar">
          <span className="oi-list-count">
            {windowLabel} · {rows.length} order{rows.length === 1 ? '' : 's'} in the last {BOARD_MONTHS} months
          </span>
          {canCreate && !formOpen && (
            <div className="module-actions" style={{ margin: 0 }}>
              <button type="button" className="btn btn-primary btn-sm" onClick={openNewForm}>
                + Add Order Input
              </button>
            </div>
          )}
        </div>

        <div className="table-wrap">
          <table className="dp-table oi-table">
            <thead>
              <tr>
                {BOARD_COLUMNS.map((c) => <th key={c.name}>{c.label}</th>)}
                {canWrite && <th className="oi-actions-head">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={BOARD_COLUMNS.length + (canWrite ? 1 : 0)} className="empty-row">
                    No orders in the last {BOARD_MONTHS} months ({windowLabel}). Use “+ Add Order Input” to raise one.
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr key={row.id}>
                  {BOARD_COLUMNS.map((c) => (
                    <td key={c.name} className={c.type === 'number' ? 'mono-cell' : undefined}>
                      <BoardCell field={c} row={row} />
                    </td>
                  ))}
                  {canWrite && (
                    <td className="oi-row-actions">
                      {/* Edit and Delete are hidden independently, so a role
                          that may change a record but not remove one never
                          sees a Delete control it cannot use. */}
                      {canEdit && (
                        <button
                          type="button"
                          className="oi-act oi-act-edit"
                          title="Edit this order"
                          aria-label={`Edit order ${row.style || row.order_no || row.id}`}
                          onClick={() => editOrder(row)}
                        >
                          <PencilIcon />
                        </button>
                      )}
                      {canDelete && (
                        <button
                          type="button"
                          className="oi-act oi-act-delete"
                          title="Delete this order"
                          aria-label={`Delete order ${row.style || row.order_no || row.id}`}
                          onClick={() => removeOrder(row)}
                        >
                          <TrashIcon />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** A crisp inline pencil, drawn rather than an emoji so it takes the button's
 *  colour and stays sharp at any size. */
function PencilIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

/** The matching trash can. */
function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

/**
 * One cell of the recent-months board. The two multi-value fields render as
 * chips, matching the Order List tab, because the stored value is a CSV string
 * and printing "Navy, Black" in a cell reads as one long word.
 */
function BoardCell({ field, row }) {
  if (field.type === 'color-tags' || field.type === 'size-multi') {
    const parts = field.type === 'color-tags' ? colorsOf(row) : sizesOf(row);
    if (parts.length === 0) return '—';
    return (
      <span className="mv-cell">
        {parts.map((p) => <span key={p} className="mv-chip">{p}</span>)}
      </span>
    );
  }
  const value = orderValue(row, field.name);
  return value === undefined || value === null || String(value).trim() === '' ? '—' : String(value);
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


