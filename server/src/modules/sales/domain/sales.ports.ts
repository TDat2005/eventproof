import { OrderSnapshotEntity, OrderLineEntity } from './order.entity.js';

export interface IOrderRepository {
  saveOrderSnapshot(snapshot: OrderSnapshotEntity, lines: OrderLineEntity[]): Promise<void>;
  getSoldQuantityLast24h(tenantId: string, productId: string, windowStart: Date): Promise<number>;
}

export const ORDER_REPOSITORY = Symbol('ORDER_REPOSITORY');
