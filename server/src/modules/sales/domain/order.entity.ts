export interface OrderSnapshotEntity {
  id: string;
  tenantId: string;
  connectionId: string;
  externalOrderId: string;
  cancelled: boolean;
  testOrder: boolean;
  orderCreatedAt: Date;
  sourceUpdatedAt: Date;
  syncGeneration: number;
}

export interface OrderLineEntity {
  id: string;
  tenantId: string;
  orderId: string;
  lineItemId: string;
  productId: string;
  currentQuantity: number;
}

export interface OrderContributionEntity {
  tenantId: string;
  orderId: string;
  productId: string;
  orderCreatedAt: Date;
  quantity: number;
}
