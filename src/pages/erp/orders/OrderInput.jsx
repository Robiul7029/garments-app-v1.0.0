import { MODULE } from '../../../config/erpRoles';
import OrderInputPage from '../../OrderInputPage';

/**
 * ROBIUL GARMENTS ERP — Order Input (a tab of Order Management).
 *
 * This is the WORKING order-entry form, lifted out of the legacy sidebar menu
 * and into the Order Management tab set.
 *
 * Before the tabs existed, the ERP's "Order Input" was an ErpModulePlaceholder
 * promising a form to come, while the real form lived under a separate legacy
 * sidebar item of the same name — two entries called "Order Input", only one of
 * which did anything. The tab now points at the real screen, so the app has
 * exactly one order-entry form and no dead screen promising a second one.
 *
 * `OrderInputPage` owns its own data and permissions (it reads `order-model` and
 * gates the form on the admin role) and renders a heading from its `item` prop,
 * so both are supplied here. The page header above this already names the
 * module and the active tab, which is why no extra ERP header is added.
 */
export default function OrderInput() {
  return (
    <div className="erp-tab-embed">
      <OrderInputPage
        category={{ key: MODULE.ORDERS, label: 'Order Management', icon: '📑' }}
        item={{ key: 'order-input', label: 'Order Input', icon: '📝' }}
      />
    </div>
  );
}
