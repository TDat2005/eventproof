import {
  BadRequestException,
  Controller,
  Post,
  Headers,
  HttpCode,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { OrderSyncService } from '../../sales/application/order-sync.service.js';
import { ConnectionsService } from '../../connections/application/connections.service.js';
import { ShopifyAuthService } from '../../../security/shopify-auth.service.js';
import { productId, shopDomain, textValue } from '../../../common/values.js';

@Controller('api/webhooks')
export class ShopifyWebhookController {
  constructor(
    private readonly orders: OrderSyncService,
    private readonly connections: ConnectionsService,
    private readonly auth: ShopifyAuthService,
  ) {}

  private authenticate(req: RawBodyRequest<Request>, shop: string): string {
    this.auth.verifyWebhook(req.rawBody, req.get('x-shopify-hmac-sha256'));
    return shopDomain(shop);
  }

  @Post('orders')
  @HttpCode(200)
  async handleOrderWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-shopify-shop-domain') domain: string,
    @Headers('x-shopify-topic') topic: string,
  ) {
    const shop = this.authenticate(req, domain);
    // Acknowledge old subscriptions still in flight without changing counts.
    if (topic !== 'orders/create') return { received: true, ignored: true };
    const connection = await this.connections.getConnection(shop);
    // Events arriving after uninstall or before first Admin activation are not
    // permission to create a tenant. Shopify can still retry older deliveries.
    if (!connection?.active) return { received: true, ignored: true };
    const payload = req.body;
    const externalOrderId = textValue(String(payload?.id || ''), 'orderId');
    const orderCreatedAt = new Date(payload?.created_at);
    if (
      !Number.isFinite(orderCreatedAt.getTime()) ||
      !Array.isArray(payload?.line_items)
    ) {
      throw new BadRequestException('Invalid order snapshot');
    }
    const lineItems = payload.line_items
      .filter((item: any) => item.product_id != null)
      .map((item: any) => {
        const quantity = Number(item.quantity);
        if (!Number.isSafeInteger(quantity) || quantity < 0)
          throw new BadRequestException('Invalid order quantity');
        return {
          lineItemId: textValue(String(item.id || ''), 'lineItemId'),
          externalProductId: productId(String(item.product_id)),
          quantity,
        };
      });
    if (
      new Set(lineItems.map((line: { lineItemId: string }) => line.lineItemId))
        .size !== lineItems.length
    )
      throw new BadRequestException('Duplicate line item');
    await this.orders.recordCreatedOrder({
      shop,
      externalOrderId,
      testOrder: payload.test === true,
      orderCreatedAt,
      lineItems,
    });
    return { received: true };
  }

  @Post('app-uninstalled')
  @HttpCode(200)
  async uninstall(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-shopify-shop-domain') domain: string,
  ) {
    const shop = this.authenticate(req, domain);
    if (req.get('x-shopify-topic') !== 'app/uninstalled')
      throw new BadRequestException('Unsupported topic');
    await this.connections.deactivateConnection(shop);
    return { received: true };
  }

  @Post('shop-update')
  @HttpCode(200)
  async updateShop(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-shopify-shop-domain') domain: string,
  ) {
    const shop = this.authenticate(req, domain);
    if (req.get('x-shopify-topic') !== 'shop/update')
      throw new BadRequestException('Unsupported topic');
    if ((await this.connections.getConnection(shop))?.active) {
      await this.connections.activateConnection(shop, req.body?.iana_timezone);
    }
    return { received: true };
  }
}
