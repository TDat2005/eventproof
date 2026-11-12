import 'reflect-metadata';
import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import { Redis } from 'ioredis';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { config } from 'dotenv';

config({ quiet: true });
process.env.SHOPIFY_API_KEY = 'integration-client';
process.env.SHOPIFY_API_SECRET = 'integration-secret';
const { AppModule } = await import('../dist/app.module.js');
const { DbService } = await import('../dist/db/db.service.js');
const { RedisService } = await import('../dist/redis/redis.service.js');
const { DrizzleViewRepository } =
  await import('../dist/modules/engagement/infrastructure/drizzle-view.repository.js');
const { RedisPresenceTracker } =
  await import('../dist/modules/engagement/infrastructure/redis-presence.tracker.js');
const { internalId } = await import('../dist/common/values.js');

const tables = [
  'tenants',
  'store_connections',
  'products',
  'external_product_mappings',
  'merchant_settings',
  'view_events',
  'views_hourly',
  'views_daily',
  'order_snapshots',
  'order_lines',
  'order_contributions',
];
const shop = `review-${randomUUID()}.myshopify.com`;
let conn, db, redis, app, http;

function adminToken(domain = shop) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString(
    'base64url',
  );
  const payload = Buffer.from(
    JSON.stringify({
      aud: 'integration-client',
      dest: `https://${domain}`,
      iss: `https://${domain}/admin`,
      exp: Date.now() / 1000 + 60,
      nbf: Date.now() / 1000 - 1,
    }),
  ).toString('base64url');
  return `Bearer ${header}.${payload}.${createHmac('sha256', 'integration-secret').update(`${header}.${payload}`).digest('base64url')}`;
}
function proxy(path, domain = shop) {
  const params = {
    shop: domain,
    timestamp: String(Math.floor(Date.now() / 1000)),
  };
  const message = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('');
  return `/api/proxy/${path}?${new URLSearchParams({ ...params, signature: createHmac('sha256', 'integration-secret').update(message).digest('hex') })}`;
}
function webhook(payload, topic = 'orders/updated') {
  const body = JSON.stringify(payload);
  return request(http)
    .post('/api/webhooks/orders')
    .set('Content-Type', 'application/json')
    .set('x-shopify-shop-domain', shop)
    .set('x-shopify-topic', topic)
    .set(
      'x-shopify-hmac-sha256',
      createHmac('sha256', 'integration-secret').update(body).digest('base64'),
    )
    .send(body);
}
async function activate(domain = shop) {
  return request(http)
    .post('/api/admin/connection')
    .set('Authorization', adminToken(domain))
    .send({ timezoneIana: 'Asia/Ho_Chi_Minh' })
    .expect(201);
}
async function count(table) {
  const [rows] = await conn.query(`SELECT COUNT(*) AS n FROM ${table}`);
  return rows[0].n;
}

before(async () => {
  conn = await mysql.createConnection({
    host: process.env.DATABASE_HOST || 'localhost',
    port: Number(process.env.DATABASE_PORT) || 3306,
    user: process.env.DATABASE_USER || 'event_proof_user',
    password: process.env.DATABASE_PASSWORD || 'event_proof_pass',
    database: process.env.DATABASE_NAME || 'event_proof',
    timezone: 'Z',
  });
  // Every SQL operation below targets temporary tables on this one connection.
  // Closing it drops all fixtures; existing merchant tables are never changed.
  for (const table of tables) {
    const [rows] = await conn.query(`SHOW CREATE TABLE ${table}`);
    await conn.query(
      rows[0]['Create Table'].replace('CREATE TABLE', 'CREATE TEMPORARY TABLE'),
    );
  }
  db = drizzle(conn);
  redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT) || 6380,
  });
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DbService)
    .useValue({ db })
    .overrideProvider(RedisService)
    .useValue({ getClient: () => redis })
    .compile();
  app = module.createNestApplication({ rawBody: true, logger: false });
  await app.init();
  http = app.getHttpServer();
});
beforeEach(async () => {
  for (const table of [...tables].reverse())
    await conn.query(`DELETE FROM ${table}`);
});
after(async () => {
  await app?.close();
  if (redis) {
    const tenant = internalId('tenant', shop);
    const keys = await redis.keys(`recent:${tenant}:*`);
    if (keys.length) await redis.del(...keys);
    await redis.quit();
  }
  await conn?.end();
});

void test('HTTP rejects unsigned traffic, cross-shop overrides, and anonymous provisioning', async () => {
  await request(http)
    .post('/api/admin/connection')
    .send({ timezoneIana: 'UTC' })
    .expect(401);
  await request(http)
    .post('/api/proxy/events/view')
    .send({ shop, productId: '123' })
    .expect(401);
  await request(http)
    .post('/api/webhooks/orders')
    .set('x-shopify-shop-domain', shop)
    .send({ id: 123 })
    .expect(401);
  await request(http).get(proxy('metrics/123')).expect(403);
  assert.equal(await count('tenants'), 0);
  await activate();
  await request(http)
    .post(proxy('events/heartbeat'))
    .send({
      shop: 'other.myshopify.com',
      productId: '123',
      clientId: 'browser',
    })
    .expect(400);
  await request(http)
    .post('/api/events/view')
    .send({ shop, productId: '123' })
    .expect(404);
});

void test('one page view survives duplicate delivery; polling and heartbeat never increase daily views', async () => {
  await activate();
  const body = {
    productId: '123',
    eventId: 'same-event',
    occurredAt: new Date().toISOString(),
  };
  const first = await request(http)
    .post(proxy('events/view'))
    .send(body)
    .expect(200);
  const duplicate = await request(http)
    .post(proxy('events/view'))
    .send(body)
    .expect(200);
  assert.equal(first.body.isNew, true);
  assert.equal(duplicate.body.isNew, false);
  await request(http)
    .post(proxy('events/heartbeat'))
    .send({ productId: '123', clientId: 'browser' })
    .expect(200);
  const one = await request(http).get(proxy('metrics/123')).expect(200);
  const two = await request(http).get(proxy('metrics/123')).expect(200);
  assert.equal(one.body.viewsToday, 1);
  assert.equal(two.body.viewsToday, 1);
  assert.equal(two.body.recentViewers, 1);
  assert.equal(await count('view_events'), 1);
  const [hourly] = await conn.query('SELECT total_views FROM views_hourly');
  assert.equal(hourly[0].total_views, 1);
});

void test('dedup is scoped to product, and GET metrics does not create catalog rows', async () => {
  await activate();
  await request(http).get(proxy('metrics/999')).expect(200);
  assert.equal(await count('products'), 0);
  for (const productId of ['123', '124'])
    await request(http)
      .post(proxy('events/view'))
      .send({
        productId,
        eventId: 'same-event',
        occurredAt: new Date().toISOString(),
      })
      .expect(200);
  assert.equal(await count('view_events'), 2);
});

void test('settings persist, enforce thresholds, and reject tenant injection or invalid types', async () => {
  await activate();
  await request(http)
    .post('/api/admin/settings')
    .set('Authorization', adminToken())
    .send({ recentEnabled: false, dailyThreshold: 3, orderEnabled: false })
    .expect(201);
  const result = await request(http)
    .get('/api/admin/settings')
    .set('Authorization', adminToken())
    .expect(200);
  assert.equal(result.body.recentEnabled, false);
  assert.equal(result.body.dailyThreshold, 3);
  const metrics = await request(http).get(proxy('metrics/123')).expect(200);
  assert.deepEqual(metrics.body.display, {
    showRecent: false,
    showDaily: false,
    showOrders: false,
  });
  for (const bad of [
    { tenantId: 'other' },
    { recentThreshold: -1 },
    { recentEnabled: 'false' },
    { dailyThreshold: 1.5 },
  ]) {
    await request(http)
      .post('/api/admin/settings')
      .set('Authorization', adminToken())
      .send(bad)
      .expect(400);
  }
});

void test('orders replace removed products, reject stale updates, exclude cancellations and test orders', async () => {
  await activate();
  const created = new Date(Date.now() - 60_000).toISOString();
  const updated = new Date(Date.now() - 30_000).toISOString();
  const payload = {
    id: '1234567890123',
    created_at: created,
    updated_at: created,
    test: false,
    cancelled_at: null,
    line_items: [{ id: '12345678901234', product_id: '123', quantity: 2 }],
  };
  await webhook(payload, 'orders/create').expect(200);
  await webhook(payload, 'orders/create').expect(200);
  let result = await request(http).get(proxy('metrics/123')).expect(200);
  assert.equal(result.body.ordersLast24h, 2);
  await webhook({ ...payload, updated_at: updated, line_items: [] }).expect(
    200,
  );
  await webhook(payload, 'orders/create').expect(200);
  result = await request(http).get(proxy('metrics/123')).expect(200);
  assert.equal(result.body.ordersLast24h, 0);
  await webhook(
    { ...payload, updated_at: new Date().toISOString(), cancelled_at: updated },
    'orders/cancelled',
  ).expect(200);
  await webhook(payload, 'orders/create').expect(200);
  await webhook({ ...payload, id: 'test-order', test: true }).expect(200);
  result = await request(http).get(proxy('metrics/123')).expect(200);
  assert.equal(result.body.ordersLast24h, 0);
  const [rows] = await conn.query(
    'SELECT MAX(CHAR_LENGTH(id)) AS n FROM order_lines',
  );
  assert.ok(rows[0].n <= 64);
});

void test('tenant isolation and uninstall prevent subsequent storefront tracking', async () => {
  await activate();
  const other = `review-other-${randomUUID()}.myshopify.com`;
  await activate(other);
  await request(http)
    .post(proxy('events/view'))
    .send({
      productId: '123',
      eventId: 'view',
      occurredAt: new Date().toISOString(),
    })
    .expect(200);
  const otherResult = await request(http)
    .get(proxy('metrics/123', other))
    .expect(200);
  assert.equal(otherResult.body.viewsToday, 0);
  const body = '{}';
  await request(http)
    .post('/api/webhooks/app-uninstalled')
    .set('Content-Type', 'application/json')
    .set('x-shopify-shop-domain', shop)
    .set('x-shopify-topic', 'app/uninstalled')
    .set(
      'x-shopify-hmac-sha256',
      createHmac('sha256', 'integration-secret').update(body).digest('base64'),
    )
    .send(body)
    .expect(200);
  await request(http).get(proxy('metrics/123')).expect(403);
  await request(http)
    .post(proxy('events/heartbeat'))
    .send({ productId: '123', clientId: 'browser' })
    .expect(403);
});

void test('sales sums quantities across variants and excludes orders outside 24 hours', async () => {
  await activate();
  const now = new Date(Date.now() - 60_000).toISOString();
  const old = new Date(Date.now() - 25 * 3600_000).toISOString();
  const lines = [
    { id: 'line-a', product_id: '123', quantity: 2 },
    { id: 'line-b', product_id: '123', quantity: 3 },
  ];
  await webhook({
    id: 'new-order',
    created_at: now,
    updated_at: now,
    line_items: lines,
  }).expect(200);
  await webhook({
    id: 'old-order',
    created_at: old,
    updated_at: old,
    line_items: lines,
  }).expect(200);
  const result = await request(http).get(proxy('metrics/123')).expect(200);
  assert.equal(result.body.ordersLast24h, 5);
  assert.equal(await count('order_contributions'), 2);
});

void test('failed order replacement rolls back snapshot, lines and contributions together', async () => {
  await activate();
  const time = new Date(Date.now() - 60_000).toISOString();
  const payload = {
    id: 'rollback-order',
    created_at: time,
    updated_at: time,
    line_items: [{ id: 'line-a', product_id: '123', quantity: 2 }],
  };
  await webhook(payload).expect(200);
  await conn.query(
    'ALTER TABLE order_contributions ADD CONSTRAINT review_quantity CHECK (quantity < 3)',
  );
  try {
    await webhook({
      ...payload,
      updated_at: new Date().toISOString(),
      line_items: [{ ...payload.line_items[0], quantity: 3 }],
    }).expect(500);
    const result = await request(http).get(proxy('metrics/123')).expect(200);
    assert.equal(result.body.ordersLast24h, 2);
    const [rows] = await conn.query('SELECT current_quantity FROM order_lines');
    assert.equal(rows[0].current_quantity, 2);
  } finally {
    await conn.query(
      'ALTER TABLE order_contributions DROP CHECK review_quantity',
    );
  }
});

void test('view counter failure rolls back the event, allowing a successful retry', async () => {
  const repo = new DrizzleViewRepository({ db });
  const view = {
    tenantId: 'rollback',
    productId: 'product',
    eventKey: 'key',
    occurredAt: new Date(),
  };
  await conn.query(
    'ALTER TABLE views_daily ADD CONSTRAINT review_counter CHECK (total_views < 1)',
  );
  try {
    await assert.rejects(repo.recordView(view, '2026-11-12'));
    assert.equal(await count('view_events'), 0);
    assert.equal(await count('views_hourly'), 0);
  } finally {
    await conn.query('ALTER TABLE views_daily DROP CHECK review_counter');
  }
  assert.deepEqual(await repo.recordView(view, '2026-11-12'), { isNew: true });
});

void test('Redis counts unique browser IDs per product within the 5-minute window', async () => {
  const tracker = new RedisPresenceTracker({ getClient: () => redis });
  const tenant = internalId('tenant', shop);
  const key = `recent:${tenant}:presence-test`;
  const now = Math.floor(Date.now() / 1000);
  await redis.del(key);
  await tracker.recordHeartbeat(tenant, 'presence-test', 'browser-a');
  await tracker.recordHeartbeat(tenant, 'presence-test', 'browser-a');
  await tracker.recordHeartbeat(tenant, 'presence-test', 'browser-b');
  await redis.zadd(key, now - 301, 'expired-browser');
  assert.equal(await tracker.getPresenceCount(tenant, 'presence-test'), 2);
  assert.equal(await tracker.getPresenceCount(tenant, 'different-product'), 0);
});
