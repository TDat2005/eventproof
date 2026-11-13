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
  testOrder: boolean;
  orderCreatedAt: Date;
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

  private includesTestOrders(shop: string): boolean {
    const testShops = (process.env.SALES_TEST_ORDER_SHOPS || '')
      .split(',')
      .map((domain) => domain.trim().toLowerCase())
      .filter(Boolean);
    return (
      process.env.NODE_ENV === 'development' &&
      testShops.includes(shop.toLowerCase())
    );
  }

  async recordCreatedOrder(dto: IncomingOrderDto): Promise<void> {
    return this.connectionsService.withActiveConnection(
      dto.shop,
      async (connection) => {
        const tenantId = connection.tenantId;
        const orderId = internalId('order', connection.id, dto.externalOrderId);

        const snapshot: OrderSnapshotEntity = {
          id: orderId,
          tenantId,
          connectionId: connection.id,
          externalOrderId: dto.externalOrderId,
          cancelled: false,
          testOrder: dto.testOrder,
          orderCreatedAt: dto.orderCreatedAt,
          sourceUpdatedAt: dto.orderCreatedAt,
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

        const includeTestOrder = this.includesTestOrders(dto.shop);
        await this.orderRepository.saveCreatedOrder(
          snapshot,
          lines,
          includeTestOrder,
        );
        this.logger.log(
          `Processed created order ${dto.externalOrderId} for ${dto.shop}: ${lines.length} items`,
        );
      },
    );
  }

  async getSalesMetrics(
    tenantId: string,
    productId: string,
    shop = '',
  ): Promise<number> {
    const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return this.orderRepository.getSoldQuantityLast24h(
      tenantId,
      productId,
      windowStart,
      this.includesTestOrders(shop),
    );
  }
}
