import { Injectable } from '@nestjs/common';
import type { IOrderRepository } from '../domain/sales.ports.js';
import type {
  OrderSnapshotEntity,
  OrderLineEntity,
} from '../domain/order.entity.js';
import { DbService } from '../../../db/db.service.js';
import {
  orderSnapshots,
  orderLines,
  orderContributions,
} from '../../../db/schema.js';
import { sql, eq, and, gte, lte } from 'drizzle-orm';
import { internalId } from '../../../common/values.js';

@Injectable()
export class DrizzleOrderRepository implements IOrderRepository {
  constructor(private readonly dbService: DbService) {}

  async saveCreatedOrder(
    snapshot: OrderSnapshotEntity,
    lines: OrderLineEntity[],
    includeTestOrder = false,
  ): Promise<void> {
    await this.dbService.db.transaction(async (tx) => {
      // Lock by the unique external identity, preserving legacy internal IDs.
      await tx
        .insert(orderSnapshots)
        .values({ ...snapshot, syncGeneration: 0 })
        .onDuplicateKeyUpdate({ set: { id: sql`id` } });
      const [current] = await tx
        .select()
        .from(orderSnapshots)
        .where(
          and(
            eq(orderSnapshots.connectionId, snapshot.connectionId),
            eq(orderSnapshots.externalOrderId, snapshot.externalOrderId),
            eq(orderSnapshots.tenantId, snapshot.tenantId),
          ),
        )
        .for('update');
      if (!current) throw new Error('Order snapshot not found after insert');
      // First successful create wins. Retries (even with a changed payload)
      // cannot replace quantities or add the same order a second time.
      if (current.syncGeneration > 0) return;
      const orderId = current.id;
      await tx
        .update(orderSnapshots)
        .set({
          cancelled: false,
          testOrder: snapshot.testOrder,
          sourceUpdatedAt: snapshot.sourceUpdatedAt,
          syncGeneration: 1,
        })
        .where(eq(orderSnapshots.id, orderId));
      if (lines.length)
        await tx.insert(orderLines).values(
          lines.map((line) => ({
            ...line,
            orderId,
            id: internalId('line', orderId, line.lineItemId),
          })),
        );
      const totals = new Map<string, number>();
      if (!snapshot.testOrder || includeTestOrder) {
        for (const line of lines)
          totals.set(
            line.productId,
            (totals.get(line.productId) || 0) + line.currentQuantity,
          );
      }
      if (totals.size)
        await tx.insert(orderContributions).values(
          [...totals].map(([productId, quantity]) => ({
            tenantId: snapshot.tenantId,
            orderId,
            productId,
            quantity,
            orderCreatedAt: current.orderCreatedAt,
          })),
        );
    });
  }

  async getSoldQuantityLast24h(
    tenantId: string,
    productId: string,
    windowStart: Date,
    includeTestOrders = false,
  ): Promise<number> {
    const [result] = await this.dbService.db
      .select({
        totalSold: sql<number>`COALESCE(SUM(${orderContributions.quantity}), 0)`,
      })
      .from(orderContributions)
      .innerJoin(
        orderSnapshots,
        and(
          eq(orderSnapshots.id, orderContributions.orderId),
          eq(orderSnapshots.tenantId, orderContributions.tenantId),
        ),
      )
      .where(
        and(
          eq(orderContributions.tenantId, tenantId),
          eq(orderContributions.productId, productId),
          gte(orderContributions.orderCreatedAt, windowStart),
          lte(orderContributions.orderCreatedAt, new Date()),
          includeTestOrders ? undefined : eq(orderSnapshots.testOrder, false),
        ),
      );
    return Number(result?.totalSold || 0);
  }
}
