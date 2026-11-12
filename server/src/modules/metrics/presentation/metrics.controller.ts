import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { GetWidgetMetricsUseCase } from '../application/get-widget-metrics.use-case.js';
import { StorefrontRequestService } from '../../../security/storefront-request.service.js';

@Controller('api/proxy/metrics')
export class MetricsController {
  constructor(
    private readonly metrics: GetWidgetMetricsUseCase,
    private readonly storefront: StorefrontRequestService,
  ) {}

  @Get(':productId')
  async getMetrics(
    @Req() req: Request,
    @Param('productId') productId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const shop = await this.storefront.authenticate(req);
    res.setHeader('Cache-Control', 'no-store');
    return this.metrics.execute(shop, productId);
  }
}
