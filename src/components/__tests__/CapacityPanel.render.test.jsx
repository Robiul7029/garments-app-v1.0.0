import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CapacityPanel from '../CapacityPanel';
import { AchievementPanel } from '../DailyProductionSheet';

/**
 * Renders the two panels that make the workflow visible.
 *
 * The maths is pinned in smvTargetEngine.test.js; this checks the panels actually
 * show it — the figures a supervisor reads off the screen.
 */
const SHEET = [
  { operation: 'Collar Attach', machine: 'Overlock', smv: 1.2, section: 'Front' },
  { operation: 'Sleeve Join', machine: 'Overlock', smv: 1.5, section: 'Sleeve' },
  { operation: 'Side Seam', machine: 'Flatlock', smv: 2.1, section: 'Body' },
  { operation: 'Hemming', machine: 'Flatlock', smv: 1.7, section: 'Bottom' },
];

const render = (element) => renderToStaticMarkup(element);

describe('the capacity panel', () => {
  const settings = { manpower: 25, workingHours: 8, efficiency: 70 };

  it('shows the three inputs', () => {
    const html = render(<CapacityPanel operations={SHEET} settings={settings} onSettingsChange={() => {}} />);
    expect(html).toContain('Total deployed manpower');
    expect(html).toContain('Working hours');
    expect(html).toContain('Efficiency %');
  });

  it('pre-fills the inputs with the values in force', () => {
    const html = render(<CapacityPanel operations={SHEET} settings={settings} onSettingsChange={() => {}} />);
    expect(html).toContain('value="25"');
    expect(html).toContain('value="8"');
    expect(html).toContain('value="70"');
  });

  it('shows the line daily and hourly targets', () => {
    const html = render(<CapacityPanel operations={SHEET} settings={settings} onSettingsChange={() => {}} />);
    expect(html).toContain('Line daily target');
    expect(html).toContain('Line hourly target');
    expect(html).toContain('1,292'); // 8400 ÷ 6.5
    expect(html).toContain('161');   // 1292 ÷ 8
  });

  it('shows the total SMV it worked from', () => {
    const html = render(<CapacityPanel operations={SHEET} settings={settings} onSettingsChange={() => {}} />);
    expect(html).toContain('total SMV 6.5');
  });

  it('shows every operation with its own target and SMV', () => {
    const html = render(<CapacityPanel operations={SHEET} settings={settings} onSettingsChange={() => {}} />);
    ['Collar Attach', 'Sleeve Join', 'Side Seam', 'Hemming'].forEach((op) => expect(html).toContain(op));
    expect(html).toContain('Hourly capacity');
    expect(html).toContain('Daily capacity');
    expect(html).toContain('7,000'); // Collar Attach, 8400 ÷ 1.2
    expect(html).toContain('4,000'); // Side Seam, 8400 ÷ 2.1
  });

  it('shows the per-operator column used for line balancing', () => {
    const html = render(<CapacityPanel operations={SHEET} settings={settings} onSettingsChange={() => {}} />);
    expect(html).toContain('1 operator / hr');
    expect(html).toContain('50'); // 60 ÷ 1.2
  });

  it('prompts for manpower when none is entered', () => {
    const html = render(<CapacityPanel operations={SHEET} settings={{ manpower: 0 }} onSettingsChange={() => {}} />);
    expect(html).toContain('Enter the deployed manpower');
  });

  it('prompts when there are no operations at all', () => {
    const html = render(<CapacityPanel operations={[]} settings={settings} onSettingsChange={() => {}} />);
    expect(html).toContain('Upload or add operation rows');
  });

  it('warns about operations with no SMV rather than hiding them', () => {
    const html = render(
      <CapacityPanel
        operations={[...SHEET, { operation: 'Bar Tack', smv: 0 }]}
        settings={settings}
        onSettingsChange={() => {}}
      />,
    );
    expect(html).toContain('No SMV on 1 operation');
    expect(html).toContain('Bar Tack');
  });

  it('offers to save the targets for the style', () => {
    const html = render(<CapacityPanel operations={SHEET} settings={settings} onSettingsChange={() => {}} onSave={() => {}} />);
    expect(html).toContain('Save targets for this style');
  });

  it('reports when the targets were last saved', () => {
    const html = render(
      <CapacityPanel operations={SHEET} settings={settings} onSettingsChange={() => {}} savedAt="2026-08-19" />,
    );
    expect(html).toContain('Saved for this style on 2026-08-19');
  });

  it('says so when nothing has been saved yet', () => {
    const html = render(<CapacityPanel operations={SHEET} settings={settings} onSettingsChange={() => {}} />);
    expect(html).toContain('Not saved yet');
  });

  it('explains why the per-process rows do not sum to the line total', () => {
    // Without this the panel looks like it is adding up wrongly.
    const html = render(<CapacityPanel operations={SHEET} settings={settings} onSettingsChange={() => {}} />);
    expect(html).toContain('do not add up to the line total');
  });

  it('disables saving for a read-only user', () => {
    const html = render(
      <CapacityPanel operations={SHEET} settings={settings} onSettingsChange={() => {}} canSave={false} />,
    );
    expect(html).not.toContain('Save targets for this style');
  });
});

describe('the achievement panel', () => {
  it('shows a surplus as extra', () => {
    const html = render(<AchievementPanel target={280} achieved={300} smv={1.2} perHourTarget={35} />);
    expect(html).toContain('+20 Extra');
    expect(html).toContain('280');
    expect(html).toContain('300');
    expect(html).toContain('107.1% of target');
  });

  it('shows a shortfall as due', () => {
    const html = render(<AchievementPanel target={280} achieved={268} />);
    expect(html).toContain('12 Due');
    expect(html).toContain('95.7% of target');
  });

  it('shows an exact hit as on target', () => {
    const html = render(<AchievementPanel target={280} achieved={280} />);
    expect(html).toContain('On target');
    expect(html).toContain('100% of target');
  });

  it('shows the SMV the target came from', () => {
    const html = render(<AchievementPanel target={280} achieved={100} smv={1.2} perHourTarget={35} />);
    expect(html).toContain('SMV 1.2');
    expect(html).toContain('35/hr');
  });

  it('tones a surplus good and a shortfall bad', () => {
    expect(render(<AchievementPanel target={280} achieved={300} />)).toContain('ach-good');
    expect(render(<AchievementPanel target={280} achieved={100} />)).toContain('ach-bad');
  });

  it('renders nothing when there is neither a target nor an output', () => {
    // The panel would otherwise appear, empty, on a fresh form.
    expect(render(<AchievementPanel target={0} achieved={0} />)).toBe('');
  });

  it('says so when there is no target to measure against', () => {
    const html = render(<AchievementPanel target={0} achieved={50} />);
    expect(html).toContain('No target set');
  });

  it('treats a blank actual as zero of the target', () => {
    const html = render(<AchievementPanel target={280} achieved="" />);
    expect(html).toContain('280 Due');
  });
});
