import { Injectable, Logger } from '@nestjs/common';
import { IViewRepository } from '../domain/engagement.ports.js';
import { ViewEventEntity } from '../domain/view-event.entity.js';
import { DbService } from '../../../db/db.service.js';
import { viewEvents, viewsDaily, viewsHourly } from '../../../db/schema.js';
import { sql, eq, and } from 'drizzle-orm';

@Injectable()
export class DrizzleViewRepository implements IViewRepository {
  private readonly logger = new Logger(DrizzleViewRepository.name);

  constructor(private readonly dbService: DbService) {}

  async recordView(
    view: ViewEventEntity,
    dateStr: string,
  ): Promise<{ isNew: boolean }> {
    const db = this.dbService.db;

    try {
      return await db.transaction(async (tx) => {
        // A real INSERT gives an unambiguous duplicate-key error. FOUND_ROWS on
        // mysql2 makes affectedRows unreliable for a no-op duplicate UPDATE.
        try {
          await tx.insert(viewEvents).values({
            tenantId: view.tenantId,
            productId: view.productId,
            eventKey: view.eventKey,
            occurredAt: view.occurredAt,
          });
        } catch (error) {
          const err = error as { code?: string; cause?: { code?: string } };
          if (err.code === 'ER_DUP_ENTRY' || err.cause?.code === 'ER_DUP_ENTRY')
            return { isNew: false };
          throw error;
        }
        // 2. Increment daily counter
        await tx
          .insert(viewsDaily)
          .values({
            tenantId: view.tenantId,
            productId: view.productId,
            date: dateStr,
            totalViews: 1,
          })
          .onDuplicateKeyUpdate({
            set: { totalViews: sql`total_views + 1` },
          });
        await tx
          .insert(viewsHourly)
          .values({
            tenantId: view.tenantId,
            productId: view.productId,
            hourUtc: view.occurredAt.toISOString().slice(0, 13),
            totalViews: 1,
          })
          .onDuplicateKeyUpdate({ set: { totalViews: sql`total_views + 1` } });
        return { isNew: true };
      });
    } catch (err) {
      this.logger.error(
        `Error recording view event for product ${view.productId}:`,
        err,
      );
      throw err;
    }
  }

  async getDailyViews(
    tenantId: string,
    productId: string,
    date: string,
  ): Promise<number> {
    const db = this.dbService.db;
    const records = await db
      .select({ totalViews: viewsDaily.totalViews })
      .from(viewsDaily)
      .where(
        and(
          eq(viewsDaily.tenantId, tenantId),
          eq(viewsDaily.productId, productId),
          eq(viewsDaily.date, date),
        ),
      )
      .limit(1);

    if (records.length === 0) return 0;
    return Number(records[0].totalViews);
  }
}
