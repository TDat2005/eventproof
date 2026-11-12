import { Injectable, Logger } from '@nestjs/common';
import { IPresenceTracker } from '../domain/engagement.ports.js';
import { RedisService } from '../../../redis/redis.service.js';

@Injectable()
export class RedisPresenceTracker implements IPresenceTracker {
  private readonly logger = new Logger(RedisPresenceTracker.name);

  constructor(private readonly redisService: RedisService) {}

  async recordHeartbeat(
    tenantId: string,
    productId: string,
    clientId: string,
  ): Promise<void> {
    const key = `recent:${tenantId}:${productId}`;
    const now = Math.floor(Date.now() / 1000);

    const client = this.redisService.getClient();
    const pipeline = client.multi();
    // ZADD key score member
    pipeline.zadd(key, now, clientId);
    // Refresh TTL (360s)
    pipeline.expire(key, 360);
    // Cleanup members older than 360s
    pipeline.zremrangebyscore(key, '-inf', now - 360);
    const results = await pipeline.exec();
    if (!results || results.some(([error]) => error))
      throw new Error('Failed to persist presence heartbeat');
  }

  async getPresenceCount(tenantId: string, productId: string): Promise<number> {
    const key = `recent:${tenantId}:${productId}`;
    const now = Math.floor(Date.now() / 1000);
    const windowStart = now - 300; // 5-minute presence window

    const client = this.redisService.getClient();
    return client.zcount(key, `(${windowStart}`, now);
  }
}
