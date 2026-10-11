import { MODULE } from '../../../config/erpRoles';
import { C } from '../../../config/erpSchema';
import ErpModulePlaceholder from '../shared/ErpModulePlaceholder';

/**
 * ROBIUL GARMENTS ERP — Operator Performance.
 *
 * The individual operator, where the line-level efficiency on the dashboard is
 * actually earned or lost: pieces produced, minutes allowed against minutes
 * worked, plus attendance and rework for the same person on the same day.
 *
 * Hourly production rows already carry both `employeeId` and `actual`, so the
 * raw material exists. What is missing is the operator-day roll-up and the
 * efficiency it produces.
 */
export default function OperatorPerformance() {
  return (
    <ErpModulePlaceholder
      icon="👷"
      title="Operator Performance"
      moduleLabel={MODULE.PRODUCTION}
      collection={C.HOURLY_PRODUCTION}
      description="Piece-by-piece output per operator — pieces produced against the minutes allowed, so the line's efficiency can be traced to the people who earned it."
      note="Hourly production rows already record the operator and the pieces, so this screen can be built entirely from existing data — no new collection is needed."
      features={[
        { label: 'Operator daily output', hint: 'Pieces by operator, hour by hour' },
        { label: 'Individual efficiency %', hint: 'Output minutes vs minutes worked' },
        { label: 'Skill matrix by operation', hint: 'Who is trained on what' },
        { label: 'Trend over time', hint: 'A drop shows before a line misses its target' },
        { label: 'Rework and reject attribution', hint: 'Quality tied back to the operator' },
        { label: 'Line ranking', hint: 'Compare operators across the floor' },
      ]}
    />
  );
}
