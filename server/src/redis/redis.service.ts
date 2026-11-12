import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client!: Redis;
  private readonly logger = new Logger(RedisService.name);

  onModuleInit() {
    this.client = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT) || 6380,
      lazyConnect: false,
    });

    this.client.on('connect', () => {
      this.logger.log('Connected to Redis successfully');
    });

    this.client.on('error', (err) => {
      this.logger.error('Redis connection error:', err);
    });
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
    }
  }

  getClient(): Redis {
    return this.client;
  }

  /**
   * Records a heartbeat for presence detection (ZSET score = current epoch timestamp in seconds)
   * Key: recent:{tenantId}:{productId}
   */
  async recordHeartbeat(tenantId: string, productId: string, clientId: string): Promise<void> {
    const key = `recent:${tenantId}:${productId}`;
    const now = Math.floor(Date.now() / 1000);

    const pipeline = this.client.pipeline();
    // ZADD key score member
    pipeline.zadd(key, now, clientId);
    // Refresh TTL (360 seconds)
    pipeline.expire(key, 360);
    // Cleanup members older than 360s
    pipeline.zremrangebyscore(key, '-inf', now - 360);
    await pipeline.exec();
  }

  /**
   * Counts active viewers in the last 300 seconds (5 minutes)
   */
  async getPresenceCount(tenantId: string, productId: string): Promise<number> {
    const key = `recent:${tenantId}:${productId}`;
    const now = Math.floor(Date.now() / 1000);
    const windowStart = now - 300; // 5 minutes window

    // ZCOUNT returns count of members with score in (windowStart, +inf)
    const count = await this.client.zcount(key, windowStart, '+inf');
    return count;
  }
}
