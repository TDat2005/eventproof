import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { shopDomain } from '../common/values.js';

@Injectable()
export class ShopifyAuthService {
  private secret(): string {
    const secret = process.env.SHOPIFY_API_SECRET;
    if (!secret)
      throw new ServiceUnavailableException(
        'SHOPIFY_API_SECRET is not configured',
      );
    return secret;
  }

  private matches(actual: Buffer, expected: Buffer): boolean {
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  }

  verifyWebhook(body: Buffer | undefined, signature: unknown): void {
    if (!body || typeof signature !== 'string')
      throw new UnauthorizedException('Missing webhook signature');
    const expected = createHmac('sha256', this.secret()).update(body).digest();
    if (!this.matches(Buffer.from(signature, 'base64'), expected))
      throw new UnauthorizedException('Invalid webhook signature');
  }

  verifyProxy(query: Record<string, unknown>): string {
    const { signature, ...params } = query;
    if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature))
      throw new UnauthorizedException('Missing proxy signature');
    const message = Object.keys(params)
      .sort()
      .map((key) => {
        const value = params[key];
        if (typeof value === 'string') return `${key}=${value}`;
        if (Array.isArray(value) && value.every((v) => typeof v === 'string'))
          return `${key}=${value.join(',')}`;
        throw new UnauthorizedException('Invalid proxy query');
      })
      .join('');
    const expected = createHmac('sha256', this.secret())
      .update(message)
      .digest();
    if (!this.matches(Buffer.from(signature, 'hex'), expected))
      throw new UnauthorizedException('Invalid proxy signature');
    const timestamp = Number(params.timestamp);
    if (
      !Number.isFinite(timestamp) ||
      Math.abs(Date.now() / 1000 - timestamp) > 300
    )
      throw new UnauthorizedException('Expired proxy request');
    return shopDomain(params.shop);
  }

  verifyAdmin(authorization: string | undefined): string {
    const clientId = process.env.SHOPIFY_API_KEY;
    if (!clientId)
      throw new ServiceUnavailableException(
        'SHOPIFY_API_KEY is not configured',
      );
    const token = authorization?.match(/^Bearer ([\w.-]+)$/)?.[1];
    if (!token) throw new UnauthorizedException('Missing Shopify ID token');
    try {
      const parts = token.split('.');
      if (parts.length !== 3) throw new Error();
      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
      if (header.alg !== 'HS256') throw new Error();
      const expected = createHmac('sha256', this.secret())
        .update(`${parts[0]}.${parts[1]}`)
        .digest();
      if (!this.matches(Buffer.from(parts[2], 'base64url'), expected))
        throw new Error();
      const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      const now = Date.now() / 1000;
      if (
        typeof claims.exp !== 'number' ||
        claims.exp <= now ||
        typeof claims.nbf !== 'number' ||
        claims.nbf > now
      )
        throw new Error();
      if (claims.aud !== clientId) throw new Error();
      const dest = new URL(claims.dest);
      const iss = new URL(claims.iss);
      const shop = shopDomain(dest.hostname);
      if (
        dest.origin !== `https://${shop}` ||
        iss.origin !== dest.origin ||
        iss.pathname !== '/admin'
      )
        throw new Error();
      return shop;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new UnauthorizedException('Invalid Shopify ID token');
    }
  }
}
