import { Module } from '@nestjs/common';
import { GetWidgetMetricsUseCase } from './application/get-widget-metrics.use-case.js';
import { MetricsController } from './presentation/metrics.controller.js';
import { ConnectionsModule } from '../connections/connections.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { EngagementModule } from '../engagement/engagement.module.js';
import { SalesModule } from '../sales/sales.module.js';
import { SettingsModule } from '../settings/settings.module.js';

@Module({
  imports: [
    ConnectionsModule,
    CatalogModule,
    EngagementModule,
    SalesModule,
    SettingsModule,
  ],
  controllers: [MetricsController],
  providers: [GetWidgetMetricsUseCase],
  exports: [GetWidgetMetricsUseCase],
})
export class MetricsModule {}
