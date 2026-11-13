import { Controller, Get, Header, Headers } from '@nestjs/common';
import { ShopifyAuthService } from '../../../security/shopify-auth.service.js';
import { ConnectionsService } from '../../connections/application/connections.service.js';
import { AnalyticsService } from '../application/analytics.service.js';

@Controller('api/admin/analytics')
export class AnalyticsController {
  constructor(
    private readonly auth: ShopifyAuthService,
    private readonly connections: ConnectionsService,
    private readonly analytics: AnalyticsService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async dashboard(@Headers('authorization') authorization: string) {
    const shop = this.auth.verifyAdmin(authorization);
    const connection = await this.connections.resolveConnection(shop);
    return this.analytics.dashboard(
      connection.tenantId,
      connection.timezoneIana,
    );
  }

  @Get('top-products')
  @Header('Cache-Control', 'no-store')
  async topProducts(@Headers('authorization') authorization: string) {
    const shop = this.auth.verifyAdmin(authorization);
    const connection = await this.connections.resolveConnection(shop);
    return this.analytics.topProducts(
      connection.tenantId,
      connection.timezoneIana,
    );
  }
}
