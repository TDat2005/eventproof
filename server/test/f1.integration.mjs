// Run ONLY against an isolated schema named f1_test_*; never merchant data.
import 'reflect-metadata';
import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
import mysql from 'mysql2/promise';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { DbService } from '../dist/db/db.service.js';
import { RedisService } from '../dist/redis/redis.service.js';
import { AppModule } from '../dist/app.module.js';
import { ConnectionsService } from '../dist/modules/connections/application/connections.service.js';
import {
  UninstallCleanupService,
  UninstallCleanupJob,
} from '../dist/modules/connections/application/uninstall-cleanup.service.js';
import { ViewTrackerService } from '../dist/modules/engagement/application/view-tracker.service.js';

if (!/^f1_test_[a-z0-9_]+$/.test(process.env.DATABASE_NAME ?? ''))
  throw new Error(
    'F1 integration requires an isolated DATABASE_NAME=f1_test_*',
  );
process.env.SHOPIFY_API_SECRET = 'f1-test-secret';
process.env.UNINSTALL_RETENTION_DAYS = '30';
let app, db, redis, connections, cleanup, sql, views;
const tables = [
  'order_contributions',
  'order_lines',
  'order_snapshots',
  'view_events',
  'views_hourly',
  'views_daily',
  'merchant_settings',
  'external_product_mappings',
  'products',
  'store_connections',
  'tenants',
];
let shops = [];
let redisKeys = [];
const old = new Date(Date.now() - 31 * 86400000);
const future = new Date(Date.now() + 1000);

async function install() {
  const shop = `f1-${randomUUID()}.myshopify.com`;
  shops.push(shop);
  const connection = await connections.activateConnection(shop, 'UTC');
  return { shop, ...connection };
}
async function uninstall(c, time = new Date()) {
  await connections.deactivateConnection(c.shop, time);
}
async function age(c) {
  await sql.execute(
    'UPDATE store_connections SET uninstalled_at = ? WHERE id = ?',
    [old, c.id],
  );
}
async function rows(table, tenant) {
  const [result] = await sql.execute(
    `SELECT COUNT(*) AS n FROM ${table} WHERE ${table === 'tenants' ? 'id' : 'tenant_id'} = ?`,
    [tenant],
  );
  return result[0].n;
}
async function seed(c) {
  await views.recordView({
    shop: c.shop,
    externalProductId: '123',
    eventId: 'view',
    occurredAt: new Date().toISOString(),
  });
  await views.recordHeartbeat({
    shop: c.shop,
    externalProductId: '123',
    clientId: 'browser',
  });
  const key = `recent:${c.tenantId}:fixture`;
  redisKeys.push(key);
  await redis.getClient().set(key, 'fixture');
  await sql.execute('INSERT INTO merchant_settings (tenant_id) VALUES (?)', [
    c.tenantId,
  ]);
  await sql.execute(
    'INSERT INTO order_snapshots (id,tenant_id,connection_id,external_order_id,order_created_at,source_updated_at) VALUES (?,?,?,?,?,?)',
    [c.id, c.tenantId, c.id, '123', new Date(), new Date()],
  );
  await sql.execute(
    'INSERT INTO order_lines (id,tenant_id,order_id,line_item_id,product_id) VALUES (?,?,?,?,?)',
    [c.id, c.tenantId, c.id, '123', 'product'],
  );
  await sql.execute(
    'INSERT INTO order_contributions (tenant_id,order_id,product_id,order_created_at) VALUES (?,?,?,?)',
    [c.tenantId, c.id, 'product', new Date()],
  );
  return key;
}
function webhook(
  path,
  topic,
  shop,
  payload = {},
  triggeredAt = new Date().toISOString(),
) {
  const body = JSON.stringify(payload);
  return request(app.getHttpServer())
    .post(`/api/webhooks/${path}`)
    .set('Content-Type', 'application/json')
    .set('x-shopify-topic', topic)
    .set('x-shopify-shop-domain', shop)
    .set('x-shopify-triggered-at', triggeredAt)
    .set(
      'x-shopify-hmac-sha256',
      createHmac('sha256', 'f1-test-secret').update(body).digest('base64'),
    )
    .send(body);
}

before(async () => {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(UninstallCleanupJob)
    .useValue({})
    .compile();
  app = module.createNestApplication({ rawBody: true, logger: false });
  await app.init();
  db = app.get(DbService);
  redis = app.get(RedisService);
  connections = app.get(ConnectionsService);
  cleanup = app.get(UninstallCleanupService);
  views = app.get(ViewTrackerService);
  sql = await mysql.createConnection({
    host: process.env.DATABASE_HOST || 'localhost',
    port: Number(process.env.DATABASE_PORT) || 3306,
    user: process.env.DATABASE_USER || 'event_proof_user',
    password: process.env.DATABASE_PASSWORD || 'event_proof_pass',
    database: process.env.DATABASE_NAME,
    timezone: 'Z',
  });
});
beforeEach(async () => {
  // Guard above applies to every statement; this schema is test-owned.
  for (const table of tables) await sql.query(`DELETE FROM ${table}`);
});
after(async () => {
  if (redis) {
    for (const shop of shops) {
      const { internalId } = await import('../dist/common/values.js');
      await redis.deleteTenantData(internalId('tenant', shop));
    }
    if (redisKeys.length) await redis.getClient().del(...redisKeys);
  }
  await sql?.end();
  await app?.close();
});

test('signed uninstall is idempotent, clears token, stops ingest and rejects stale events after reinstall', async () => {
  const c = await install();
  await sql.execute(
    'UPDATE store_connections SET access_token = ? WHERE id = ?',
    ['secret', c.id],
  );
  const at = new Date().toISOString();
  await webhook('app-uninstalled', 'app/uninstalled', c.shop, {}, at).expect(
    200,
  );
  const first = await connections.getConnection(c.shop);
  assert.equal(first.active, false);
  assert.equal(first.accessToken, null);
  await webhook('app-uninstalled', 'app/uninstalled', c.shop, {}, at).expect(
    200,
  );
  assert.equal(
    (await connections.getConnection(c.shop)).uninstalledAt.getTime(),
    first.uninstalledAt.getTime(),
  );
  await assert.rejects(
    views.recordHeartbeat({
      shop: c.shop,
      externalProductId: '123',
      clientId: 'browser',
    }),
  );
  await connections.activateConnection(c.shop, 'UTC');
  await webhook(
    'app-uninstalled',
    'app/uninstalled',
    c.shop,
    {},
    '2000-01-01T00:00:00Z',
  ).expect(200);
  assert.equal((await connections.getConnection(c.shop)).active, true);
});

test('retention boundary, complete tenant deletion, Redis isolation, and two workers', async () => {
  const target = await install(),
    other = await install(),
    recent = await install();
  const key = await seed(target),
    otherKey = await seed(other);
  const rate = `rate:${target.shop}:fixture`;
  const otherRate = `rate:${other.shop}:fixture`;
  redisKeys.push(rate, otherRate);
  await redis.getClient().mset(rate, '1', otherRate, '1');
  await uninstall(target);
  await age(target);
  await uninstall(recent);
  // Shared prefix is deliberately present and must survive.
  const collision = `recent:${target.tenantId}extra:fixture`;
  redisKeys.push(collision);
  await redis.getClient().set(collision, 'other');
  await Promise.all([cleanup.run(), cleanup.run()]);
  for (const table of tables.filter((t) => t !== 'external_product_mappings'))
    assert.equal(await rows(table, target.tenantId), 0, table);
  const [mappings] = await sql.execute(
    'SELECT * FROM external_product_mappings WHERE connection_id = ?',
    [target.id],
  );
  assert.equal(mappings.length, 0);
  assert.equal(await redis.getClient().exists(key), 0);
  assert.equal(await redis.getClient().exists(rate), 0);
  assert.equal(await redis.getClient().exists(otherRate), 1);
  assert.equal(await redis.getClient().exists(otherKey), 1);
  assert.equal(await redis.getClient().exists(collision), 1);
  assert.equal(await rows('tenants', other.tenantId), 1);
  assert.equal(await rows('tenants', recent.tenantId), 1);
});

test('Redis failure preserves durable DB candidate and retries; DB rollback after Redis deletion retries safely', async () => {
  const c = await install();
  const key = await seed(c);
  await uninstall(c);
  await age(c);
  const remove = redis.deleteTenantData.bind(redis);
  redis.deleteTenantData = async () => {
    throw new Error('injected Redis outage');
  };
  try {
    await assert.rejects(cleanup.cleanupTenant(c.tenantId, new Date()));
  } finally {
    redis.deleteTenantData = remove;
  }
  assert.equal(await rows('view_events', c.tenantId), 1);
  assert.equal(await redis.getClient().exists(key), 1);
  // A real FK violation after earlier deletes must roll back the whole purge.
  await sql.query(
    'CREATE TABLE f1_guard (product_id VARCHAR(64), FOREIGN KEY (product_id) REFERENCES products(id))',
  );
  await sql.execute(
    'INSERT INTO f1_guard SELECT id FROM products WHERE tenant_id = ?',
    [c.tenantId],
  );
  try {
    await assert.rejects(cleanup.cleanupTenant(c.tenantId, new Date()));
  } finally {
    await sql.query('DROP TABLE f1_guard');
  }
  assert.equal(await rows('view_events', c.tenantId), 1);
  assert.equal(await redis.getClient().exists(key), 0);
  await cleanup.run();
  assert.equal(await rows('tenants', c.tenantId), 0);
});

test('reinstall wins over stale candidate, and ingest in flight finishes before uninstall', async () => {
  const c = await install();
  await seed(c);
  await uninstall(c);
  await age(c);
  await connections.activateConnection(c.shop, 'UTC');
  assert.equal(await cleanup.cleanupTenant(c.tenantId, future), false);
  assert.equal(await rows('view_events', c.tenantId), 1);
  let release, entered;
  const acquired = new Promise((resolve) => {
    entered = resolve;
  });
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const ingest = connections.withActiveConnection(c.shop, async () => {
    entered();
    await held;
  });
  await acquired;
  const uninstalling = uninstall(c, new Date());
  assert.equal((await connections.getConnection(c.shop)).active, true);
  release();
  await ingest;
  await uninstalling;
  assert.equal((await connections.getConnection(c.shop)).active, false);
});

test('shop/redact bypasses retention, survives Redis failure, and cannot delete an active reinstall', async () => {
  const c = await install();
  await seed(c);
  await uninstall(c);
  const remove = redis.deleteTenantData.bind(redis);
  redis.deleteTenantData = async () => {
    throw new Error('injected outage');
  };
  try {
    await webhook('shop-redact', 'shop/redact', c.shop, {
      shop_domain: c.shop,
    }).expect(500);
  } finally {
    redis.deleteTenantData = remove;
  }
  const [pending] = await sql.execute(
    'SELECT redact_requested_at FROM store_connections WHERE id = ?',
    [c.id],
  );
  assert.ok(pending[0].redact_requested_at);
  await cleanup.run();
  assert.equal(await rows('tenants', c.tenantId), 0);
  await webhook('shop-redact', 'shop/redact', c.shop, {
    shop_domain: c.shop,
  }).expect(200);
  const active = await install();
  await seed(active);
  await webhook('shop-redact', 'shop/redact', active.shop, {
    shop_domain: active.shop,
  }).expect(200);
  assert.equal(await rows('view_events', active.tenantId), 1);
  await request(app.getHttpServer())
    .post('/api/webhooks/shop-redact')
    .send({})
    .expect(401);
});

test('cleanup fences reinstall until Redis deletion and MySQL commit complete', async () => {
  const c = await install();
  await seed(c);
  await uninstall(c);
  await age(c);
  const remove = redis.deleteTenantData.bind(redis);
  let release, entered;
  const acquired = new Promise((resolve) => {
    entered = resolve;
  });
  const held = new Promise((resolve) => {
    release = resolve;
  });
  redis.deleteTenantData = async (tenant) => {
    entered();
    await held;
    await remove(tenant);
  };
  const cleaning = cleanup.cleanupTenant(c.tenantId, new Date());
  await acquired;
  const installing = connections.activateConnection(c.shop, 'UTC');
  release();
  try {
    await cleaning;
    await installing;
  } finally {
    redis.deleteTenantData = remove;
  }
  assert.equal((await connections.getConnection(c.shop)).active, true);
  assert.equal(await rows('view_events', c.tenantId), 0);
});

test('exact retention boundary and zero-day dev retention', async () => {
  const c = await install();
  await uninstall(c);
  const at = (await connections.getConnection(c.shop)).uninstalledAt.getTime();
  assert.equal(
    await cleanup.cleanupTenant(c.tenantId, new Date(at + 30 * 86400000 - 1)),
    false,
  );
  assert.equal(
    await cleanup.cleanupTenant(c.tenantId, new Date(at + 30 * 86400000)),
    true,
  );
  const zero = await install();
  await uninstall(zero);
  process.env.UNINSTALL_RETENTION_DAYS = '0';
  try {
    assert.equal(await cleanup.cleanupTenant(zero.tenantId, new Date()), true);
  } finally {
    process.env.UNINSTALL_RETENTION_DAYS = '30';
  }
});

test('legacy tenant and connection IDs survive activation', async () => {
  const shop = `f1-legacy-${randomUUID()}.myshopify.com`;
  shops.push(shop);
  await sql.execute('INSERT INTO tenants (id,store_domain) VALUES (?,?)', [
    'legacy-tenant',
    shop,
  ]);
  await sql.execute(
    'INSERT INTO store_connections (id,tenant_id,external_store_id,installed_at,active) VALUES (?,?,?,?,FALSE)',
    ['legacy-conn', 'legacy-tenant', shop, new Date()],
  );
  const c = await connections.activateConnection(shop, 'UTC');
  assert.equal(c.id, 'legacy-conn');
  assert.equal(c.tenantId, 'legacy-tenant');
  assert.equal(c.active, true);
});

test('startup migration upgrades legacy inactive rows without deleting data and is repeatable', async () => {
  const c = await install();
  await sql.execute(
    'UPDATE store_connections SET active = FALSE, access_token = ? WHERE id = ?',
    ['legacy-token', c.id],
  );
  await sql.query(
    'ALTER TABLE store_connections DROP INDEX idx_conn_cleanup, DROP COLUMN installed_at, DROP COLUMN uninstalled_at, DROP COLUMN redact_requested_at',
  );
  const migration = new DbService();
  try {
    await migration.onModuleInit();
    const migrated = await connections.getConnection(c.shop);
    assert.equal(migrated.accessToken, null);
    assert.ok(migrated.uninstalledAt.getTime() >= Date.now() - 60000);
    assert.equal(await cleanup.cleanupTenant(c.tenantId, new Date()), false);
    await migration.onModuleDestroy();
    await migration.onModuleInit();
    assert.equal(
      (await connections.getConnection(c.shop)).uninstalledAt.getTime(),
      migrated.uninstalledAt.getTime(),
    );
  } finally {
    await migration.onModuleDestroy();
  }
});
