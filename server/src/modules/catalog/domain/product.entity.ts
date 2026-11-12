export type ExternalKind = 'PRODUCT' | 'VARIANT';

export interface ProductEntity {
  id: string;
  tenantId: string;
  title?: string | null;
  createdAt: Date;
}

export interface ExternalProductMappingEntity {
  id: string;
  connectionId: string;
  productId: string;
  externalKind: ExternalKind;
  externalId: string;
  createdAt: Date;
}
