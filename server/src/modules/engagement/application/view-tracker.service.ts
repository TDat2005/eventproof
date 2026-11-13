import { Injectable, Inject } from '@nestjs/common';
import type {
  IViewRepository,
  IPresenceTracker,
} from '../domain/engagement.ports.js';
import {
  VIEW_REPOSITORY,
  PRESENCE_TRACKER,
} from '../domain/engagement.ports.js';
import { ConnectionsService } from '../../connections/application/connections.service.js';
import { CatalogService } from '../../catalog/application/catalog.service.js';
import {
  eventDate,
  internalId,
  localDate,
  productId,
  textValue,
} from '../../../common/values.js';

@Injectable()
export class ViewTrackerService {
  constructor(
    @Inject(VIEW_REPOSITORY)
    private readonly viewRepository: IViewRepository,
    @Inject(PRESENCE_TRACKER)
    private readonly presenceTracker: IPresenceTracker,
    private readonly connectionsService: ConnectionsService,
    private readonly catalogService: CatalogService,
  ) {}

  async recordView(dto: {
    shop: string;
    externalProductId: string;
    eventId: string;
    occurredAt: string;
  }) {
    const occurredAt = eventDate(dto.occurredAt);
    const eventId = textValue(dto.eventId, 'eventId');
    return this.connectionsService.withActiveConnection(
      dto.shop,
      async (connection) => {
        const product = await this.catalogService.resolveProduct(
          connection.tenantId,
          connection.id,
          productId(dto.externalProductId),
          'PRODUCT',
        );

        const eventKey = internalId('view', connection.id, product.id, eventId);
        const dateStr = localDate(occurredAt, connection.timezoneIana);

        return this.viewRepository.recordView(
          {
            tenantId: connection.tenantId,
            productId: product.id,
            eventKey,
            occurredAt,
          },
          dateStr,
        );
      },
    );
  }

  async recordHeartbeat(dto: {
    shop: string;
    externalProductId: string;
    clientId: string;
  }) {
    return this.connectionsService.withActiveConnection(
      dto.shop,
      async (connection) => {
        const product = await this.catalogService.resolveProduct(
          connection.tenantId,
          connection.id,
          productId(dto.externalProductId),
          'PRODUCT',
        );

        await this.presenceTracker.recordHeartbeat(
          connection.tenantId,
          product.id,
          textValue(dto.clientId, 'clientId'),
        );
        return { success: true };
      },
    );
  }

  async getEngagementMetrics(
    tenantId: string,
    productId: string,
    timezone: string,
  ) {
    const today = localDate(new Date(), timezone);
    const [recentViewers, viewsToday] = await Promise.all([
      this.presenceTracker.getPresenceCount(tenantId, productId),
      this.viewRepository.getDailyViews(tenantId, productId, today),
    ]);

    return { recentViewers, viewsToday };
  }
}
