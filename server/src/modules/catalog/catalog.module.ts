import { Module } from '@nestjs/common';
import { CATALOG_REPOSITORY } from './domain/catalog.repository.port.js';
import { DrizzleCatalogRepository } from './infrastructure/drizzle-catalog.repository.js';
import { CatalogService } from './application/catalog.service.js';

@Module({
  providers: [
    {
      provide: CATALOG_REPOSITORY,
      useClass: DrizzleCatalogRepository,
    },
    CatalogService,
  ],
  exports: [CatalogService],
})
export class CatalogModule {}
