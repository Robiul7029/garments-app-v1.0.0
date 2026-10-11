import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Tests that the demo employee names are gone for good.
 *
 * These read the seed source directly rather than rendering a provider, because
 * the failure this guards against is somebody re-adding a placeholder person to
 * the starter data — which a render test would faithfully reproduce rather than
 * catch.
 */

/** Strips comments so a doc-example mentioning a name is not read as data. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const SEED_SOURCE = readFileSync(new URL('../DataContext.jsx', import.meta.url), 'utf8');

const DEMO_NAMES = ['Salma', 'Rina', 'Karim', 'Jasmin', 'Rahim', 'Nasrin', 'Zakir', 'Robiul Awal'];

describe('the starter data carries no demo employees', () => {
  const code = stripComments(SEED_SOURCE);

  it('does not name a demo person in any seeded row', () => {
    // Scan the executable source, so the DEMO_NAMES list itself (which must
    // mention them in order to purge them) is not mistaken for a seeded row.
    const seedBlock = code.slice(code.indexOf('const seed = {'), code.indexOf('let nextId'));
    DEMO_NAMES.forEach((name) => {
      // 'Salma' appears inside 'Salma Khatun'; match the word, not the substring.
      const pattern = new RegExp(`['"\`]${name}(['"\` ])`, 'i');
      expect(pattern.test(seedBlock), `${name} is still in the seed`).toBe(false);
    });
  });

  it('starts the personal collections empty rather than with placeholder rows', () => {
    const seedBlock = code.slice(code.indexOf('const seed = {'), code.indexOf('let nextId'));
    // Each of these had fake rows before; they must now be empty arrays.
    ['daily-production', 'worker-production', 'cutting-production', 'daily-attendance',
      'finishing-production', 'attendance-leave', 'leave-requests', 'salary',
      'hourly-timesheet-rows', 'late']
      .forEach((key) => {
        const pattern = new RegExp(`'?${key}'?:\\s*\\[\\s*\\]`);
        expect(pattern.test(seedBlock), `${key} still has seeded rows`).toBe(true);
      });
  });

  it('still seeds the things that are genuinely reference data', () => {
    const seedBlock = code.slice(code.indexOf('const seed = {'), code.indexOf('let nextId'));
    // Orders, styles and stock are configuration, not people — removing them
    // would leave every form with no style to select.
    expect(seedBlock).toContain("'order-model'");
    expect(seedBlock).toContain('STY-1001');
  });

  it('builds the directory from the Smart Attendance roster', () => {
    expect(SEED_SOURCE).toContain('STANDARD_WORKERS');
    expect(SEED_SOURCE).toMatch(/EMPLOYEE_DIRECTORY = STANDARD_WORKERS\.map/);
  });
});

describe('the migration purges demo data already stored in a browser', () => {
  it('defines a version and a migration step', () => {
    expect(SEED_SOURCE).toContain('DATA_VERSION');
    expect(SEED_SOURCE).toContain('function migrate(');
    // Without a version bump the migration would never run for an existing user.
    expect(SEED_SOURCE).toMatch(/DATA_VERSION = \d+/);
  });

  it('lists the person-named collections it cleans', () => {
    expect(SEED_SOURCE).toContain('PERSON_FIELDS');
    ['daily-production', 'daily-attendance', 'salary'].forEach((key) => {
      expect(SEED_SOURCE).toContain(key);
    });
  });

  it('writes the migrated payload back, so a reload does not undo it', () => {
    // loadData() must persist what it migrated, or the purge would only last
    // until the next page load.
    const loadBlock = SEED_SOURCE.slice(SEED_SOURCE.indexOf('function loadData'));
    expect(loadBlock).toContain('localStorage.setItem(DATA_KEY');
  });

  it('merges the seed LAST, so purge results are not overwritten', () => {
    // `{ ...seed, ...migrated }` — migrated wins. The reverse order would put the
    // demo rows straight back.
    expect(SEED_SOURCE).toContain('{ ...seed, ...migrated }');
  });
});
