import { Injectable, Inject } from '@nestjs/common';
import type { ISettingsRepository } from '../domain/settings.repository.port.js';
import { SETTINGS_REPOSITORY } from '../domain/settings.repository.port.js';
import type { MerchantSettingsEntity } from '../domain/merchant-settings.entity.js';

@Injectable()
export class SettingsService {
  constructor(
    @Inject(SETTINGS_REPOSITORY)
    private readonly settingsRepository: ISettingsRepository,
  ) {}

  async getSettings(tenantId: string): Promise<MerchantSettingsEntity> {
    const settings = await this.settingsRepository.findByTenantId(tenantId);
    if (settings) return settings;

    return {
      tenantId,
      recentEnabled: true,
      recentThreshold: 1,
      dailyEnabled: true,
      dailyThreshold: 1,
      orderEnabled: true,
      orderThreshold: 1,
      version: 1,
      updatedAt: new Date(),
    };
  }

  async updateSettings(
    dto: Partial<MerchantSettingsEntity> & { tenantId: string },
  ): Promise<MerchantSettingsEntity> {
    return this.settingsRepository.saveSettings(dto);
  }
}
