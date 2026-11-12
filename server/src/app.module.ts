import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from './db/db.module.js';
import { RedisModule } from './redis/redis.module.js';
import { ConnectionsModule } from './modules/connections/connections.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { SettingsModule } from './modules/settings/settings.module.js';
import { EngagementModule } from './modules/engagement/engagement.module.js';
import { SalesModule } from './modules/sales/sales.module.js';
import { ShopifyAdapterModule } from './modules/shopify-adapter/shopify-adapter.module.js';
import { MetricsModule } from './modules/metrics/metrics.module.js';
import { SecurityModule } from './security/security.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
    }),
    DbModule,
    SecurityModule,
    RedisModule,
    ConnectionsModule,
    CatalogModule,
    SettingsModule,
    EngagementModule,
    SalesModule,
    ShopifyAdapterModule,
    MetricsModule,
  ],
})
export class AppModule {}
