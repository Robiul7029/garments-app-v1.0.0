import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import LineBalancingSection from '../LineBalancingSection';

/**
 * The Smart Line Balancing & Target Generator.
 *
 * It sits under the Capacity panel and answers the planning question the panel
 * does not: how the work divides across the operators. The maths here is the same
 * formula the panel uses, so the figures below are pinned against the same worked
 * example (25 operators, 8 hours, 70% efficiency) — if the two ever disagree, one
 * of these tests fails.
 */
const SHEET = [
  { operation: 'Collar Attach', machine: 'Overlock', smv: 1.2, section: 'Front' },
  { operation: 'Sleeve Join', machine: 'Overlock', smv: 1.5, section: 'Sleeve' },
  { operation: 'Side Seam', machine: 'Flatlock', smv: 2.1, section: 'Body' },
  { operation: 'Hemming', machine: 'Flatlock', smv: 1.7, section: 'Bottom' },
];

const render = (props) => renderToStaticMarkup(<LineBalancingSection {...props} />);

describe('the line balancing section', () => {
  it('shows the planning inputs with English labels and the requested shift defaults', () => {
    const html = render({ totalSMV: 6.5, operationsList: SHEET });
    expect(html).toContain('Total SMV (min)');
    expect(html).toContain('Total Manpower');
    expect(html).toContain('Working Hours');
    expect(html).toContain('Target Efficiency %');
    expect(html).toContain('value="10"');
    expect(html).toContain('value="100"');
    expect(html).not.toMatch(/[\u0980-\u09FF]/);
  });

  it('acts on the total SMV of the sheet it was given', () => {
    const html = render({ totalSMV: 6.5, operationsList: SHEET });
    expect(html).toContain('Total SMV 6.5');
    expect(html).toContain('4 operations');
  });

  it('derives daily and hourly targets from manpower, hours and efficiency', () => {
    // 25 × 8 × 60 × 70% = 8400 available minutes; ÷ 6.5 = 1292/day.
    const html = render({
      totalSMV: 6.5,
      operationsList: SHEET,
      defaults: { manpower: 25, workingHours: 8, efficiency: 70 },
    });
    expect(html).toContain('1,292');
    expect(html).toContain('161');
    expect(html).toContain('8,400');
  });

  it('reports the operator load as total SMV over manpower', () => {
    const html = render({
      totalSMV: 6.5,
      operationsList: SHEET,
      defaults: { manpower: 25, workingHours: 8, efficiency: 70 },
    });
    expect(html).toContain('Standard work per operator');
    expect(html).toContain('0.26'); // 6.5 ÷ 25
  });

  it('names the manpower in the English planning note', () => {
    const html = render({
      totalSMV: 6.5,
      operationsList: SHEET,
      defaults: { manpower: 25, workingHours: 8, efficiency: 70 },
    });
    expect(html).toContain('Planning note');
    expect(html).toContain('With 25 operators on the line');
  });

  it('states the missing-SMV case in English instead of alerting', () => {
    const html = render({ totalSMV: 0, operationsList: [] });
    expect(html).toContain('Select or upload a process sheet to load its total SMV.');
    expect(html).toContain('No SMV yet');
    expect(html).not.toContain('Production &amp; Target Summary');
  });

  it('shows the target summary automatically without a calculate button', () => {
    const html = render({ totalSMV: 6.5, operationsList: SHEET });
    expect(html).toContain('Production &amp; Target Summary');
    expect(html).not.toContain('Calculate Target &amp; Layout Plan');
  });

  it('falls back to the factory defaults when hours or efficiency are blank', () => {
    // A blank box should not silently plan a zero-piece day.
    const html = render({
      totalSMV: 6.5,
      operationsList: SHEET,
      defaults: { manpower: 25, workingHours: '', efficiency: '' },
    });
    // Blank shift fields fall back to 10 hours and 100% efficiency.
    expect(html).toContain('2,307');
    expect(html).toContain('230');
  });
});
