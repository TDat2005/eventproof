import { Module } from '@nestjs/common';
import { SHOPIFY_WEBHOOK_VERIFIER } from './domain/shopify-adapter.ports.js';
import { ShopifyHmacVerifierAdapter } from './infrastructure/shopify-hmac-verifier.adapter.js';
import { ShopifyWebhookController } from './presentation/shopify-webhook.controller.js';
import { SalesModule } from '../sales/sales.module.js';
import { ConnectionsModule } from '../connections/connections.module.js';

@Module({
  imports: [SalesModule, ConnectionsModule],
  controllers: [ShopifyWebhookController],
  providers: [
    {
      provide: SHOPIFY_WEBHOOK_VERIFIER,
      useClass: ShopifyHmacVerifierAdapter,
    },
  ],
  exports: [SHOPIFY_WEBHOOK_VERIFIER],
})
export class ShopifyAdapterModule {}
