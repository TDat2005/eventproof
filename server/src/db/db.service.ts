import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { drizzle, MySql2Database } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema.js';

@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  public db!: MySql2Database<typeof schema>;
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

    this.db = drizzle(this.pool, { schema, mode: 'default' });

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
