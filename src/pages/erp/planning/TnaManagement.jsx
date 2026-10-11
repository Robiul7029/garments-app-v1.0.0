import { MODULE } from '../../../config/erpRoles';
import { C, TNA_STATUS } from '../../../config/erpSchema';
import ErpModulePlaceholder from '../shared/ErpModulePlaceholder';

/**
 * ROBIUL GARMENTS ERP — TNA (Time & Action) Management.
 *
 * The calendar that turns an order's delivery date into dated milestones: fabric
 * booking, in-house, cutting, sewing start, finishing, inspection, shipment
 * handover — each with a planned date, a responsible person and a critical-path
 * flag.
 *
 * The schema is already designed for this (`tnaTasks`: stage, plannedDate,
 * actualDate, isCritical, status, delayDays), and the Planning role already has
 * full create/edit/approve rights on it. What is missing is the board.
 */
const STAGES = ['Planned', 'In Progress', 'Completed', 'Delayed'];

export default function TnaManagement() {
  return (
    <ErpModulePlaceholder
      icon="🗓️"
      title="TNA Management"
      moduleLabel={MODULE.PLANNING}
      collection={C.TNA_TASKS}
      description="Time & Action calendar — every milestone between order confirmation and shipment, with its planned date, owner and critical-path flag."
      note={`The task record already exists in the schema (stage, planned date, actual date, critical path, delay days, status: ${Object.values(TNA_STATUS).join(' / ')}). This screen is the board that drives it.`}
      features={[
        { label: 'TNA calendar per order', hint: 'Milestones laid against the delivery date' },
        { label: 'Create / edit a milestone', hint: 'Stage, responsible, planned date, critical flag' },
        { label: 'Mark actual date complete', hint: `Moves status through ${STAGES.join(' → ')}` },
        { label: 'Delay calculation', hint: 'delayDays derived from planned vs actual' },
        { label: 'Critical-path view', hint: 'Only the milestones that can stop the shipment' },
        { label: 'Overdue digest', hint: 'What is late today, for the morning meeting' },
      ]}
    />
  );
}
