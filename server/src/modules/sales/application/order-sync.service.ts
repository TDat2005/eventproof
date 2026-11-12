import { Injectable, Inject, Logger } from '@nestjs/common';
import type { IOrderRepository } from '../domain/sales.ports.js';
import { ORDER_REPOSITORY } from '../domain/sales.ports.js';
import { ConnectionsService } from '../../connections/application/connections.service.js';
import { CatalogService } from '../../catalog/application/catalog.service.js';
import type {
  OrderLineEntity,
  OrderSnapshotEntity,
} from '../domain/order.entity.js';
import { internalId } from '../../../common/values.js';

export interface IncomingOrderDto {
  shop: string;
  externalOrderId: string;
  cancelled: boolean;
  testOrder: boolean;
  orderCreatedAt: Date;
  sourceUpdatedAt: Date;
  lineItems: Array<{
    lineItemId: string;
    externalProductId: string;
    externalVariantId?: string;
    quantity: number;
  }>;
}

@Injectable()
export class OrderSyncService {
  private readonly logger = new Logger(OrderSyncService.name);

  constructor(
    @Inject(ORDER_REPOSITORY)
    private readonly orderRepository: IOrderRepository,
    private readonly connectionsService: ConnectionsService,
    private readonly catalogService: CatalogService,
  ) {}

  async syncOrder(dto: IncomingOrderDto): Promise<void> {
    const connection = await this.connectionsService.resolveConnection(
      dto.shop,
    );
    const tenantId = connection.tenantId;
    const orderId = internalId('order', connection.id, dto.externalOrderId);

    const snapshot: OrderSnapshotEntity = {
      id: orderId,
      tenantId,
      connectionId: connection.id,
      externalOrderId: dto.externalOrderId,
      cancelled: dto.cancelled,
      testOrder: dto.testOrder,
      orderCreatedAt: dto.orderCreatedAt,
      sourceUpdatedAt: dto.sourceUpdatedAt,
      syncGeneration: 1,
    };

    const lines: OrderLineEntity[] = [];

    for (const item of dto.lineItems) {
      const product = await this.catalogService.resolveProduct(
        tenantId,
        connection.id,
        item.externalProductId,
        'PRODUCT',
      );

      lines.push({
        id: internalId('line', orderId, item.lineItemId),
        tenantId,
        orderId,
        lineItemId: item.lineItemId,
        productId: product.id,
        currentQuantity: item.quantity,
      });
    }

    await this.orderRepository.saveOrderSnapshot(snapshot, lines);
    this.logger.log(
      `Synced order ${dto.externalOrderId} for ${dto.shop}: ${lines.length} items`,
    );
  }

  async getSalesMetrics(tenantId: string, productId: string): Promise<number> {
    const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return this.orderRepository.getSoldQuantityLast24h(
      tenantId,
      productId,
      windowStart,
    );
  }
}
