import { Injectable, Inject, ForbiddenException } from '@nestjs/common';
import { shopDomain, timezoneValue } from '../../../common/values.js';
import type { IConnectionsRepository } from '../domain/connections.repository.port.js';
import { CONNECTIONS_REPOSITORY } from '../domain/connections.repository.port.js';
import type { StoreConnectionEntity } from '../domain/connection.entity.js';

@Injectable()
export class ConnectionsService {
  constructor(
    @Inject(CONNECTIONS_REPOSITORY)
    private readonly connectionsRepository: IConnectionsRepository,
  ) {}

  async resolveConnection(storeDomain: string): Promise<StoreConnectionEntity> {
    const connection = await this.connectionsRepository.findByStoreDomain(
      shopDomain(storeDomain),
    );
    if (!connection?.active)
      throw new ForbiddenException(
        'Shop connection is not active. Open Event-Proof in Shopify Admin first.',
      );
    return connection;
  }

  async activateConnection(
    storeDomain: string,
    timezone: string,
  ): Promise<StoreConnectionEntity> {
    return this.connectionsRepository.ensureConnection(
      shopDomain(storeDomain),
      timezoneValue(timezone),
    );
  }

  async deactivateConnection(
    storeDomain: string,
    triggeredAt: Date,
  ): Promise<void> {
    await this.connectionsRepository.deactivateConnection(
      shopDomain(storeDomain),
      triggeredAt,
    );
  }

  withActiveConnection<T>(
    domain: string,
    work: (connection: StoreConnectionEntity) => Promise<T>,
  ): Promise<T> {
    return this.connectionsRepository.withActiveConnection(
      shopDomain(domain),
      work,
    );
  }

  updateTimezone(domain: string, timezone: string): Promise<void> {
    return this.connectionsRepository.updateTimezone(
      shopDomain(domain),
      timezoneValue(timezone),
    );
  }

  async getConnection(
    storeDomain: string,
  ): Promise<StoreConnectionEntity | null> {
    return this.connectionsRepository.findByStoreDomain(storeDomain);
  }
}
