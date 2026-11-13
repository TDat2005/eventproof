import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { and, eq, isNotNull, lte, or, gt, sql } from 'drizzle-orm';
import { DbService } from '../../../db/db.service.js';
import { RedisService } from '../../../redis/redis.service.js';
import {
  tenants,
  storeConnections,
  products,
  externalProductMappings,
  merchantSettings,
  viewEvents,
  viewsHourly,
  viewsDaily,
  orderSnapshots,
  orderLines,
  orderContributions,
} from '../../../db/schema.js';

export function retentionDays(
  value = process.env.UNINSTALL_RETENTION_DAYS,
): number {
  if (value === undefined) return 30;
  if (
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) > 36500
  )
    throw new Error(
      'UNINSTALL_RETENTION_DAYS must be an integer between 0 and 36500',
    );
  return Number(value);
}

@Injectable()
export class UninstallCleanupService {
  private readonly logger = new Logger(UninstallCleanupService.name);
  constructor(
    private readonly db: DbService,
    private readonly redis: RedisService,
  ) {}

  /** Durable priority flag: Redis/DB failures leave this eligible for daily retry. */
  async requestRedaction(domain: string, triggeredAt: Date): Promise<void> {
    await this.db.db
      .update(storeConnections)
      .set({ redactRequestedAt: sql`UTC_TIMESTAMP(3)` })
      .where(
        and(
          eq(storeConnections.platform, 'shopify'),
          eq(storeConnections.externalStoreId, domain),
          eq(storeConnections.active, false),
          lte(storeConnections.installedAt, triggeredAt),
        ),
      );
    const [connection] = await this.db.db
      .select()
      .from(storeConnections)
      .where(
        and(
          eq(storeConnections.platform, 'shopify'),
          eq(storeConnections.externalStoreId, domain),
        ),
      );
    if (connection) await this.cleanupTenant(connection.tenantId, new Date());
  }

  async run(now = new Date()): Promise<void> {
    const cutoff = new Date(now.getTime() - retentionDays() * 86400000);
    let after = '';
    // Keyset pagination visits each candidate once, even when a tenant fails.
    for (;;) {
      const candidates = await this.db.db
        .select()
        .from(storeConnections)
        .where(
          and(
            gt(storeConnections.id, after),
            eq(storeConnections.active, false),
            or(
              lte(storeConnections.uninstalledAt, cutoff),
              isNotNull(storeConnections.redactRequestedAt),
            ),
          ),
        )
        .orderBy(storeConnections.id)
        .limit(100);
      if (!candidates.length) return;
      for (const candidate of candidates) {
        after = candidate.id;
        try {
          await this.cleanupTenant(candidate.tenantId, now);
        } catch (error) {
          this.logger.error(
            `Uninstall cleanup failed for connection ${candidate.id}; will retry`,
            error,
          );
        }
      }
    }
  }

  async cleanupTenant(tenantId: string, now: Date): Promise<boolean> {
    const cutoff = now.getTime() - retentionDays() * 86400000;
    const deleted = await this.db.transaction(async () => {
      // Lock order matches installation: tenant, then connections. Locks live
      // through Redis deletion and commit, fencing reinstall and in-flight ingest.
      const [tenant] = await this.db.db
        .select()
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .for('update');
      if (!tenant) return false;
      const connections = await this.db.db
        .select()
        .from(storeConnections)
        .where(eq(storeConnections.tenantId, tenantId))
        .orderBy(storeConnections.id)
        .for('update');
      // Tenant-scoped tables cannot be deleted while ANY connection is live or
      // still in retention. Never trust the earlier candidate snapshot.
      if (
        !connections.length ||
        connections.some(
          (connection) =>
            connection.platform !== 'shopify' ||
            connection.active ||
            !connection.uninstalledAt ||
            (!connection.redactRequestedAt &&
              connection.uninstalledAt.getTime() > cutoff),
        )
      )
        return false;

      await this.redis.deleteTenantData(tenantId, tenant.storeDomain);
      for (const connection of connections) {
        await this.db.db
          .delete(externalProductMappings)
          .where(eq(externalProductMappings.connectionId, connection.id));
      }
      // All tenant-owned tables in schema.ts, children before parents.
      for (const table of [
        orderContributions,
        orderLines,
        orderSnapshots,
        viewEvents,
        viewsHourly,
        viewsDaily,
        merchantSettings,
        products,
      ]) {
        await this.db.db.delete(table).where(eq(table.tenantId, tenantId));
      }
      await this.db.db
        .delete(storeConnections)
        .where(eq(storeConnections.tenantId, tenantId));
      await this.db.db.delete(tenants).where(eq(tenants.id, tenantId));
      return true;
    });
    if (deleted)
      this.logger.log(`Uninstall cleanup completed for tenant ${tenantId}`);
    return deleted;
  }
}

/** No scheduler/queue exists in this app. One lightweight Nest lifecycle timer,
 * with database row locks for coordination across replicas. Run on boot to catch
 * downtime, then daily. Failed tenants remain durable candidates. */
@Injectable()
export class UninstallCleanupJob implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private running?: Promise<void>;
  private readonly logger = new Logger(UninstallCleanupJob.name);
  constructor(private readonly cleanup: UninstallCleanupService) {}
  onModuleInit() {
    retentionDays(); // Fail startup for invalid retention, never silently purge.
    this.schedule(1000);
  }
  private schedule(delay: number) {
    this.timer = setTimeout(() => {
      this.running = this.cleanup
        .run()
        .catch((error) =>
          this.logger.error('Cleanup job failed; will retry', error),
        )
        .finally(() => {
          if (!this.stopped) this.schedule(86400000);
        });
    }, delay);
    this.timer.unref();
  }
  async onModuleDestroy() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }
}
