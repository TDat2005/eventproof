import { StoreConnectionEntity } from './connection.entity.js';

export interface IConnectionsRepository {
  findByStoreDomain(domain: string): Promise<StoreConnectionEntity | null>;
  ensureConnection(
    storeDomain: string,
    timezone?: string,
  ): Promise<StoreConnectionEntity>;
  deactivateConnection(storeDomain: string): Promise<void>;
}

export const CONNECTIONS_REPOSITORY = Symbol('CONNECTIONS_REPOSITORY');
