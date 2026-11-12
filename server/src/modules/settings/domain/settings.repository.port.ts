import { MerchantSettingsEntity } from './merchant-settings.entity.js';

export interface ISettingsRepository {
  findByTenantId(tenantId: string): Promise<MerchantSettingsEntity | null>;
  saveSettings(
    settings: Partial<MerchantSettingsEntity> & { tenantId: string },
  ): Promise<MerchantSettingsEntity>;
}

export const SETTINGS_REPOSITORY = Symbol('SETTINGS_REPOSITORY');
