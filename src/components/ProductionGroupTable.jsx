import React from 'react';
import {
  groupedByEmployee,
  varianceLabel,
} from '../config/productionGrouping';

/**
 * The grouped production table — one employee, many processes.
 *
 * A worker moves between operations during a day, so a flat table repeats their
 * name once per process and buries the day's shape. This renders:
 *
 *   EMPLOYEE (once, spanning the group)
 *     ├ process row — Process · Target · Actual · Defects · Efficiency % · Variance
 *     ├ process row
 *     └ day total row — the whole day summed
 *
 * The employee cell spans every row of the group so the name is stated exactly
 * once, and the process rows sit directly under it. This is the display the brief
 * asks for, produced from `groupedByEmployee` so the arithmetic is not repeated in
 * markup and the Daily and Worker screens cannot disagree.
 *
 * `actions` lets the caller add a per-row control (View Full Sheet / Edit /
 * Delete) without this component knowing about the data layer.
 */
export default function ProductionGroupTable({
  rows = [],
  emptyMessage = 'No production recorded yet.',
  showStyle = true,
  actions,
}) {
  const groups = groupedByEmployee(rows);

  if (groups.length === 0) {
    return <tr><td colSpan={8} className="empty-row">{emptyMessage}</td></tr>;
  }

  return groups.map((group) => (
    <React.Fragment key={group.key}>
      {group.processes.map((p, index) => {
        const first = index === 0;
        const last = index === group.processes.length - 1;
        return (
          <tr
            key={`${group.key}-${p.process}-${p.id ?? index}`}
            className={`pg-row${first ? ' pg-row-first' : ''}${last ? ' pg-row-last' : ''}`}
          >
            {/* The employee identity, stated ONCE, spanning every process row.
                `rowSpan` is what removes the repetition the brief complains about. */}
            {first && (
              <td className="pg-employee" rowSpan={group.processes.length + 1}>
                <span className="pg-employee-name">{group.employee}</span>
                <span className="pg-employee-meta">{group.date}</span>
                {group.line && <span className="pg-employee-meta">{group.line}</span>}
                <span className="pg-employee-meta pg-employee-count">
                  {group.processes.length} process{group.processes.length === 1 ? '' : 'es'}
                </span>
              </td>
            )}

            <td className="pg-process">{p.process}</td>
            {showStyle && <td className="pg-style">{p.style || group.style || '—'}</td>}
            <td className="mono-cell">{p.target || '—'}</td>
            <td className="mono-cell pg-actual">{p.actual || '—'}</td>
            <td className="mono-cell pg-defect">{p.defect || '0'}</td>
            <td className={`mono-cell ${levelClass(p.efficiency)}`}>
              {p.target > 0 ? `${p.efficiency}%` : '—'}
            </td>
            <td className={`mono-cell ${toneClass(p.variance)}`}>
              {varianceLabel(p.variance)}
            </td>
            {actions && <td className="row-actions">{actions(p.row)}</td>}
          </tr>
        );
      })}

      {/* The employee's day total across every process they worked. Shown so the
          group reads as one employee-day, not as unrelated rows. */}
      <tr className="pg-total-row">
        <td className="pg-total-label" colSpan={showStyle ? 2 : 1}>Day total</td>
        <td className="mono-cell">{group.totals.target}</td>
        <td className="mono-cell">{group.totals.actual}</td>
        <td className="mono-cell">{group.totals.defect}</td>
        <td className={`mono-cell ${levelClass(group.totals.efficiency)}`}>
          {group.totals.target > 0 ? `${group.totals.efficiency}%` : '—'}
        </td>
        <td className={`mono-cell ${toneClass(group.totals.variance)}`}>
          {varianceLabel(group.totals.variance)}
        </td>
        {actions && <td />}
      </tr>
    </React.Fragment>
  ));
}

/** The efficiency tint, shared with the flat tables elsewhere. */
function levelClass(efficiency) {
  if (efficiency >= 90) return 'dp-good';
  if (efficiency >= 70) return 'dp-warn';
  return efficiency > 0 ? 'dp-bad' : '';
}

function toneClass(variance) {
  if (variance > 0) return 'dp-good';
  if (variance < 0) return 'dp-bad';
  return '';
}

/** Column headings, exported so a caller renders the exact header the body needs. */
export function ProductionGroupTableHead({ showStyle = true, actions = false }) {
  return (
    <tr>
      <th>Employee</th>
      <th>Process</th>
      {showStyle && <th>Style</th>}
      <th>Process Target</th>
      <th>Actual Output</th>
      <th>Defects</th>
      <th>Efficiency %</th>
      <th>Variance (+/-)</th>
      {actions && <th>Details</th>}
    </tr>
  );
}
