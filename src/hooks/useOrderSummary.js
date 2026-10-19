import { useMemo, useState } from 'react';
import { useData } from '../context/DataContext';
import { COLLECTIONS } from '../config/orderWorkflow';
import {
  summariseOrders,
  summariseOrderTotals,
  filterOrderSummary,
  linesOf,
} from '../config/productionAggregation';

/**
 * ROBIUL GARMENTS ERP — the data behind the Master Buyer & Order Summary table.
 *
 * The Overall Summary tab is a view of two collections and nothing else:
 *
 *   `hourly-timesheet-rows`  the movement  — output, defects, manpower per hour
 *   `order-model`            the master    — Buyer, Style, PO Qty, Floor, Line…
 *
 * This hook joins them and holds the table's own UI state (the Buyer/Order search
 * box, the Line dropdown and the date being looked at), so the component below it
 * stays a rendering concern. Keeping the join here also means the on-screen table
 * and the exports read one list, computed once, rather than each re-deriving it.
 *
 * The date is INITIALISED from the page's date but can be changed inside the
 * table — a merchandiser checking yesterday's order progress should not have to
 * walk back to the page header to do it. When the page date changes, the table
 * follows it (see `useEffect`-free sync below), so the two never drift apart.
 */
export function useOrderSummary(initialDate) {
  const { getData } = useData();
  const rows = getData('hourly-timesheet-rows');
  const orders = getData(COLLECTIONS.ORDERS);
  const processSheets = getData(COLLECTIONS.PROCESS_SHEETS);

  const [search, setSearch] = useState('');
  const [line, setLine] = useState('');
  // `null` means "follow the page's date"; a value means the user picked one here.
  const [overrideDate, setOverrideDate] = useState(null);
  const date = overrideDate || initialDate;

  // The full month-to-date order picture for the chosen day.
  const allOrders = useMemo(
    () => summariseOrders(rows, orders, date, processSheets),
    [rows, orders, date, processSheets],
  );

  // The Line options come from the unfiltered list, so filtering by one line never
  // removes the other choices from the dropdown.
  const lineOptions = useMemo(() => linesOf(allOrders), [allOrders]);

  // The rows actually on screen — search + line applied.
  const visible = useMemo(
    () => filterOrderSummary(allOrders, { search, line }),
    [allOrders, search, line],
  );

  // The footer totals, summed from what is visible so they always match the table.
  const totals = useMemo(() => summariseOrderTotals(visible), [visible]);

  return {
    date,
    setDate: setOverrideDate,
    search,
    setSearch,
    line,
    setLine,
    lineOptions,
    orders: visible,
    totals,
    // The unfiltered count, so the empty-state can say whether the factory simply
    // has no orders or the filters hid them all.
    totalOrders: allOrders.length,
  };
}