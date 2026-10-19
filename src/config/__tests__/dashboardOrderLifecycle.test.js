import { describe, expect, it } from 'vitest';
import { isActiveOrder, resolveOrderStatus } from '../../utils/orderStatus';
import { ORDER_STATUS } from '../erpSchema';

const TODAY = '2026-10-17';

describe('dashboard order lifecycle aggregation', () => {
  it('resolves automatic completion from fulfillment and removes it from active count', () => {
    const po = { id: 'po-1', status: 'Active', totalQty: 100, shippedQty: 0, producedQty: 100 };
    expect(resolveOrderStatus(po, TODAY).status).toBe(ORDER_STATUS.COMPLETED);
    expect(isActiveOrder(po, TODAY)).toBe(false);
  });

  it('resolves overdue active orders as inactive', () => {
    const po = { status: 'Active', totalQty: 100, producedQty: 40, shipmentDate: '2026-10-16' };
    expect(resolveOrderStatus(po, TODAY).status).toBe(ORDER_STATUS.INACTIVE);
    expect(isActiveOrder(po, TODAY)).toBe(false);
  });

  it('keeps future-due partially fulfilled orders active', () => {
    expect(isActiveOrder({ status: 'Active', totalQty: 100, producedQty: 40, shipmentDate: '2026-10-20' }, TODAY)).toBe(true);
  });
});
