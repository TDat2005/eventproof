import { Injectable } from '@nestjs/common';
import { ICatalogRepository } from '../domain/catalog.repository.port.js';
import { ExternalKind, ProductEntity } from '../domain/product.entity.js';
import { DbService } from '../../../db/db.service.js';
import { products, externalProductMappings } from '../../../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { internalId } from '../../../common/values.js';

@Injectable()
export class DrizzleCatalogRepository implements ICatalogRepository {
  constructor(private readonly dbService: DbService) {}

  async findProductIdByExternal(
    connectionId: string,
    externalKind: ExternalKind,
    externalId: string,
  ): Promise<string | null> {
    const db = this.dbService.db;
    const records = await db
      .select({ productId: externalProductMappings.productId })
      .from(externalProductMappings)
      .where(
        and(
          eq(externalProductMappings.connectionId, connectionId),
          eq(externalProductMappings.externalKind, externalKind),
          eq(externalProductMappings.externalId, externalId),
        ),
      )
      .limit(1);

    if (records.length === 0) return null;
    return records[0].productId;
  }

  async ensureProductAndMapping(
    tenantId: string,
    connectionId: string,
    externalKind: ExternalKind,
    externalId: string,
    title?: string,
  ): Promise<ProductEntity> {
    const existingProductId = await this.findProductIdByExternal(
      connectionId,
      externalKind,
      externalId,
    );
    if (existingProductId) {
      return {
        id: existingProductId,
        tenantId,
        title: title || null,
        createdAt: new Date(),
      };
    }

    const db = this.dbService.db;
    const productId = internalId('prod', tenantId, externalKind, externalId);
    const mappingId = internalId('map', connectionId, externalKind, externalId);

    // 1. Ensure product
    await db
      .insert(products)
      .values({
        id: productId,
        tenantId,
        title: title || `Product ${externalId}`,
      })
      .onDuplicateKeyUpdate({
        set: { title: title || `Product ${externalId}` },
      });

    // 2. Ensure mapping
    await db
      .insert(externalProductMappings)
      .values({
        id: mappingId,
        connectionId,
        productId,
        externalKind,
        externalId,
      })
      .onDuplicateKeyUpdate({
        set: { productId },
      });

    return {
      id: productId,
      tenantId,
      title: title || null,
      createdAt: new Date(),
    };
  }
}
