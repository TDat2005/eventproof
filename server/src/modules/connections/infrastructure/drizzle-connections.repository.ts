import { Injectable } from '@nestjs/common';
import { IConnectionsRepository } from '../domain/connections.repository.port.js';
import { StoreConnectionEntity } from '../domain/connection.entity.js';
import { DbService } from '../../../db/db.service.js';
import { tenants, storeConnections } from '../../../db/schema.js';
import { eq } from 'drizzle-orm';
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
      })
      .from(storeConnections)
      .innerJoin(tenants, eq(tenants.id, storeConnections.tenantId))
      .where(eq(tenants.storeDomain, domain))
      .limit(1);

    if (records.length === 0) return null;
    return records[0];
  }

  async ensureConnection(
    storeDomain: string,
    timezone: string = 'UTC',
  ): Promise<StoreConnectionEntity> {
    const existing = await this.findByStoreDomain(storeDomain);
    if (existing) {
      await this.dbService.db
        .update(storeConnections)
        .set({ timezoneIana: timezone, active: true })
        .where(eq(storeConnections.id, existing.id));
      return { ...existing, timezoneIana: timezone, active: true };
    }

    const db = this.dbService.db;
    const tenantId = internalId('tenant', storeDomain);
    const connectionId = internalId('conn', storeDomain);

    // 1. Ensure Tenant
    await db
      .insert(tenants)
      .values({
        id: tenantId,
        storeDomain,
      })
      .onDuplicateKeyUpdate({
        set: { storeDomain },
      });

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
        set: { timezoneIana: timezone, active: true },
      });

    return (await this.findByStoreDomain(storeDomain))!;
  }

  async deactivateConnection(storeDomain: string): Promise<void> {
    await this.dbService.db
      .update(storeConnections)
      .set({ active: false, accessToken: null })
      .where(eq(storeConnections.externalStoreId, storeDomain));
  }
}
