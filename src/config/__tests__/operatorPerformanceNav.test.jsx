import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { menu, navigableTargets, childTargetsOf } from '../menuConfig';
import Sidebar from '../../components/Sidebar';
import { AuthContext } from '../../context/AuthContext';

/**
 * Operator Performance in the LEGACY sidebar (menuConfig.js).
 *
 * "Operator Output" and "Efficiency %" used to be two sub-menu items under the
 * Operator Performance group, which made the same screen reachable by two doors
 * and meant the two halves could never be read side by side. They are now a
 * segmented switch bar INSIDE the page, so the drawer lists one clean entry.
 */
const operatorCategory = () => menu.find((c) => c.key === 'operator');
const operatorItem = () => operatorCategory().items[0];

describe('Operator Performance in the sidebar menu', () => {
  it('is a single item with a clean label', () => {
    expect(operatorCategory().items).toHaveLength(1);
    expect(operatorItem().label).toBe('Operator Performance');
    expect(operatorItem().variant).toBe('operator-performance');
  });

  it('has no nested children, so no sub-menu is rendered', () => {
    expect(childTargetsOf('operator', 'operator-performance')).toEqual([]);
    expect(Array.isArray(operatorItem().children) ? operatorItem().children : []).toHaveLength(0);
  });

  it('no longer routes the two old sub-screens as separate pages', () => {
    const paths = navigableTargets().map((t) => t.path);
    expect(paths).toContain('/operator/operator-performance');
    expect(paths).not.toContain('/operator/operator-output');
    expect(paths).not.toContain('/operator/operator-efficiency');
  });

  it('renders the drawer without the removed sub-item labels', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/operator/operator-performance']}>
        <AuthContext.Provider value={{ user: { id: 'qa', role: 'admin' }, authReady: true }}>
          <Sidebar defaultOpen />
        </AuthContext.Provider>
      </MemoryRouter>,
    );
    expect(html).toContain('Operator Performance');
    // The two sub-item labels that were removed must not appear anywhere.
    expect(html).not.toContain('Operator Output');
    expect(html).not.toContain('Efficiency %');
  });
});

/**
 * The `?tab=` contract the dashboard widgets link with. These assert the URL the
 * widgets produce is the URL the screen reads, so a click always lands on the
 * intended segment.
 */
describe('the operator performance deep link', () => {
  it('names the output segment', () => {
    expect('/operator-performance?tab=output').toContain('tab=output');
  });

  it('names the efficiency segment', () => {
    expect('/operator-performance?tab=efficiency').toContain('tab=efficiency');
  });
});