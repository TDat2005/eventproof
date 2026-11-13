import { Injectable, ForbiddenException } from '@nestjs/common';
import { IConnectionsRepository } from '../domain/connections.repository.port.js';
import { StoreConnectionEntity } from '../domain/connection.entity.js';
import { DbService } from '../../../db/db.service.js';
import { tenants, storeConnections } from '../../../db/schema.js';
import { eq, and, gte, sql } from 'drizzle-orm';
import { internalId } from '../../../common/values.js';

@Injectable()
export class DrizzleConnectionsRepository implements IConnectionsRepository {
  constructor(private readonly dbService: DbService) {}

  async findByStoreDomain(
    domain: string,
  ): Promise<StoreConnectionEntity | null> {
    const db = this.dbService.db;
    const records = await db
      .select({
        id: storeConnections.id,
        tenantId: storeConnections.tenantId,
        platform: storeConnections.platform,
        externalStoreId: storeConnections.externalStoreId,
        accessToken: storeConnections.accessToken,
        timezoneIana: storeConnections.timezoneIana,
        active: storeConnections.active,
        createdAt: storeConnections.createdAt,
        installedAt: storeConnections.installedAt,
        uninstalledAt: storeConnections.uninstalledAt,
      })
      .from(storeConnections)
      .innerJoin(tenants, eq(tenants.id, storeConnections.tenantId))
      .where(
        and(
          eq(tenants.storeDomain, domain),
          eq(storeConnections.platform, 'shopify'),
        ),
      )
      .limit(1);

    if (records.length === 0) return null;
    return records[0];
  }

  async ensureConnection(
    storeDomain: string,
    timezone: string = 'UTC',
  ): Promise<StoreConnectionEntity> {
    return this.dbService.transaction(async () => {
      const db = this.dbService.db;
      const proposedTenantId = internalId('tenant', storeDomain);
      const connectionId = internalId('conn', storeDomain);

      // 1. Ensure Tenant
      await db
        .insert(tenants)
        .values({
          id: proposedTenantId,
          storeDomain,
        })
        .onDuplicateKeyUpdate({
          set: { storeDomain },
        });

      const [tenant] = await db
        .select()
        .from(tenants)
        .where(eq(tenants.storeDomain, storeDomain))
        .for('update');
      if (!tenant) throw new Error('Tenant missing after install');
      const tenantId = tenant.id;

      // 2. Ensure Store Connection
      await db
        .insert(storeConnections)
        .values({
          id: connectionId,
          tenantId,
          platform: 'shopify',
          externalStoreId: storeDomain,
          timezoneIana: timezone,
          active: true,
        })
        .onDuplicateKeyUpdate({
          set: {
            timezoneIana: timezone,
            installedAt: sql`IF(active = FALSE, UTC_TIMESTAMP(3), installed_at)`,
            uninstalledAt: null,
            redactRequestedAt: null,
            active: true,
          },
        });

      return (await this.findByStoreDomain(storeDomain))!;
    });
  }

  async withActiveConnection<T>(
    domain: string,
    work: (connection: StoreConnectionEntity) => Promise<T>,
  ): Promise<T> {
    return this.dbService.transaction(async () => {
      const [connection] = await this.dbService.db
        .select()
        .from(storeConnections)
        .where(
          and(
            eq(storeConnections.platform, 'shopify'),
            eq(storeConnections.externalStoreId, domain),
          ),
        )
        .for('update');
      if (!connection?.active)
        throw new ForbiddenException('Shop connection is not active');
      return work(connection);
    });
  }

  async updateTimezone(domain: string, timezone: string): Promise<void> {
    await this.dbService.db
      .update(storeConnections)
      .set({ timezoneIana: timezone })
      .where(
        and(
          eq(storeConnections.platform, 'shopify'),
          eq(storeConnections.externalStoreId, domain),
          eq(storeConnections.active, true),
        ),
      );
  }

  async deactivateConnection(
    storeDomain: string,
    triggeredAt: Date,
  ): Promise<void> {
    await this.dbService.db
      .update(storeConnections)
      .set({
        active: false,
        accessToken: null,
        uninstalledAt: triggeredAt,
      })
      .where(
        and(
          eq(storeConnections.platform, 'shopify'),
          eq(storeConnections.externalStoreId, storeDomain),
          eq(storeConnections.active, true),
          gte(sql`${triggeredAt}`, storeConnections.installedAt),
        ),
      );
  }
}
