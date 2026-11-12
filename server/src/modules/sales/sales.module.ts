import { Module } from '@nestjs/common';
import { ORDER_REPOSITORY } from './domain/sales.ports.js';
import { DrizzleOrderRepository } from './infrastructure/drizzle-order.repository.js';
import { OrderSyncService } from './application/order-sync.service.js';
import { ConnectionsModule } from '../connections/connections.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';

@Module({
  imports: [ConnectionsModule, CatalogModule],
  providers: [
    {
      provide: ORDER_REPOSITORY,
      useClass: DrizzleOrderRepository,
    },
    OrderSyncService,
  ],
  exports: [OrderSyncService],
})
export class SalesModule {}
