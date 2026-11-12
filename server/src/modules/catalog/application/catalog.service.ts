import { Injectable, Inject } from '@nestjs/common';
import type { ICatalogRepository } from '../domain/catalog.repository.port.js';
import { CATALOG_REPOSITORY } from '../domain/catalog.repository.port.js';
import type { ExternalKind, ProductEntity } from '../domain/product.entity.js';

@Injectable()
export class CatalogService {
  constructor(
    @Inject(CATALOG_REPOSITORY)
    private readonly catalogRepository: ICatalogRepository,
  ) {}

  async resolveProduct(
    tenantId: string,
    connectionId: string,
    externalId: string,
    externalKind: ExternalKind = 'PRODUCT',
    title?: string,
  ): Promise<ProductEntity> {
    return this.catalogRepository.ensureProductAndMapping(
      tenantId,
      connectionId,
      externalKind,
      externalId,
      title,
    );
  }

  async findProductId(
    connectionId: string,
    externalId: string,
    externalKind: ExternalKind = 'PRODUCT',
  ): Promise<string | null> {
    return this.catalogRepository.findProductIdByExternal(connectionId, externalKind, externalId);
  }
}
