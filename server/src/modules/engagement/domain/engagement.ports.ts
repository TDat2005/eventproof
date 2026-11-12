import { ViewEventEntity } from './view-event.entity.js';

export interface IViewRepository {
  recordView(
    view: ViewEventEntity,
    dateStr: string,
  ): Promise<{ isNew: boolean }>;
  getDailyViews(
    tenantId: string,
    productId: string,
    date: string,
  ): Promise<number>;
}

export interface IPresenceTracker {
  recordHeartbeat(
    tenantId: string,
    productId: string,
    clientId: string,
  ): Promise<void>;
  getPresenceCount(tenantId: string, productId: string): Promise<number>;
}

export const VIEW_REPOSITORY = Symbol('VIEW_REPOSITORY');
export const PRESENCE_TRACKER = Symbol('PRESENCE_TRACKER');
