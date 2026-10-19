import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { useHourlyErpMirror } from '../useHourlyErpMirror';
import { DataContext } from '../../context/DataContext';
import { ErpDataContext } from '../../context/ErpDataContext';
import { PermissionContext } from '../../context/PermissionContext';
import { C } from '../../config/erpSchema';

/**
 * The two things this hook must get right beyond the pure mapper:
 *
 *   1. a row list handed in is the truth used for the reconcile, NOT the local
 *      store — otherwise a delete's cleanup reads the pre-delete list and the
 *      deleted row's ERP documents survive;
 *   2. rows that cannot be mirrored are reported back as `skipped` rather than
 *      vanishing, so a screen can warn.
 *
 * The project's tests render with `renderToStaticMarkup` (no DOM, no
 * testing-library), so each case captures the hook's value during that render and
 * awaits it afterwards.
 */

const ROW = (overrides = {}) => ({
  id: 1,
  date: '2026-10-17',
  line_no: 'Line-03',
  employee: 'Md Robiul Islam',
  order_no: 'PO-105',
  style: 'STY-1001',
  process: 'Collar Attach',
  hours: { '08:00': 50 },
  hourlyTarget: 60,
  ...overrides,
});

/**
 * An ERP context keyed the way the hook subscribes: by CACHE KEY (`syncHourly`,
 * `syncLines`, …), not by Firestore collection name.
 */
function makeErp(existing = []) {
  return {
    subscribe: () => () => {},
    rows: (cacheKey) => {
      if (cacheKey === 'syncHourly') return existing;
      if (cacheKey === 'syncLines') return [{ id: 'line-3', lineNo: 'Line-03' }];
      return [];
    },
    save: vi.fn(async () => ({ ok: true })),
    remove: vi.fn(async () => ({ ok: true })),
  };
}

/**
 * Renders a throwaway component that uses the hook and returns the hook's value.
 *
 * `storeRows` is what `getData` returns — the STALE local store in the delete case.
 */
function renderMirror({ erp, storeRows = [] }) {
  let api = null;
  function Probe() {
    const hook = useHourlyErpMirror();
    if (!api) api = hook; // `renderToStaticMarkup` never re-renders, but be explicit
    return null;
  }
  renderToStaticMarkup(
    <PermissionContext.Provider value={{ can: () => true }}>
      <DataContext.Provider value={{ getData: () => storeRows }}>
        <ErpDataContext.Provider value={erp}>
          <Probe />
        </ErpDataContext.Provider>
      </DataContext.Provider>
    </PermissionContext.Provider>,
  );
  return api;
}

describe('mirrorRows — the rows passed in are the truth', () => {
  it('reports no skip and no error for a clean day', async () => {
    const erp = makeErp();
    const mirror = renderMirror({ erp });

    const res = await mirror.mirrorRows('2026-10-17', [ROW()]);

    expect(res).toMatchObject({ day: '2026-10-17', mirrored: 1, skipped: 0, error: '' });
  });

  it('removes the ERP documents of a row deleted in this tick, even though the store still lists it', async () => {
    const existing = [{ id: 'hp-1-08-00', localRowId: 1, date: '2026-10-17' }];
    const erp = makeErp(existing);
    // The store is the STALE, pre-delete truth — what a same-tick read would give.
    const mirror = renderMirror({ erp, storeRows: [ROW()] });

    await mirror.mirrorRows('2026-10-17', []);

    expect(erp.remove).toHaveBeenCalledWith(C.HOURLY_PRODUCTION, 'hp-1-08-00', expect.anything());
  });

  it('reports a row whose line is not in the master as skipped', async () => {
    const erp = makeErp();
    const mirror = renderMirror({ erp });

    const res = await mirror.mirrorRows('2026-10-17', [
      ROW(),
      ROW({ id: 2, line_no: 'Unknown Line' }),
    ]);

    expect(res.skipped).toBe(1);
    expect(res.mirrored).toBe(1);
    expect(erp.save).toHaveBeenCalledTimes(1);
  });

  it('ignores rows of another day', async () => {
    const erp = makeErp();
    const mirror = renderMirror({ erp });

    const res = await mirror.mirrorRows('2026-10-17', [ROW({ date: '2026-10-16' })]);

    expect(res).toMatchObject({ mirrored: 0, skipped: 0, error: '' });
    expect(erp.save).not.toHaveBeenCalled();
  });
});
