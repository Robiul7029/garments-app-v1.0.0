import { MODULE } from '../../../config/erpRoles';
import { C } from '../../../config/erpSchema';
import ErpModulePlaceholder from '../shared/ErpModulePlaceholder';

/**
 * ROBIUL GARMENTS ERP — Process Breakdown.
 *
 * The per-operation plan for a style: every sewing operation, its SMV, machine
 * type and the minutes it is allowed. This is what a line balance is built from
 * and what the efficiency figure on the dashboard is measured against — without
 * a breakdown, an "efficiency %" is a number with no denominator.
 *
 * Nested under Order Input because a breakdown always belongs to one order.
 */
export default function ProcessBreakdown() {
  return (
    <ErpModulePlaceholder
      icon="🧩"
      title="Process Breakdown"
      moduleLabel={MODULE.ORDERS}
      collection={C.STYLES}
      description="The operation-by-operation plan for a style — SMV, machine type and allowed minutes, which the line balance and every efficiency figure depend on."
      note="SMV is already a field on the style master, so a style can carry a single figure today. This screen holds the FULL breakdown, per operation."
      features={[
        { label: 'Operation list per style', hint: 'Operation name, machine, SMV, allowance' },
        { label: 'Total SMV roll-up', hint: 'Feeds efficiency across the dashboard' },
        { label: 'Import from the Excel breakdown sheet', hint: 'Maps columns to operations' },
        { label: 'Machine-type summary', hint: 'What the line must be set up with' },
        { label: 'Line balance suggestion', hint: 'Operators required per operation' },
      ]}
    />
  );
}
