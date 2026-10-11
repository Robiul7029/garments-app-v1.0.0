import React from 'react';
import { EmptyState, StatCard } from '../../../components/erp/Primitives';

/**
 * ROBIUL GARMENTS ERP — shared shell for a module whose screen is not built yet.
 *
 * The five new sidebar sections (Order Management, TNA, Operator Performance,
 * Quality Control, Manpower) are real, routed, permission-gated screens from the
 * moment they are registered. What they do not yet have is the WRITE side: the
 * forms that create a TNA task, log a defect or record manpower.
 *
 * This component is deliberately honest about that rather than showing invented
 * numbers. A factory app that displays a plausible-looking figure nobody entered
 * is worse than one that says "not built yet", because somebody makes a decision
 * against it. So each placeholder states exactly:
 *
 *   - what the module is for
 *   - what is already wired (the collection, the role access, the route)
 *   - which screens are still to come, as a visible checklist
 *
 * Every placeholder is replaced by a real screen by swapping the `component` in
 * erpMenu.js — nothing else has to change, because the route, the permission gate
 * and the sidebar entry are all generated from that one array.
 */
export default function ErpModulePlaceholder({
  icon,
  title,
  moduleLabel,
  description,
  // The Firestore collection this module will read and write, so the screen can
  // state where its data will live without anyone having to dig through config.
  collection,
  // The sub-screens this module is planned to grow. Shown as a checklist so the
  // scope is visible to whoever picks the work up.
  features = [],
  // Optional live position cards — only pass counts that come from real reads.
  stats = [],
  note,
  children,
}) {
  return (
    <div className="erp-page">
      <header className="erp-page-header">
        <div>
          <h1 className="erp-page-title">{icon} {title}</h1>
          <p className="erp-page-description">{description}</p>
        </div>
      </header>

      {note && (
        <div className="erp-notice erp-notice-info">
          <span aria-hidden="true">ℹ️</span>
          <span>{note}</span>
        </div>
      )}

      {stats.length > 0 && (
        <section className="erp-panel">
          <h2 className="erp-panel-title">Live position</h2>
          <div className="erp-stat-grid">
            {stats.map((s) => (
              <StatCard key={s.label} label={s.label} value={s.value} unit={s.unit} level={s.level} icon={s.icon} hint={s.hint} />
            ))}
          </div>
        </section>
      )}

      {/* Anything a module can genuinely show today goes here. When this is
          empty the module falls back to the "not built yet" panel below. */}
      {children}

      <div className="erp-split">
        <section className="erp-panel">
          <h2 className="erp-panel-title">Planned for this module</h2>
          {features.length === 0 ? (
            <EmptyState icon="🧭" title="No screens listed yet" message="The scope for this module has not been broken down." />
          ) : (
            <ul className="erp-feature-list">
              {features.map((f) => (
                <li key={f.label} className="erp-feature-item">
                  <span className={`erp-chip erp-feature-status${f.done ? ' erp-chip-success' : ''}`}>
                    {f.done ? '✅ Ready' : '🔒 Planned'}
                  </span>
                  <span className="erp-feature-label">{f.label}</span>
                  {f.hint && <span className="erp-subtle">{f.hint}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="erp-panel">
          <h2 className="erp-panel-title">Wiring already in place</h2>
          <dl className="erp-facts">
            <Fact term="Module key" value={moduleLabel} mono />
            <Fact term="Route" value={`/erp/${moduleLabel}`} mono />
            <Fact term="Collection" value={collection || 'Not assigned yet'} mono />
            <Fact term="Access" value="Granted by your ERP role — the same matrix the security rules mirror" />
            <Fact term="Navigation" value="Listed in the ERP section of the sidebar, next to the built modules" />
          </dl>
        </section>
      </div>
    </div>
  );
}

function Fact({ term, value, mono }) {
  return (
    <div className="erp-fact">
      <dt>{term}</dt>
      <dd className={mono ? 'erp-mono' : undefined}>{value}</dd>
    </div>
  );
}
