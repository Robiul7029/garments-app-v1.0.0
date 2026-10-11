import React from 'react';

/**
 * Floating Month / Date filter box.
 *
 * Rendered inside a view, so it inherits that view's visibility: when the parent view or
 * accordion section is hidden the filter disappears with it. It never holds its own open /
 * closed state, which is what keeps that guarantee true.
 *
 * - `month` (default the running month) drives the whole grid.
 * - `date` is optional. Picking a single day narrows every grid/list to that date and pulls
 *   the month along with it; clearing it goes back to the full month. Previous and future
 *   months are selected through the native month input, so no grid can be left in an
 *   impossible state.
 */
export default function AttendancePeriodFilter({
  month,
  onMonthChange,
  date,
  onDateChange,
  search,
  onSearchChange,
  searchPlaceholder = 'Name, ID or Department',
  align = 'right',
  label = 'Filter',
}) {
  return (
    <div className={`att-period-filter att-period-filter-${align}`} role="group" aria-label={`${label} — month, date and worker search`}>
      <label className="form-field">
        <span>🗓️ Month</span>
        <input
          type="month"
          value={month || ''}
          onChange={(event) => onMonthChange(event.target.value)}
          aria-label="Select month"
        />
      </label>

      <label className="form-field">
        <span>📅 Single Day</span>
        <input
          type="date"
          value={date || ''}
          max={month ? `${month}-31` : undefined}
          onChange={(event) => onDateChange(event.target.value)}
          aria-label="Select a single date"
        />
      </label>

      {onSearchChange && (
        <label className="form-field att-search-field">
          <span>🔎 Search Worker</span>
          <input
            type="search"
            value={search || ''}
            placeholder={searchPlaceholder}
            onChange={(event) => onSearchChange(event.target.value)}
            aria-label="Search worker by name or ID"
          />
        </label>
      )}
    </div>
  );
}