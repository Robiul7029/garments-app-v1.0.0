import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { useHourlyMirrorReadiness } from '../useHourlyMirrorReadiness';
import { DataContext } from '../../context/DataContext';
import { ErpDataContext } from '../../context/ErpDataContext';
import { PermissionContext } from '../../context/PermissionContext';

/**
 * The dashboard's "production lines are not set up" notice.
 *
 * The rule it must not break: NEVER warn while the line master is still loading.
 * An empty cache during the first snapshot is indistinguishable from an empty
 * collection, and a warning that flashes on every page load would train people to
 * ignore it.
 */

const LOCAL_ROW = { id: 1, date: '2026-10-17', line_no: 'Line-03', hours: { '08:00': 50 } };

function makeErp({ lines = [], status = 'ready' }) {
  return {
    subscribe: () => () => {},
    rows: (key) => (key === 'lines' ? lines : []),
    isLoading: () => status === 'loading',
    errorFor: () => (status === 'error' ? 'offline' : ''),
    save: async () => ({ ok: true }),
    remove: async () => ({ ok: true }),
    status: { lines: status },
  };
}

function read({ erp, hourlyRows = [LOCAL_ROW], canView = true }) {
  let api = null;
  function Probe() {
    const value = useHourlyMirrorReadiness();
    if (!api) api = value;
    return null;
  }
  renderToStaticMarkup(
    <PermissionContext.Provider value={{ can: () => true, canView: () => canView }}>
      <DataContext.Provider value={{ getData: (key) => (key === 'hourly-timesheet-rows' ? hourlyRows : []) }}>
        <ErpDataContext.Provider value={erp}>
          <Probe />
        </ErpDataContext.Provider>
      </DataContext.Provider>
    </PermissionContext.Provider>,
  );
  return api;
}

describe('useHourlyMirrorReadiness', () => {
  it('warns when the line master is empty and floor rows are waiting on it', () => {
    const result = read({ erp: makeErp({ lines: [] }) });
    expect(result.missingMaster).toBe(true);
    expect(result.hourlyRowCount).toBe(1);
  });

  it('stays quiet once a line exists', () => {
    const result = read({ erp: makeErp({ lines: [{ id: 'line-3', lineNo: 'Line-03' }] }) });
    expect(result.missingMaster).toBe(false);
    expect(result.ready).toBe(true);
  });

  it('stays quiet while the line master is still loading', () => {
    const result = read({ erp: makeErp({ lines: [], status: 'loading' }) });
    expect(result.ready).toBe(false);
    expect(result.missingMaster).toBe(false);
  });

  it('stays quiet when the line master failed to load', () => {
    // A failed read is not proof the master is empty — the notice would be wrong.
    const result = read({ erp: makeErp({ lines: [], status: 'error' }) });
    expect(result.missingMaster).toBe(false);
  });

  it('stays quiet when there are no local rows to mirror', () => {
    const result = read({ erp: makeErp({ lines: [] }), hourlyRows: [] });
    expect(result.missingMaster).toBe(false);
  });

  it('never warns a role that cannot read production', () => {
    const result = read({ erp: makeErp({ lines: [] }), canView: false });
    expect(result.missingMaster).toBe(false);
    expect(result.ready).toBe(false);
  });
});
