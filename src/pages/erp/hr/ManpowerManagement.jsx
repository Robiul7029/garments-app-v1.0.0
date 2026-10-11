import { MODULE } from '../../../config/erpRoles';
import { C } from '../../../config/erpSchema';
import ErpModulePlaceholder from '../shared/ErpModulePlaceholder';

/**
 * ROBIUL GARMENTS ERP — Manpower Management.
 *
 * How many operators a line actually had against how many it is set up for, shift
 * by shift. This is the denominator of every efficiency figure, so a line that
 * looks inefficient is very often a line that was four people short.
 *
 * `lineShifts` already holds manpower, present count and SMV per line per shift,
 * and `employeesErp` holds the operator master with department, designation and
 * shift. The screen that compares the two is what is missing.
 */
export default function ManpowerManagement() {
  return (
    <ErpModulePlaceholder
      icon="🧑‍🏭"
      title="Manpower Management"
      moduleLabel={MODULE.HR}
      collection={C.LINE_SHIFTS}
      description="Line-by-line manpower against the plan, shift by shift — the denominator behind every efficiency figure on the dashboard."
      note="Shift manpower (planned and present) is already recorded per line, and the employee master already carries department, designation and shift. This screen joins them."
      features={[
        { label: 'Manpower deployment per line', hint: 'Planned vs present, by shift' },
        { label: 'Absenteeism by line and department', hint: 'Where the holes are today' },
        { label: 'Operator master maintenance', hint: 'Department, designation, shift, status' },
        { label: 'Skill-to-operation matching', hint: 'Who can be moved where at short notice' },
        { label: 'Overtime and leave impact', hint: 'Against the shift plan' },
        { label: 'Cost per line', hint: 'Manpower × rate against output' },
      ]}
    />
  );
}
