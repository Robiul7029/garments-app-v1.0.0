import { MODULE } from '../../../config/erpRoles';
import ProcessUploadPage from '../../ProcessUploadPage';

/**
 * ROBIUL GARMENTS ERP — Process Sheet Upload (a tab of Order Management).
 *
 * The real process-sheet screen: pick the style or order, upload the breakdown
 * workbook, review the parsed operations, and get the SMV roll-up the line
 * balance and every efficiency figure are measured against.
 *
 * Named for what the tab does — you UPLOAD the sheet here. The screen behind it
 * is `ProcessUploadPage`, the working form the legacy menu already used; as with
 * Order Input, this tab replaces a placeholder that promised a screen the app
 * already had.
 *
 * The page reads `order-model` for its style list and writes parsed operations
 * to `process-breakdown`, which is exactly what the Daily Production process
 * dropdown then reads back for that style.
 */
export default function ProcessBreakdown() {
  return (
    <div className="erp-tab-embed">
      <ProcessUploadPage
        category={{ key: MODULE.ORDERS, label: 'Order Management', icon: '📑' }}
        item={{ key: 'process-breakdown', label: 'Process Sheet Upload', icon: '📤' }}
      />
    </div>
  );
}
