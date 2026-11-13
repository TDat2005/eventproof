import { StoreConnectionEntity } from './connection.entity.js';

export interface IConnectionsRepository {
  withActiveConnection<T>(
    domain: string,
    work: (connection: StoreConnectionEntity) => Promise<T>,
  ): Promise<T>;
  updateTimezone(domain: string, timezone: string): Promise<void>;
  findByStoreDomain(domain: string): Promise<StoreConnectionEntity | null>;
  ensureConnection(
    storeDomain: string,
    timezone?: string,
  ): Promise<StoreConnectionEntity>;
  deactivateConnection(storeDomain: string, triggeredAt: Date): Promise<void>;
}

export const CONNECTIONS_REPOSITORY = Symbol('CONNECTIONS_REPOSITORY');
