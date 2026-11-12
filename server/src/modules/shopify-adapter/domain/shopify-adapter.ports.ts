export interface IShopifyWebhookVerifier {
  verifyHmac(rawBody: string | Buffer, headerHmac: string, secret: string): boolean;
}

export const SHOPIFY_WEBHOOK_VERIFIER = Symbol('SHOPIFY_WEBHOOK_VERIFIER');
