import { Injectable } from '@nestjs/common';
import { IShopifyWebhookVerifier } from '../domain/shopify-adapter.ports.js';
import crypto from 'node:crypto';

@Injectable()
export class ShopifyHmacVerifierAdapter implements IShopifyWebhookVerifier {
  verifyHmac(rawBody: string | Buffer, headerHmac: string, secret: string): boolean {
    if (!headerHmac || !secret) return false;

    const hash = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('base64');

    try {
      return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(headerHmac));
    } catch {
      return false;
    }
  }
}
