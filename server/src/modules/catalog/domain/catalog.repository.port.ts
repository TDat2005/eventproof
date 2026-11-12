import { ExternalKind, ProductEntity } from './product.entity.js';

export interface ICatalogRepository {
  findProductIdByExternal(connectionId: string, externalKind: ExternalKind, externalId: string): Promise<string | null>;
  ensureProductAndMapping(
    tenantId: string,
    connectionId: string,
    externalKind: ExternalKind,
    externalId: string,
    title?: string,
  ): Promise<ProductEntity>;
}

export const CATALOG_REPOSITORY = Symbol('CATALOG_REPOSITORY');
