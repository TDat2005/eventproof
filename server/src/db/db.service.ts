import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { drizzle, MySql2Database } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema.js';
import { AsyncLocalStorage } from 'node:async_hooks';

@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  private database!: MySql2Database<typeof schema>;
  private readonly scope = new AsyncLocalStorage<
    MySql2Database<typeof schema>
  >();
  get db(): MySql2Database<typeof schema> {
    return this.scope.getStore() ?? this.database;
  }

  async transaction<T>(work: () => Promise<T>): Promise<T> {
    if (this.scope.getStore()) return work();
    return this.database.transaction((tx) =>
      this.scope.run(tx as unknown as MySql2Database<typeof schema>, work),
    );
  }
  private pool!: mysql.Pool;
  private readonly logger = new Logger(DbService.name);

  async onModuleInit() {
    this.pool = mysql.createPool({
      host: process.env.DATABASE_HOST || 'localhost',
      port: Number(process.env.DATABASE_PORT) || 3306,
      user: process.env.DATABASE_USER || 'event_proof_user',
      password: process.env.DATABASE_PASSWORD || 'event_proof_pass',
      database: process.env.DATABASE_NAME || 'event_proof',
      timezone: 'Z',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });

    this.database = drizzle(this.pool, { schema, mode: 'default' });

    await this.initTables();
    this.logger.log('Database tables verified and initialized successfully.');
  }

  async onModuleDestroy() {
    if (this.pool) {
      await this.pool.end();
    }
  }

  private async initTables() {
    const connection = await this.pool.getConnection();
    try {
      // 1. Tenants & Store Connections
      await connection.query(`
        CREATE TABLE IF NOT EXISTS tenants (
          id VARCHAR(64) PRIMARY KEY,
          store_domain VARCHAR(255) NOT NULL UNIQUE,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS store_connections (
          id VARCHAR(64) PRIMARY KEY,
          tenant_id VARCHAR(64) NOT NULL,
          platform VARCHAR(32) NOT NULL DEFAULT 'shopify',
          external_store_id VARCHAR(255) NOT NULL,
          access_token VARCHAR(512),
          timezone_iana VARCHAR(64) NOT NULL DEFAULT 'UTC',
          active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY idx_platform_external_store (platform, external_store_id),
          INDEX idx_conn_tenant (tenant_id)
        );
      `);

      // F1: startup migration follows the existing information_schema pattern.
      // Serialize DDL across app replicas (MySQL DDL implicitly commits).
      const [locks] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT GET_LOCK('event_proof_f1_migration', 60) AS acquired",
      );
      if (Number(locks[0]?.acquired) !== 1)
        throw new Error('F1 migration lock timeout');
      try {
        const [columns] = await connection.query<mysql.RowDataPacket[]>(
          "SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'store_connections'",
        );
        const names = new Set(columns.map((column) => column.name));
        for (const name of [
          'installed_at',
          'uninstalled_at',
          'redact_requested_at',
        ]) {
          if (!names.has(name))
            await connection.query(
              `ALTER TABLE store_connections ADD COLUMN ${name} DATETIME(3) NULL`,
            );
        }
        await connection.query(
          'UPDATE store_connections SET installed_at = created_at WHERE installed_at IS NULL',
        );
        await connection.query(
          'ALTER TABLE store_connections MODIFY installed_at DATETIME(3) NOT NULL',
        );
        // Legacy inactive shops have no known uninstall time: start retention now.
        await connection.query(
          'UPDATE store_connections SET uninstalled_at = UTC_TIMESTAMP(3), access_token = NULL WHERE active = FALSE AND uninstalled_at IS NULL',
        );
        const [indexes] = await connection.query<mysql.RowDataPacket[]>(
          "SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'store_connections' AND INDEX_NAME = 'idx_conn_cleanup'",
        );
        if (!indexes.length)
          await connection.query(
            'CREATE INDEX idx_conn_cleanup ON store_connections (active, uninstalled_at)',
          );
      } finally {
        await connection.query(
          "SELECT RELEASE_LOCK('event_proof_f1_migration')",
        );
      }

      // 2. Catalog
      await connection.query(`
        CREATE TABLE IF NOT EXISTS products (
          id VARCHAR(64) PRIMARY KEY,
          tenant_id VARCHAR(64) NOT NULL,
          title VARCHAR(255),
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_products_tenant (tenant_id)
        );
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS external_product_mappings (
          id VARCHAR(64) PRIMARY KEY,
          connection_id VARCHAR(64) NOT NULL,
          product_id VARCHAR(64) NOT NULL,
          external_kind VARCHAR(32) NOT NULL,
          external_id VARCHAR(128) NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY idx_conn_kind_ext (connection_id, external_kind, external_id),
          INDEX idx_mapping_prod (product_id)
        );
      `);

      // 3. Settings
      await connection.query(`
        CREATE TABLE IF NOT EXISTS merchant_settings (
          tenant_id VARCHAR(64) PRIMARY KEY,
          recent_enabled BOOLEAN NOT NULL DEFAULT TRUE,
          recent_threshold INT NOT NULL DEFAULT 1,
          daily_enabled BOOLEAN NOT NULL DEFAULT TRUE,
          daily_threshold INT NOT NULL DEFAULT 1,
          order_enabled BOOLEAN NOT NULL DEFAULT TRUE,
          order_threshold INT NOT NULL DEFAULT 1,
          version INT NOT NULL DEFAULT 1,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        );
      `);

      // 4. Engagement (Views & Presence)
      await connection.query(`
        CREATE TABLE IF NOT EXISTS view_events (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          tenant_id VARCHAR(64) NOT NULL,
          product_id VARCHAR(64) NOT NULL,
          event_key VARCHAR(128) NOT NULL,
          occurred_at DATETIME NOT NULL,
          received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY idx_tenant_event_key (tenant_id, event_key),
          INDEX idx_view_tenant_product (tenant_id, product_id),
          INDEX idx_view_received (received_at)
        );
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS views_hourly (
          tenant_id VARCHAR(64) NOT NULL,
          product_id VARCHAR(64) NOT NULL,
          hour_utc VARCHAR(13) NOT NULL,
          total_views BIGINT NOT NULL DEFAULT 0,
          PRIMARY KEY (tenant_id, product_id, hour_utc)
        );
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS views_daily (
          tenant_id VARCHAR(64) NOT NULL,
          product_id VARCHAR(64) NOT NULL,
          date VARCHAR(10) NOT NULL,
          total_views BIGINT NOT NULL DEFAULT 0,
          PRIMARY KEY (tenant_id, product_id, date)
        );
      `);

      // F6: range scans across all products need tenant/date as a left prefix.
      const [analyticsLocks] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT GET_LOCK('event_proof_f6_migration', 60) AS acquired",
      );
      if (Number(analyticsLocks[0]?.acquired) !== 1)
        throw new Error('F6 migration lock timeout');
      try {
        const [indexes] = await connection.query<mysql.RowDataPacket[]>(
          "SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'views_daily' AND INDEX_NAME = 'idx_views_daily_tenant_date'",
        );
        if (!indexes.length)
          await connection.query(
            'CREATE INDEX idx_views_daily_tenant_date ON views_daily (tenant_id, date)',
          );
      } finally {
        await connection.query(
          "SELECT RELEASE_LOCK('event_proof_f6_migration')",
        );
      }

      // 5. Sales (Orders & Contributions)
      await connection.query(`
        CREATE TABLE IF NOT EXISTS order_snapshots (
          id VARCHAR(64) PRIMARY KEY,
          tenant_id VARCHAR(64) NOT NULL,
          connection_id VARCHAR(64) NOT NULL,
          external_order_id VARCHAR(128) NOT NULL,
          cancelled BOOLEAN NOT NULL DEFAULT FALSE,
          test_order BOOLEAN NOT NULL DEFAULT FALSE,
          order_created_at DATETIME NOT NULL,
          source_updated_at DATETIME(3) NOT NULL,
          sync_generation INT NOT NULL DEFAULT 1,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY idx_conn_ext_order (connection_id, external_order_id),
          INDEX idx_order_tenant (tenant_id)
        );
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS order_lines (
          id VARCHAR(64) PRIMARY KEY,
          tenant_id VARCHAR(64) NOT NULL,
          order_id VARCHAR(64) NOT NULL,
          line_item_id VARCHAR(128) NOT NULL,
          product_id VARCHAR(64) NOT NULL,
          current_quantity INT NOT NULL DEFAULT 0,
          UNIQUE KEY idx_tenant_order_line (tenant_id, order_id, line_item_id),
          INDEX idx_line_prod (product_id)
        );
      `);

      await connection.query(`
        CREATE TABLE IF NOT EXISTS order_contributions (
          tenant_id VARCHAR(64) NOT NULL,
          order_id VARCHAR(64) NOT NULL,
          product_id VARCHAR(64) NOT NULL,
          order_created_at DATETIME NOT NULL,
          quantity INT NOT NULL DEFAULT 0,
          PRIMARY KEY (tenant_id, order_id, product_id),
          INDEX idx_contrib_window (tenant_id, product_id, order_created_at)
        );
      `);
      // Add precision without replacing existing data or changing internal IDs.
      const [precisionRows] = await connection.query<mysql.RowDataPacket[]>(`
        SELECT DATETIME_PRECISION AS precision_value FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_snapshots' AND COLUMN_NAME = 'source_updated_at'
      `);
      if (Number(precisionRows[0]?.precision_value) < 3) {
        await connection.query(
          'ALTER TABLE order_snapshots MODIFY source_updated_at DATETIME(3) NOT NULL',
        );
      }
    } finally {
      connection.release();
    }
  }
}
