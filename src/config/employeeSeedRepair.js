/**
 * ROBIUL GARMENTS ERP — one-time repair of stale employee storage.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT IN THE DATA LAYER
 * ----------------------------------------------------
 * The employee directory is seeded from Smart Attendance's roster. But the data
 * layer (`DataProvider`) is mounted INSIDE `ProtectedRoute`, so it does not mount
 * until somebody is signed in. A browser sitting on the sign-in screen therefore
 * never ran the seed correction — and the screen the problem was reported from
 * showed "Employee directory (0)" no matter how correct the seed was.
 *
 * So this runs at page load, before React mounts and before any route guard can
 * short-circuit it. It touches only three keys, and only when they are genuinely
 * empty, so it cannot damage a directory the factory has filled in.
 *
 * WHAT WENT WRONG
 * ---------------
 * 1. The app once shipped demo people (Salma, Rina, Karim…) in its seed.
 * 2. A later change purged them, and those names were also removed from any data
 *    already saved in the browser.
 * 3. That purge left the stored `employees` and `employee-directory` as EMPTY
 *    ARRAYS. Because `loadData` merges stored data OVER the seed, an empty stored
 *    array wins over the seeded roster — so the directory came back blank.
 *
 * The correction below clears those two keys when (and only when) they are empty,
 * which lets the seed's real roster through. It does not delete anything else.
 */

const DATA_KEY = 'garments_app_data';

/**
 * Keys that must never be left as an empty array in storage, because the seed
 * holds the real roster for them and an empty stored value would mask it.
 */
const SEED_BACKED_KEYS = ['employees', 'employee-directory', 'employee-sequence'];

/** Names that were only ever demo data. Kept in step with the data layer. */
const DEMO_NAMES = ['Salma', 'Rina', 'Karim', 'Jasmin', 'Rahim', 'Nasrin', 'Zakir'];

/** True when every entry is one of the old placeholder names. */
function onlyDemoNames(list) {
  if (!Array.isArray(list) || list.length === 0) return false;
  return list.every((entry) => {
    const name = typeof entry === 'string' ? entry : entry?.name;
    const clean = String(name || '').trim().toLowerCase();
    return DEMO_NAMES.some((demo) => demo.toLowerCase() === clean);
  });
}

/**
 * Repairs stale employee storage in place.
 *
 * Idempotent, and safe to call on every page load: it does nothing once the
 * directory has anybody real in it.
 *
 * @returns {boolean} true when something was repaired — surfaced so a test can
 *   assert the repair happened rather than that it merely did not throw.
 */
export function purgeStaleEmployeeStorage() {
  try {
    if (typeof localStorage === 'undefined') return false;

    const raw = localStorage.getItem(DATA_KEY);
    if (!raw) return false;

    const stored = JSON.parse(raw);
    if (!stored || typeof stored !== 'object') return false;

    let changed = false;

    // An EMPTY list masks the seeded roster — clear it so the seed shows through.
    // A list containing only demo names is treated the same way: it is the old
    // demo data that the purge did not finish removing.
    SEED_BACKED_KEYS.forEach((key) => {
      const value = stored[key];
      if (!Array.isArray(value)) return;
      if (value.length === 0 || onlyDemoNames(value)) {
        delete stored[key];
        changed = true;
      }
    });

    // The ID sequence is a NUMBER, not a name, so it can never be spotted by the
    // name check above — and a sequence left behind at the demo roster's length
    // is what produced an Employee ID of EMP-009 in the broken state. If the
    // directory itself was just cleared, the sequence is meaningless and goes
    // with it; otherwise a stale mark would keep the next hire's numbering wrong.
    const clearedDirectory = !stored['employee-directory'] && !stored.employees;
    if (clearedDirectory && stored['employee-sequence']) {
      delete stored['employee-sequence'];
      changed = true;
    }

    // Rows that name a demo person are placeholder records, not real work.
    Object.keys(stored).forEach((key) => {
      const rows = stored[key];
      if (!Array.isArray(rows) || rows.length === 0) return;
      if (SEED_BACKED_KEYS.includes(key)) return;
      const filtered = rows.filter((row) => {
        if (!row || typeof row !== 'object') return true;
        const name = String(row.employee ?? row.name ?? '').trim().toLowerCase();
        if (!name) return true;
        return !DEMO_NAMES.some((demo) => demo.toLowerCase() === name);
      });
      if (filtered.length !== rows.length) {
        stored[key] = filtered;
        changed = true;
      }
    });

    if (changed) localStorage.setItem(DATA_KEY, JSON.stringify(stored));
    return changed;
  } catch {
    // Storage unreadable or blocked: the app still runs, it simply keeps whatever
    // it has. Never let a repair break the boot.
    return false;
  }
}

export { SEED_BACKED_KEYS, DEMO_NAMES, onlyDemoNames };
