import { describe, it, expect } from 'vitest';
import {
  capacitySettings,
  availableMinutes,
  calculateCapacity,
  processCapacity,
  targetForOperation,
  achievementVsTarget,
  hourlyVariance,
  buildCapacityRecord,
  capacityForStyle,
  DEFAULT_WORKING_HOURS,
  DEFAULT_EFFICIENCY,
} from '../smvTargetEngine';

/**
 * Tests for the SMV & manpower target engine.
 *
 * One formula underpins every target in the app, so it is pinned here with worked
 * numbers, including the boundary cases that a factory actually hits: an operation
 * with no SMV, a line with nobody on it, and a target of zero.
 *
 * The reference case, worked by hand:
 *   25 operators × 8 hours × 60 × 70% = 8,400 minutes available
 *   8,400 ÷ 6.5 total SMV          = 1,292.3 → 1,292 pieces/day
 *   1,292 ÷ 8 hours                = 161 pieces/hour
 */
const SHEET = [
  { operation: 'Collar Attach', machine: 'Overlock', smv: 1.2, section: 'Front' },
  { operation: 'Sleeve Join', machine: 'Overlock', smv: 1.5, section: 'Sleeve' },
  { operation: 'Side Seam', machine: 'Flatlock', smv: 2.1, section: 'Body' },
  { operation: 'Hemming', machine: 'Flatlock', smv: 1.7, section: 'Bottom' },
];
// Total SMV of SHEET = 1.2 + 1.5 + 2.1 + 1.7 = 6.5

describe('capacity settings', () => {
  it('applies the documented defaults', () => {
    const s = capacitySettings({});
    expect(s.workingHours).toBe(DEFAULT_WORKING_HOURS);
    expect(s.efficiency).toBe(DEFAULT_EFFICIENCY);
    expect(s.manpower).toBe(0);
  });

  it('reads the values it is given', () => {
    expect(capacitySettings({ manpower: 25, workingHours: 7.5, efficiency: 65 }))
      .toEqual({ manpower: 25, workingHours: 7.5, efficiency: 65 });
  });

  it('accepts the alternative field names another caller might use', () => {
    expect(capacitySettings({ totalManpower: 12, hours: 9 }).manpower).toBe(12);
    expect(capacitySettings({ hours: 9 }).workingHours).toBe(9);
  });

  it('caps efficiency at 100%', () => {
    // Above 100% would invent capacity that does not exist.
    expect(capacitySettings({ efficiency: 140 }).efficiency).toBe(100);
  });

  it('falls back to the default for an unusable efficiency', () => {
    [0, -5, '', null, undefined, 'abc'].forEach((bad) => {
      expect(capacitySettings({ efficiency: bad }).efficiency).toBe(DEFAULT_EFFICIENCY);
    });
  });

  it('never returns a negative manpower', () => {
    expect(capacitySettings({ manpower: -3 }).manpower).toBe(0);
  });
});

describe('available minutes', () => {
  it('is manpower × hours × 60 × efficiency', () => {
    expect(availableMinutes({ manpower: 25, workingHours: 8, efficiency: 70 })).toBe(8400);
  });

  it('is zero when nobody is deployed', () => {
    expect(availableMinutes({ manpower: 0, workingHours: 8, efficiency: 70 })).toBe(0);
  });
});

describe('the line target', () => {
  const capacity = calculateCapacity(SHEET, { manpower: 25, workingHours: 8, efficiency: 70 });

  it('sums the SMV of every operation', () => {
    expect(capacity.totalSmv).toBe(6.5);
  });

  it('computes the daily target from minutes divided by total SMV', () => {
    expect(capacity.line.dailyTarget).toBe(1292);
  });

  it('computes the hourly target from the daily figure', () => {
    expect(capacity.line.hourlyTarget).toBe(161);
  });

  it('reports the per-operator figure used for line balancing', () => {
    // 1292 ÷ 25 operators.
    expect(capacity.line.perOperatorDaily).toBe(51);
  });

  it('reports the minutes it worked from, for a reader checking the maths', () => {
    expect(capacity.minutes).toBe(8400);
  });

  it('scales with manpower', () => {
    const half = calculateCapacity(SHEET, { manpower: 12, workingHours: 8, efficiency: 70 });
    expect(half.line.dailyTarget).toBe(620); // 4032 ÷ 6.5
    expect(half.line.dailyTarget).toBeLessThan(capacity.line.dailyTarget);
  });

  it('scales with efficiency', () => {
    const better = calculateCapacity(SHEET, { manpower: 25, workingHours: 8, efficiency: 100 });
    expect(better.line.dailyTarget).toBe(1846); // 12000 ÷ 6.5
  });

  it('scales with hours', () => {
    const longer = calculateCapacity(SHEET, { manpower: 25, workingHours: 10, efficiency: 70 });
    expect(longer.line.dailyTarget).toBe(1615); // 10500 ÷ 6.5
  });
});

describe('boundaries that would otherwise produce nonsense', () => {
  it('reports no capacity for an empty sheet', () => {
    const empty = calculateCapacity([], { manpower: 25, workingHours: 8, efficiency: 70 });
    expect(empty.line.dailyTarget).toBe(0);
    expect(empty.usable).toBe(false);
    expect(empty.totalSmv).toBe(0);
  });

  it('reports no capacity when nobody is deployed', () => {
    const none = calculateCapacity(SHEET, { manpower: 0, workingHours: 8, efficiency: 70 });
    expect(none.line.dailyTarget).toBe(0);
    expect(none.usable).toBe(false);
  });

  it('does not divide by zero when no operation has an SMV', () => {
    const noSmv = calculateCapacity(
      [{ operation: 'Unknown', smv: 0 }],
      { manpower: 20, workingHours: 8, efficiency: 70 },
    );
    expect(noSmv.line.dailyTarget).toBe(0);
    expect(noSmv.usable).toBe(false);
    // The gap is reported rather than hidden.
    expect(noSmv.missingSmv).toEqual(['Unknown']);
  });

  it('names the operations that have no SMV', () => {
    const partly = calculateCapacity(
      [...SHEET, { operation: 'Bar Tack', smv: 0 }, { operation: 'Button Hole', smv: '' }],
      { manpower: 25, workingHours: 8, efficiency: 70 },
    );
    expect(partly.missingSmv).toEqual(['Bar Tack', 'Button Hole']);
    // The total ignores them, so the line figure understates real capacity —
    // which is exactly why they are named.
    expect(partly.totalSmv).toBe(6.5);
  });

  it('never returns a fraction of a piece', () => {
    const odd = calculateCapacity([{ operation: 'X', smv: 3 }], { manpower: 1, workingHours: 1, efficiency: 70 });
    // 42 ÷ 3 = 14 exactly; use a value that does not divide cleanly.
    const messy = calculateCapacity([{ operation: 'X', smv: 7 }], { manpower: 1, workingHours: 1, efficiency: 70 });
    expect(Number.isInteger(odd.line.dailyTarget)).toBe(true);
    expect(Number.isInteger(messy.line.dailyTarget)).toBe(true);
    expect(messy.line.dailyTarget).toBe(6); // 42 ÷ 7 = 6
  });
});

describe('per-operation targets', () => {
  const capacity = calculateCapacity(SHEET, { manpower: 25, workingHours: 8, efficiency: 70 });

  it('computes a target for every operation', () => {
    expect(capacity.perProcess).toHaveLength(4);
  });

  it('computes each from that operation’s own SMV', () => {
    const collar = capacity.perProcess.find((p) => p.name === 'Collar Attach');
    // 8400 ÷ 1.2 = 7000 pieces if the whole line worked only this operation.
    expect(collar.dailyTarget).toBe(7000);
    expect(collar.hourlyTarget).toBe(875); // 7000 ÷ 8
  });

  it('gives a slower operation a lower target', () => {
    const sideSeam = capacity.perProcess.find((p) => p.name === 'Side Seam');
    const collar = capacity.perProcess.find((p) => p.name === 'Collar Attach');
    // 2.1 SMV is slower than 1.2, so fewer pieces.
    expect(sideSeam.dailyTarget).toBeLessThan(collar.dailyTarget);
    expect(sideSeam.dailyTarget).toBe(4000); // 8400 ÷ 2.1
  });

  it('reports what one operator achieves per hour, for balancing', () => {
    const collar = capacity.perProcess.find((p) => p.name === 'Collar Attach');
    // 60 minutes ÷ 1.2 SMV = 50 pieces per operator per hour.
    expect(collar.piecesPerOperatorPerHour).toBe(50);
  });

  it('carries the machine and section through for the table', () => {
    const collar = capacity.perProcess.find((p) => p.name === 'Collar Attach');
    expect(collar.machine).toBe('Overlock');
    expect(collar.section).toBe('Front');
  });

  it('flags an operation with no SMV instead of inventing a target', () => {
    const p = processCapacity({ operation: 'Bar Tack', smv: 0 }, 8400, { manpower: 25, workingHours: 8 });
    expect(p.hasSmv).toBe(false);
    expect(p.dailyTarget).toBe(0);
    expect(p.name).toBe('Bar Tack');
  });
});

describe('the auto-target for a production entry', () => {
  const settings = { manpower: 25, workingHours: 8, efficiency: 70 };

  it('derives the target from the operation’s SMV', () => {
    // ONE operator, one day: 8 × 60 × 0.70 = 336 minutes; 336 ÷ 1.2 = 280.
    const result = targetForOperation({
      operations: SHEET, settings, operationName: 'Collar Attach',
    });
    expect(result.hasSmv).toBe(true);
    expect(result.target).toBe(280);
    expect(result.hourlyTarget).toBe(35); // 280 ÷ 8
    expect(result.smv).toBe(1.2);
    expect(result.source).toBe('smv');
  });

  it('returns the per-OPERATOR target, not the whole line’s', () => {
    // A production row records what ONE person made, so the figure has to be one
    // operator's share. It is NOT simply the line target divided by manpower:
    // the line figure is built on the SUM of every operation's SMV (one piece
    // passes through all of them), while an operation's target is built on its
    // OWN SMV alone. Both are one-piece-per-operator figures; they answer
    // different questions.
    const line = calculateCapacity(SHEET, settings);
    const perOperator = targetForOperation({ operations: SHEET, settings, operationName: 'Collar Attach' });

    // The operation figure is smaller, because a single operation is a fraction
    // of the piece's total work.
    expect(perOperator.target).toBeLessThan(line.line.dailyTarget);
    expect(perOperator.target).toBe(280);

    // The relationship that DOES hold: the operation's line-wide capacity divided
    // by the operators equals the per-operator figure. That is the join between
    // the panel and the entry form, and the one a reader would check.
    const collar = line.perProcess.find((p) => p.name === 'Collar Attach');
    expect(Math.floor(collar.dailyTarget / settings.manpower)).toBe(perOperator.target);
  });

  it('matches the operation name regardless of case or padding', () => {
    const result = targetForOperation({
      operations: SHEET, settings, operationName: '  collar attach  ',
    });
    expect(result.hasSmv).toBe(true);
    expect(result.target).toBe(280);
  });

  it('falls back when the operation is not on the sheet', () => {
    const result = targetForOperation({
      operations: SHEET, settings, operationName: 'Not On Sheet', fallbackTarget: 42,
    });
    expect(result.hasSmv).toBe(false);
    expect(result.target).toBe(42);
    expect(result.source).toBe('manual');
  });

  it('falls back when the operation has no SMV', () => {
    const result = targetForOperation({
      operations: [{ operation: 'Bar Tack', smv: 0 }], settings, operationName: 'Bar Tack', fallbackTarget: 15,
    });
    expect(result.hasSmv).toBe(false);
    expect(result.target).toBe(15);
    expect(result.source).toBe('no-smv');
  });

  it('uses the defaults when no settings were saved for the style', () => {
    // 8 hours at 70%: 336 minutes ÷ 1.2 = 280.
    const result = targetForOperation({ operations: SHEET, operationName: 'Collar Attach' });
    expect(result.target).toBe(280);
  });

  it('responds to a different efficiency', () => {
    const result = targetForOperation({
      operations: SHEET, settings: { ...settings, efficiency: 100 }, operationName: 'Collar Attach',
    });
    // 480 minutes ÷ 1.2 = 400.
    expect(result.target).toBe(400);
  });
});

describe('achievement and variance', () => {
  it('reports a surplus as extra', () => {
    const r = achievementVsTarget(300, 280);
    expect(r.surplus).toBe(20);
    expect(r.shortfall).toBe(0);
    expect(r.isSurplus).toBe(true);
    expect(r.label).toBe('+20 Extra');
    expect(r.tone).toBe('good');
  });

  it('reports a shortfall as due', () => {
    const r = achievementVsTarget(268, 280);
    expect(r.shortfall).toBe(12);
    expect(r.surplus).toBe(0);
    expect(r.isShortfall).toBe(true);
    expect(r.label).toBe('12 Due');
    expect(r.tone).toBe('bad');
  });

  it('reports an exact hit as on target', () => {
    const r = achievementVsTarget(280, 280);
    expect(r.variance).toBe(0);
    expect(r.isOnTarget).toBe(true);
    expect(r.label).toBe('On target');
  });

  it('computes the achievement percentage', () => {
    expect(achievementVsTarget(280, 280).achievementPercent).toBe(100);
    expect(achievementVsTarget(140, 280).achievementPercent).toBe(50);
    expect(achievementVsTarget(294, 280).achievementPercent).toBe(105);
  });

  it('handles a zero target without dividing by zero', () => {
    const r = achievementVsTarget(50, 0);
    expect(r.hasTarget).toBe(false);
    expect(r.achievementPercent).toBe(0);
    expect(r.label).toBe('No target set');
    expect(r.tone).toBe('info');
  });

  it('treats a blank actual as zero, which is a real full shortfall', () => {
    const r = achievementVsTarget('', 280);
    expect(r.achieved).toBe(0);
    expect(r.shortfall).toBe(280);
    expect(r.label).toBe('280 Due');
  });

  it('never reports both a surplus and a shortfall', () => {
    [0, 100, 279, 280, 281, 500].forEach((done) => {
      const r = achievementVsTarget(done, 280);
      expect(r.surplus === 0 || r.shortfall === 0).toBe(true);
    });
  });
});

describe('hourly variance', () => {
  it('reports each hour against the hourly target', () => {
    const hours = {
      '08:00-09:00': { actual: 40 },
      '09:00-10:00': { actual: 30 },
      '10:00-11:00': { actual: 35 },
    };
    const rows = hourlyVariance(hours, 35);
    expect(rows[0].label).toBe('+5 Extra');
    expect(rows[1].label).toBe('5 Due');
    expect(rows[2].label).toBe('On target');
  });

  it('accepts a bare number as well as an object', () => {
    const rows = hourlyVariance({ '08:00-09:00': 20 }, 35);
    expect(rows[0].actual).toBe(20);
    expect(rows[0].shortfall).toBe(15);
  });

  it('returns an empty list for no hours', () => {
    expect(hourlyVariance({}, 35)).toEqual([]);
    expect(hourlyVariance(undefined, 35)).toEqual([]);
  });
});

describe('saving and reading the capacity for a style', () => {
  const capacity = calculateCapacity(SHEET, { manpower: 25, workingHours: 8, efficiency: 70 });

  it('builds a record carrying the settings and the results', () => {
    const record = buildCapacityRecord({
      style: 'STY-1001', order_no: 'PO-105',
      settings: { manpower: 25, workingHours: 8, efficiency: 70 },
      capacity,
    });
    expect(record.style).toBe('STY-1001');
    expect(record.manpower).toBe(25);
    expect(record.totalSmv).toBe(6.5);
    expect(record.lineDailyTarget).toBe(1292);
    expect(record.perProcess).toHaveLength(4);
  });

  it('finds the record again by style', () => {
    const record = buildCapacityRecord({ style: 'STY-1001', settings: {}, capacity });
    expect(capacityForStyle([record], { style: 'STY-1001' })).toBe(record);
  });

  it('falls back to the order number', () => {
    const record = buildCapacityRecord({ style: '', order_no: 'PO-105', settings: {}, capacity });
    expect(capacityForStyle([record], { order_no: 'PO-105' })).toBe(record);
  });

  it('returns null for a style with no saved capacity', () => {
    expect(capacityForStyle([], { style: 'STY-9' })).toBeNull();
    expect(capacityForStyle([], {})).toBeNull();
  });

  it('round-trips: a saved record reproduces the same auto-target', () => {
    // The linkage the brief asks for: Process Sheet → saved capacity → Daily
    // Production target. If this drifts, the floor is measured against a number
    // the process sheet never showed.
    const record = buildCapacityRecord({
      style: 'STY-1001',
      settings: { manpower: 25, workingHours: 8, efficiency: 70 },
      capacity,
    });
    const result = targetForOperation({
      operations: SHEET,
      settings: record,
      operationName: 'Collar Attach',
    });
    expect(result.target).toBe(280);
    // And the same figure the capacity panel's per-process row implies for one
    // operator: 7000 pieces line-wide ÷ 25 operators.
    const collar = capacity.perProcess.find((p) => p.name === 'Collar Attach');
    expect(Math.floor(collar.dailyTarget / record.manpower)).toBe(280);
  });
});
