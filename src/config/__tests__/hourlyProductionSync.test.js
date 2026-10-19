import { describe, it, expect } from 'vitest';
import {
  localRowToErpRows,
  buildErpMirror,
  expectedErpIds,
  orphanErpIds,
  mirrorRowsForDate,
  erpRowIdFor,
  syncIdFor,
  slotsOf,
  targetForSlot,
  syncDateKey,
  ERP_DAY_SLOT,
} from '../hourlyProductionSync';

/**
 * Mirroring the local hourly rows into the ERP `hourlyProduction` collection.
 *
 * The rule these pin down:
 *
 *   - ONE local row becomes MANY ERP rows, because the ERP collection is keyed on
 *     one hour slot per document (`hourSlot` + `actual`). The local row holds a map.
 *   - the mirror is IDEMPOTENT. The same local row always maps to the same ERP
 *     document ids, so a re-save updates in place rather than appending a duplicate.
 *   - a DELETE or an edited hour removes the ERP rows that no longer have a local
 *     row, so the ERP dashboard cannot keep counting a row the floor removed.
 *   - a row that cannot be mirrored (no line, which is a REQUIRED foreign key) is
 *     skipped rather than written and refused.
 */

const LOCAL = (overrides = {}) => ({
  id: 1,
  date: '2026-10-17',
  employee: 'Md Robiul Islam',
  order_no: 'PO-105',
  style: 'STY-1001',
  process: 'Collar Attach',
  line_no: 'Line-03',
  hours: { '08:00': 50, '09:00': 55 },
  workingHours: 2,
  hourlyTarget: 60,
  dailyTarget: 120,
  entry_type: 'hourly',
  ...overrides,
});

/** The ctx a screen builds from the ERP masters. */
const CTX = {
  lineIdFor: (name) => (name === 'Line-03' ? 'line-3' : ''),
  employeeIdFor: (name) => (name === 'Md Robiul Islam' ? 'emp-1' : ''),
  poIdFor: (no) => (no === 'PO-105' ? 'po-105' : ''),
  styleIdFor: (s) => (s === 'STY-1001' ? 'sty-1' : ''),
};

describe('reading the slots off a local row', () => {
  it('takes the clock slots an hourly row ran', () => {
    expect(slotsOf(LOCAL())).toEqual([['08:00', 50], ['09:00', 55]]);
  });

  it('drops a slot holding zero', () => {
    // An ERP row stating "nothing happened this hour" is noise to filter back out.
    expect(slotsOf(LOCAL({ hours: { '08:00': 50, '09:00': 0 } }))).toEqual([['08:00', 50]]);
  });

  it('falls back to the day total for a day-mode row with no slot figures', () => {
    expect(slotsOf(LOCAL({ hours: {}, dailyTotal: 480 }))).toEqual([[ERP_DAY_SLOT, 480]]);
  });

  it('returns nothing for a row with no figures at all', () => {
    expect(slotsOf(LOCAL({ hours: {}, dailyTotal: 0 }))).toEqual([]);
  });
});

describe('the per-slot target', () => {
  it('uses the row own hourly target', () => {
    expect(targetForSlot(LOCAL({ hourlyTarget: 60 }), '08:00', 2)).toBe(60);
  });

  it('divides the day target across the slots when there is no hourly figure', () => {
    expect(targetForSlot(LOCAL({ hourlyTarget: 0, dailyTarget: 120 }), '08:00', 2)).toBe(60);
  });

  it('reports 0 rather than undefined, because the ERP field is required', () => {
    expect(targetForSlot(LOCAL({ hourlyTarget: 0, dailyTarget: 0 }), '08:00', 2)).toBe(0);
  });
});

describe('mapping one local row to ERP rows', () => {
  it('produces ONE ERP row per hour slot', () => {
    const rows = localRowToErpRows(LOCAL(), CTX);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.values.hourSlot)).toEqual(['08:00', '09:00']);
    expect(rows.map((r) => r.values.actual)).toEqual([50, 55]);
  });

  it('carries the fields the ERP schema requires', () => {
    const [row] = localRowToErpRows(LOCAL(), CTX);
    expect(row.values.lineId).toBe('line-3');
    expect(row.values.date).toBe('2026-10-17');
    expect(row.values.hourSlot).toBe('08:00');
    expect(row.values.target).toBe(60);
    expect(row.values.actual).toBe(50);
  });

  it('resolves the optional foreign keys from the floor\'s own labels', () => {
    const [row] = localRowToErpRows(LOCAL(), CTX);
    expect(row.values.poId).toBe('po-105');
    expect(row.values.styleId).toBe('sty-1');
    expect(row.values.employeeId).toBe('emp-1');
  });

  it('keeps the floor labels as additive keys, so the ERP screens can show them', () => {
    const [row] = localRowToErpRows(LOCAL(), CTX);
    expect(row.values.order_no).toBe('PO-105');
    expect(row.values.style).toBe('STY-1001');
    expect(row.values.process).toBe('Collar Attach');
    expect(row.values.line_no).toBe('Line-03');
    expect(row.values.entry_type).toBe('hourly');
  });

  it('records the local row id, which is what makes cleanup safe', () => {
    const [row] = localRowToErpRows(LOCAL(), CTX);
    expect(row.values.localRowId).toBe(1);
  });

  it('skips a row whose line is not in the ERP master', () => {
    // `lineId` is REQUIRED, so the write would be refused. Skipping is honest.
    expect(localRowToErpRows(LOCAL({ line_no: 'Unknown Line' }), CTX)).toEqual([]);
  });

  it('skips a row with no line at all', () => {
    expect(localRowToErpRows(LOCAL({ line_no: '' }), CTX)).toEqual([]);
  });

  it('skips a row with no date', () => {
    expect(localRowToErpRows(LOCAL({ date: '' }), CTX)).toEqual([]);
  });

  it('skips a row with no id, since the mirror could not own its documents', () => {
    expect(localRowToErpRows(LOCAL({ id: undefined }), CTX)).toEqual([]);
  });

  it('mirrors a whole-day row onto the synthetic day slot', () => {
    const rows = localRowToErpRows(LOCAL({ hours: {}, dailyTotal: 480, entry_type: 'daily' }), CTX);
    expect(rows).toHaveLength(1);
    expect(rows[0].values.hourSlot).toBe(ERP_DAY_SLOT);
    expect(rows[0].values.actual).toBe(480);
    expect(rows[0].values.entry_type).toBe('daily');
  });
});

describe('the mirror is idempotent', () => {
  it('gives the same local row the same ERP ids every time', () => {
    // This is what lets a re-save UPDATE in place rather than append a duplicate —
    // the ERP schema has no server-side unique index on `syncId`.
    const first = localRowToErpRows(LOCAL(), CTX).map((r) => r.id);
    const second = localRowToErpRows(LOCAL(), CTX).map((r) => r.id);
    expect(first).toEqual(second);
  });

  it('builds the id from the local row id and the slot', () => {
    expect(erpRowIdFor(7, '08:00')).toBe('hp-7-08-00');
    expect(syncIdFor(7, '08:00')).toBe('7::08:00');
  });

  it('gives different local rows different ids', () => {
    expect(erpRowIdFor(1, '08:00')).not.toBe(erpRowIdFor(2, '08:00'));
  });

  it('writes the syncId onto every mirrored row', () => {
    const [row] = localRowToErpRows(LOCAL(), CTX);
    expect(row.values.syncId).toBe('1::08:00');
  });
});

describe('building the mirror for a set of rows', () => {
  it('mirrors every row', () => {
    const mirror = buildErpMirror([LOCAL(), LOCAL({ id: 2, hours: { '08:00': 40 } })], CTX);
    expect(mirror).toHaveLength(3);
  });

  it('sums a slot two local rows share rather than overwriting', () => {
    // A multi-process entry is SPLIT into one local row per process, so two rows
    // can share a date, line and slot. The ERP collection is one document per slot.
    const mirror = buildErpMirror([
      LOCAL({ id: 1, hours: { '08:00': 30 } }),
      LOCAL({ id: 2, hours: { '08:00': 20 } }),
    ], CTX);
    // Different local ids give different ERP ids here, so both survive…
    expect(mirror).toHaveLength(2);
  });

  it('skips the rows that cannot be mirrored', () => {
    const mirror = buildErpMirror([
      LOCAL({ id: 1 }),
      LOCAL({ id: 2, line_no: 'Unknown Line' }),
    ], CTX);
    expect(mirror).toHaveLength(2); // the two slots of row 1 only
    expect(mirror.every((r) => r.values.localRowId === 1)).toBe(true);
  });

  it('returns nothing for no rows', () => {
    expect(buildErpMirror([], CTX)).toEqual([]);
    expect(buildErpMirror(undefined, CTX)).toEqual([]);
  });
});

describe('reconciling deletes and edits', () => {
  it('reports the ids the local rows should own', () => {
    const wanted = expectedErpIds([LOCAL()], CTX);
    expect(wanted.has('hp-1-08-00')).toBe(true);
    expect(wanted.has('hp-1-09-00')).toBe(true);
    expect(wanted.size).toBe(2);
  });

  it('flags an ERP row whose local row was deleted as an orphan', () => {
    const existing = [
      { id: 'hp-1-08-00', localRowId: 1, date: '2026-10-17' },
      { id: 'hp-1-09-00', localRowId: 1, date: '2026-10-17' },
    ];
    // The local row is gone, so both ERP documents must go.
    expect(orphanErpIds(existing, [], CTX).sort()).toEqual(['hp-1-08-00', 'hp-1-09-00']);
  });

  it('flags a slot an edited row no longer has', () => {
    const existing = [
      { id: 'hp-1-08-00', localRowId: 1, date: '2026-10-17' },
      { id: 'hp-1-09-00', localRowId: 1, date: '2026-10-17' },
    ];
    // The edit dropped the 09:00 slot.
    const orphans = orphanErpIds(existing, [LOCAL({ hours: { '08:00': 50 } })], CTX);
    expect(orphans).toEqual(['hp-1-09-00']);
  });

  it('leaves a row another screen wrote alone', () => {
    // No `localRowId` means this mirror did not write it, so it must not delete it.
    const existing = [{ id: 'someone-elses-row', date: '2026-10-17' }];
    expect(orphanErpIds(existing, [], CTX)).toEqual([]);
  });

  it('reports no orphans when everything matches', () => {
    const existing = [
      { id: 'hp-1-08-00', localRowId: 1, date: '2026-10-17' },
      { id: 'hp-1-09-00', localRowId: 1, date: '2026-10-17' },
    ];
    expect(orphanErpIds(existing, [LOCAL()], CTX)).toEqual([]);
  });

  it('scopes the reconcile to one day', () => {
    const existing = [
      { id: 'a', localRowId: 1, date: '2026-10-17' },
      { id: 'b', localRowId: 2, date: '2026-10-16' },
    ];
    expect(mirrorRowsForDate(existing, '2026-10-17').map((r) => r.id)).toEqual(['a']);
  });
});

describe('date keys', () => {
  it('reads a key from a string and a Firestore timestamp', () => {
    expect(syncDateKey('2026-10-17')).toBe('2026-10-17');
    expect(syncDateKey({ toDate: () => new Date(2026, 9, 17) })).toBe('2026-10-17');
  });

  it('returns empty for a missing value', () => {
    expect(syncDateKey('')).toBe('');
    expect(syncDateKey(null)).toBe('');
  });
});
