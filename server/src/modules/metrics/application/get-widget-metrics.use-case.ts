import { Injectable } from '@nestjs/common';
import { ConnectionsService } from '../../connections/application/connections.service.js';
import { CatalogService } from '../../catalog/application/catalog.service.js';
import { ViewTrackerService } from '../../engagement/application/view-tracker.service.js';
import { OrderSyncService } from '../../sales/application/order-sync.service.js';
import { SettingsService } from '../../settings/application/settings.service.js';
import { productId } from '../../../common/values.js';

export interface WidgetMetricsResult {
  productId: string;
  recentViewers: number;
  viewsToday: number;
  ordersLast24h: number;
  display: {
    showRecent: boolean;
    showDaily: boolean;
    showOrders: boolean;
  };
}

@Injectable()
export class GetWidgetMetricsUseCase {
  constructor(
    private readonly connectionsService: ConnectionsService,
    private readonly catalogService: CatalogService,
    private readonly viewTrackerService: ViewTrackerService,
    private readonly orderSyncService: OrderSyncService,
    private readonly settingsService: SettingsService,
  ) {}

  async execute(
    shopDomain: string,
    externalProductId: string,
  ): Promise<WidgetMetricsResult> {
    externalProductId = productId(externalProductId);
    const connection =
      await this.connectionsService.resolveConnection(shopDomain);
    const tenantId = connection.tenantId;

    // Resolve internal product
    const resolvedProductId = await this.catalogService.findProductId(
      connection.id,
      externalProductId,
      'PRODUCT',
    );

    // Concurrently fetch Engagement metrics, Sales metrics, and Settings
    const [engagement, ordersLast24h, settings] = await Promise.all([
      resolvedProductId
        ? this.viewTrackerService.getEngagementMetrics(
            tenantId,
            resolvedProductId,
            connection.timezoneIana,
          )
        : { recentViewers: 0, viewsToday: 0 },
      resolvedProductId
        ? this.orderSyncService.getSalesMetrics(tenantId, resolvedProductId)
        : 0,
      this.settingsService.getSettings(tenantId),
    ]);

    const showRecent =
      settings.recentEnabled &&
      engagement.recentViewers >= settings.recentThreshold;
    const showDaily =
      settings.dailyEnabled && engagement.viewsToday >= settings.dailyThreshold;
    const showOrders =
      settings.orderEnabled && ordersLast24h >= settings.orderThreshold;

    return {
      productId: externalProductId,
      recentViewers: engagement.recentViewers,
      viewsToday: engagement.viewsToday,
      ordersLast24h,
      display: {
        showRecent,
        showDaily,
        showOrders,
      },
    };
  }
}
