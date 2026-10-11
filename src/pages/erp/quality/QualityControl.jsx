import { MODULE } from '../../../config/erpRoles';
import { C } from '../../../config/erpSchema';
import ErpModulePlaceholder from '../shared/ErpModulePlaceholder';

/**
 * ROBIUL GARMENTS ERP — Quality Control (check & defect tracking).
 *
 * Three inspection points the schema already models separately, because they
 * catch different things:
 *
 *   - inlineQc      — defects caught while the garment is still being sewn
 *   - endLineQc     — passed / failed at the end of the line
 *   - finalInspections — AQL sample against the finished, packed lot
 *
 * Defects are also typed through `defectCategories`, which is what makes a DHU
 * figure useful: "12 defects" is a number, "12 skipped stitch" is a fix.
 */
export default function QualityControl() {
  return (
    <ErpModulePlaceholder
      icon="🔍"
      title="Quality Control"
      moduleLabel={MODULE.QUALITY}
      collection={C.INLINE_QC}
      description="Inline, end-line and final inspection — with defects recorded against the defect catalogue so a drop in pass rate can be traced to a cause, not just counted."
      note="Three QC collections are already defined (inlineQc, endLineQc, finalInspections) plus a defect catalogue with severity and DHU weight. The QC role already holds full rights on this module."
      features={[
        { label: 'Inline QC entry', hint: 'Checked / defect / rework / reject per line and hour' },
        { label: 'End-line QC entry', hint: 'Passed vs failed at the end of the line' },
        { label: 'Final inspection (AQL)', hint: 'Sample size, AQL, pass or fail verdict' },
        { label: 'Defect-wise breakdown', hint: 'Ranked by defect type, not just by count' },
        { label: 'DHU and defect-rate trend', hint: 'Defects per hundred units over time' },
        { label: 'Defect catalogue maintenance', hint: 'Category, severity, DHU weight' },
      ]}
    />
  );
}
