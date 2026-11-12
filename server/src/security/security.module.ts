import { Global, Module } from '@nestjs/common';
import { ShopifyAuthService } from './shopify-auth.service.js';
import { StorefrontRequestService } from './storefront-request.service.js';

@Global()
@Module({
  providers: [ShopifyAuthService, StorefrontRequestService],
  exports: [ShopifyAuthService, StorefrontRequestService],
})
export class SecurityModule {}
