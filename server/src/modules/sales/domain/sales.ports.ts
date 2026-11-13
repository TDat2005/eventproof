import { OrderSnapshotEntity, OrderLineEntity } from './order.entity.js';

export interface IOrderRepository {
  saveCreatedOrder(
    snapshot: OrderSnapshotEntity,
    lines: OrderLineEntity[],
    includeTestOrder?: boolean,
  ): Promise<void>;
  getSoldQuantityLast24h(
    tenantId: string,
    productId: string,
    windowStart: Date,
    includeTestOrders?: boolean,
  ): Promise<number>;
}

export const ORDER_REPOSITORY = Symbol('ORDER_REPOSITORY');
