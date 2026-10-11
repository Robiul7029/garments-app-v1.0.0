import { MODULE } from '../../../config/erpRoles';
import { C } from '../../../config/erpSchema';
import ErpModulePlaceholder from '../shared/ErpModulePlaceholder';

/**
 * ROBIUL GARMENTS ERP — Order Input.
 *
 * The capture side of Order Management: raising a buyer order, its PO lines, and
 * uploading the process-breakdown sheet that tells the floor how the style is
 * built. It is the parent of Process Breakdown because a breakdown belongs to an
 * order — you cannot upload one before the order exists.
 *
 * The order BOOK already reads correctly (see OrderManagement); this screen is
 * where those orders will be entered.
 */
export default function OrderInput() {
  return (
    <ErpModulePlaceholder
      icon="📝"
      title="Order Input"
      moduleLabel={MODULE.ORDERS}
      collection={C.ORDERS}
      description="Raise a buyer order, add its PO lines, and attach the process breakdown the floor works from."
      note="Reading orders already works — open Order Management to see the live book. This screen adds the entry forms."
      features={[
        { label: 'New order form (buyer, order no, dates, quantities)', hint: 'Writes to the orders collection' },
        { label: 'PO line entry (style, colour, size, qty, rate)', hint: 'One row per size/colour' },
        { label: 'Process breakdown upload (.xlsx / .csv)', hint: 'Per-operation list with SMV and machine type' },
        { label: 'Breakdown review before it reaches the floor', hint: 'Reject a bad sheet rather than publish it' },
        { label: 'Duplicate order-no guard', hint: 'Enforced by a transaction on uniqueKeys' },
      ]}
    />
  );
}
