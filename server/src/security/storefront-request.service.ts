import { BadRequestException, Injectable, HttpException } from '@nestjs/common';
import type { Request } from 'express';
import { ShopifyAuthService } from './shopify-auth.service.js';
import { RedisService } from '../redis/redis.service.js';
import { internalId } from '../common/values.js';

@Injectable()
export class StorefrontRequestService {
  constructor(
    private readonly auth: ShopifyAuthService,
    private readonly redis: RedisService,
  ) {}

  async authenticate(req: Request): Promise<string> {
    const shop = this.auth.verifyProxy(req.query);
    if (req.body?.shop !== undefined && req.body.shop !== shop)
      throw new BadRequestException('Shop does not match signed proxy request');
    const forwarded = req.get('x-forwarded-for')?.split(',')[0].trim();
    const key = internalId(
      'rate',
      shop,
      forwarded || req.ip || 'unknown',
      String(Math.floor(Date.now() / 60_000)),
    );
    const count = Number(
      await this.redis
        .getClient()
        .eval(
          "local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], 70) end; return n",
          1,
          key,
        ),
    );
    if (count > 240)
      throw new HttpException('Too many storefront requests', 429);
    return shop;
  }
}
