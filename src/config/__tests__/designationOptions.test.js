import { describe, it, expect } from 'vitest';
import {
  DESIGNATION_OPTIONS_KEY,
  cleanDesignation,
  storedDesignations,
  designationOptionsFor,
  addDesignationOption,
  matchingDesignation,
  designationsInUse,
  DESIGNATIONS,
} from '../employeeDirectory';

/**
 * The "+ Add" button's store and merge rules.
 *
 * The brief: a designation typed into the form's custom box and added with the button
 * must (a) become the selected value at once and (b) persist into the active options
 * list, so it is selectable for the next person rather than having to be retyped.
 *
 * These tests cover the DATA half of that; the render tests cover the button itself.
 */

describe('the custom-designation store', () => {
  it('lives in its own collection', () => {
    // Separate from the directory on purpose: a grade added by hand must survive
    // before any employee carries it.
    expect(DESIGNATION_OPTIONS_KEY).toBe('designation-options');
  });

  it('cleans a typed value', () => {
    expect(cleanDesignation('  Line   Trainer ')).toBe('Line Trainer');
    expect(cleanDesignation('')).toBe('');
    expect(cleanDesignation(undefined)).toBe('');
    expect(cleanDesignation('   ')).toBe('');
  });

  it('tolerates a missing or malformed store', () => {
    expect(storedDesignations(undefined)).toEqual([]);
    expect(storedDesignations(null)).toEqual([]);
    expect(storedDesignations('nope')).toEqual([]);
    expect(storedDesignations(['Trainer', '', '  ', '  Ironer '])).toEqual(['Trainer', 'Ironer']);
  });
});

describe('the merged options list', () => {
  it('offers the presets when nothing was added', () => {
    expect(designationOptionsFor([], [])).toEqual(DESIGNATIONS);
  });

  it('appends an added value after the presets and the in-use custom values', () => {
    const directory = [{ name: 'A', designation: 'Trainer' }];
    expect(designationOptionsFor(directory, ['Ironer'])).toEqual([
      ...designationsInUse(directory), 'Ironer',
    ]);
  });

  it('does not list a value twice, whatever its casing', () => {
    // "trainer" was added by hand; "Trainer" is already on a record. One entry only.
    const directory = [{ name: 'A', designation: 'Trainer' }];
    expect(designationOptionsFor(directory, ['trainer', 'TRAINER'])).toEqual(
      designationsInUse(directory),
    );
  });

  it('never duplicates a preset', () => {
    expect(designationOptionsFor([], ['operator', 'QC'])).toEqual(DESIGNATIONS);
  });
});

describe('adding an option', () => {
  it('appends a genuinely new value', () => {
    expect(addDesignationOption([], 'Ironer', DESIGNATIONS)).toEqual(['Ironer']);
    expect(addDesignationOption(['Ironer'], 'Trainer', DESIGNATIONS)).toEqual(['Ironer', 'Trainer']);
  });

  it('trims what it stores', () => {
    expect(addDesignationOption([], '  Line   Ironer ', DESIGNATIONS)).toEqual(['Line Ironer']);
  });

  it('returns null — writes nothing — for a blank value', () => {
    expect(addDesignationOption([], '', DESIGNATIONS)).toBeNull();
    expect(addDesignationOption([], '   ', DESIGNATIONS)).toBeNull();
    expect(addDesignationOption([], undefined, DESIGNATIONS)).toBeNull();
  });

  it('returns null when the list already carries the value, in any casing', () => {
    // The caller then SELECTS the existing spelling instead of adding a second one.
    expect(addDesignationOption([], 'operator', DESIGNATIONS)).toBeNull();
    expect(addDesignationOption([], 'Supervisor', DESIGNATIONS)).toBeNull();
    expect(addDesignationOption(['Trainer'], 'trainer', DESIGNATIONS)).toBeNull();
  });
});

describe('selecting the added value', () => {
  it('selects the typed value as-is when it is new', () => {
    expect(matchingDesignation(DESIGNATIONS, 'Ironer')).toBe('Ironer');
  });

  it('selects the list’s own spelling when the value already exists', () => {
    // Adding "operator" must not create a second, lower-cased option.
    expect(matchingDesignation(DESIGNATIONS, 'operator')).toBe('Operator');
    expect(matchingDesignation(DESIGNATIONS, '  qc ')).toBe('QC');
  });

  it('returns an empty string for a blank value', () => {
    expect(matchingDesignation(DESIGNATIONS, '   ')).toBe('');
  });
});
