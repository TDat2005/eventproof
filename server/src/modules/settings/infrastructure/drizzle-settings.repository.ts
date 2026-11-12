import { Injectable } from '@nestjs/common';
import { ISettingsRepository } from '../domain/settings.repository.port.js';
import { MerchantSettingsEntity } from '../domain/merchant-settings.entity.js';
import { DbService } from '../../../db/db.service.js';
import { merchantSettings } from '../../../db/schema.js';
import { eq, sql } from 'drizzle-orm';

@Injectable()
export class DrizzleSettingsRepository implements ISettingsRepository {
  constructor(private readonly dbService: DbService) {}

  async findByTenantId(
    tenantId: string,
  ): Promise<MerchantSettingsEntity | null> {
    const db = this.dbService.db;
    const records = await db
      .select()
      .from(merchantSettings)
      .where(eq(merchantSettings.tenantId, tenantId))
      .limit(1);

    if (records.length === 0) return null;
    return records[0];
  }

  async saveSettings(
    dto: Partial<MerchantSettingsEntity> & { tenantId: string },
  ): Promise<MerchantSettingsEntity> {
    const db = this.dbService.db;
    const tenantId = dto.tenantId;

    await db
      .insert(merchantSettings)
      .values({
        tenantId,
        recentEnabled: dto.recentEnabled ?? true,
        recentThreshold: dto.recentThreshold ?? 1,
        dailyEnabled: dto.dailyEnabled ?? true,
        dailyThreshold: dto.dailyThreshold ?? 1,
        orderEnabled: dto.orderEnabled ?? true,
        orderThreshold: dto.orderThreshold ?? 1,
        version: 1,
      })
      .onDuplicateKeyUpdate({
        set: {
          recentEnabled:
            dto.recentEnabled !== undefined
              ? dto.recentEnabled
              : sql`recent_enabled`,
          recentThreshold:
            dto.recentThreshold !== undefined
              ? dto.recentThreshold
              : sql`recent_threshold`,
          dailyEnabled:
            dto.dailyEnabled !== undefined
              ? dto.dailyEnabled
              : sql`daily_enabled`,
          dailyThreshold:
            dto.dailyThreshold !== undefined
              ? dto.dailyThreshold
              : sql`daily_threshold`,
          orderEnabled:
            dto.orderEnabled !== undefined
              ? dto.orderEnabled
              : sql`order_enabled`,
          orderThreshold:
            dto.orderThreshold !== undefined
              ? dto.orderThreshold
              : sql`order_threshold`,
          version: sql`version + 1`,
          updatedAt: new Date(),
        },
      });

    const updated = await this.findByTenantId(tenantId);
    return updated!;
  }
}
