export interface ViewEventEntity {
  id?: number;
  tenantId: string;
  productId: string;
  eventKey: string;
  occurredAt: Date;
  receivedAt?: Date;
}

export interface DailyViewsEntity {
  tenantId: string;
  productId: string;
  date: string;
  totalViews: number;
}
