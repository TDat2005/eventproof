import {
  mysqlTable,
  varchar,
  bigint,
  datetime,
  int,
  boolean,
  uniqueIndex,
  index,
  primaryKey,
} from 'drizzle-orm/mysql-core';

// --- CONNECTIONS MODULE SCHEMA ---
export const tenants = mysqlTable('tenants', {
  id: varchar('id', { length: 64 }).primaryKey(),
  storeDomain: varchar('store_domain', { length: 255 }).notNull().unique(),
  createdAt: datetime('created_at')
    .notNull()
    .$defaultFn(() => new Date()),
});

export const storeConnections = mysqlTable(
  'store_connections',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 64 }).notNull(),
    platform: varchar('platform', { length: 32 }).notNull().default('shopify'),
    externalStoreId: varchar('external_store_id', { length: 255 }).notNull(),
    accessToken: varchar('access_token', { length: 512 }),
    timezoneIana: varchar('timezone_iana', { length: 64 })
      .notNull()
      .default('UTC'),
    active: boolean('active').notNull().default(true),
    installedAt: datetime('installed_at', { fsp: 3 })
      .notNull()
      .$defaultFn(() => new Date()),
    uninstalledAt: datetime('uninstalled_at', { fsp: 3 }),
    redactRequestedAt: datetime('redact_requested_at', { fsp: 3 }),
    createdAt: datetime('created_at')
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex('idx_platform_external_store').on(
      table.platform,
      table.externalStoreId,
    ),
    index('idx_conn_tenant').on(table.tenantId),
    index('idx_conn_cleanup').on(table.active, table.uninstalledAt),
  ],
);

// --- CATALOG MODULE SCHEMA ---
export const products = mysqlTable(
  'products',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 64 }).notNull(),
    title: varchar('title', { length: 255 }),
    createdAt: datetime('created_at')
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index('idx_products_tenant').on(table.tenantId)],
);

export const externalProductMappings = mysqlTable(
  'external_product_mappings',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    connectionId: varchar('connection_id', { length: 64 }).notNull(),
    productId: varchar('product_id', { length: 64 }).notNull(),
    externalKind: varchar('external_kind', { length: 32 }).notNull(), // 'PRODUCT' | 'VARIANT'
    externalId: varchar('external_id', { length: 128 }).notNull(), // Shopify numeric ID or GID
    createdAt: datetime('created_at')
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex('idx_conn_kind_ext').on(
      table.connectionId,
      table.externalKind,
      table.externalId,
    ),
    index('idx_mapping_prod').on(table.productId),
  ],
);

// --- SETTINGS MODULE SCHEMA ---
export const merchantSettings = mysqlTable('merchant_settings', {
  tenantId: varchar('tenant_id', { length: 64 }).primaryKey(),
  recentEnabled: boolean('recent_enabled').notNull().default(true),
  recentThreshold: int('recent_threshold').notNull().default(1),
  dailyEnabled: boolean('daily_enabled').notNull().default(true),
  dailyThreshold: int('daily_threshold').notNull().default(1),
  orderEnabled: boolean('order_enabled').notNull().default(true),
  orderThreshold: int('order_threshold').notNull().default(1),
  version: int('version').notNull().default(1),
  updatedAt: datetime('updated_at')
    .notNull()
    .$defaultFn(() => new Date()),
});

// --- ENGAGEMENT MODULE SCHEMA ---
export const viewEvents = mysqlTable(
  'view_events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().autoincrement(),
    tenantId: varchar('tenant_id', { length: 64 }).notNull(),
    productId: varchar('product_id', { length: 64 }).notNull(),
    eventKey: varchar('event_key', { length: 128 }).notNull(), // connection_id + event.id
    occurredAt: datetime('occurred_at').notNull(),
    receivedAt: datetime('received_at')
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex('idx_tenant_event_key').on(table.tenantId, table.eventKey),
    index('idx_view_tenant_product').on(table.tenantId, table.productId),
    index('idx_view_received').on(table.receivedAt),
  ],
);

export const viewsHourly = mysqlTable(
  'views_hourly',
  {
    tenantId: varchar('tenant_id', { length: 64 }).notNull(),
    productId: varchar('product_id', { length: 64 }).notNull(),
    hourUtc: varchar('hour_utc', { length: 13 }).notNull(), // YYYY-MM-DDTHH
    totalViews: bigint('total_views', { mode: 'number' }).notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.productId, table.hourUtc] }),
  ],
);

export const viewsDaily = mysqlTable(
  'views_daily',
  {
    tenantId: varchar('tenant_id', { length: 64 }).notNull(),
    productId: varchar('product_id', { length: 64 }).notNull(),
    date: varchar('date', { length: 10 }).notNull(), // YYYY-MM-DD
    totalViews: bigint('total_views', { mode: 'number' }).notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.productId, table.date] }),
    index('idx_views_daily_tenant_date').on(table.tenantId, table.date),
  ],
);

// --- SALES MODULE SCHEMA ---
export const orderSnapshots = mysqlTable(
  'order_snapshots',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 64 }).notNull(),
    connectionId: varchar('connection_id', { length: 64 }).notNull(),
    externalOrderId: varchar('external_order_id', { length: 128 }).notNull(),
    cancelled: boolean('cancelled').notNull().default(false),
    testOrder: boolean('test_order').notNull().default(false),
    orderCreatedAt: datetime('order_created_at').notNull(),
    sourceUpdatedAt: datetime('source_updated_at', { fsp: 3 }).notNull(),
    syncGeneration: int('sync_generation').notNull().default(1),
    createdAt: datetime('created_at')
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex('idx_conn_ext_order').on(
      table.connectionId,
      table.externalOrderId,
    ),
    index('idx_order_tenant').on(table.tenantId),
  ],
);

export const orderLines = mysqlTable(
  'order_lines',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    tenantId: varchar('tenant_id', { length: 64 }).notNull(),
    orderId: varchar('order_id', { length: 64 }).notNull(),
    lineItemId: varchar('line_item_id', { length: 128 }).notNull(),
    productId: varchar('product_id', { length: 64 }).notNull(),
    currentQuantity: int('current_quantity').notNull().default(0),
  },
  (table) => [
    uniqueIndex('idx_tenant_order_line').on(
      table.tenantId,
      table.orderId,
      table.lineItemId,
    ),
    index('idx_line_prod').on(table.productId),
  ],
);

export const orderContributions = mysqlTable(
  'order_contributions',
  {
    tenantId: varchar('tenant_id', { length: 64 }).notNull(),
    orderId: varchar('order_id', { length: 64 }).notNull(),
    productId: varchar('product_id', { length: 64 }).notNull(),
    orderCreatedAt: datetime('order_created_at').notNull(),
    quantity: int('quantity').notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.orderId, table.productId] }),
    index('idx_contrib_window').on(
      table.tenantId,
      table.productId,
      table.orderCreatedAt,
    ),
  ],
);
