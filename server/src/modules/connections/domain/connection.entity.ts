export interface StoreConnectionEntity {
  id: string;
  tenantId: string;
  platform: string;
  externalStoreId: string;
  accessToken?: string | null;
  timezoneIana: string;
  active: boolean;
  createdAt: Date;
  installedAt?: Date;
  uninstalledAt?: Date | null;
}
