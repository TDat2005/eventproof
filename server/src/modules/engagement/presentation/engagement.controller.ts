import { Controller, Post, Body, HttpCode, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ViewTrackerService } from '../application/view-tracker.service.js';
import { StorefrontRequestService } from '../../../security/storefront-request.service.js';
import { textValue, productId, eventDate } from '../../../common/values.js';

@Controller('api/proxy/events')
export class EngagementController {
  constructor(
    private readonly tracker: ViewTrackerService,
    private readonly storefront: StorefrontRequestService,
  ) {}

  @Post('view')
  @HttpCode(200)
  async recordView(
    @Req() req: Request,
    @Body() body: { productId: string; eventId: string; occurredAt: string },
  ) {
    const shop = await this.storefront.authenticate(req);
    return this.tracker.recordView({
      shop,
      externalProductId: productId(body?.productId),
      eventId: textValue(body?.eventId, 'eventId'),
      occurredAt: eventDate(body?.occurredAt).toISOString(),
    });
  }

  @Post('heartbeat')
  @HttpCode(200)
  async recordHeartbeat(
    @Req() req: Request,
    @Body() body: { productId: string; clientId: string },
  ) {
    const shop = await this.storefront.authenticate(req);
    return this.tracker.recordHeartbeat({
      shop,
      externalProductId: productId(body?.productId),
      clientId: textValue(body?.clientId, 'clientId'),
    });
  }
}
