export interface MerchantSettingsEntity {
  tenantId: string;
  recentEnabled: boolean;
  recentThreshold: number;
  dailyEnabled: boolean;
  dailyThreshold: number;
  orderEnabled: boolean;
  orderThreshold: number;
  version: number;
  updatedAt: Date;
}
