import 'reflect-metadata';
import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import mysql from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import { config } from 'dotenv';
import { Test } from '@nestjs/testing';
import request from 'supertest';

config({ quiet: true });
process.env.SHOPIFY_API_KEY = 'f6-client';
process.env.SHOPIFY_API_SECRET = 'f6-secret';
const { AppModule } = await import('../dist/app.module.js');
const { DbService } = await import('../dist/db/db.service.js');
const { RedisService } = await import('../dist/redis/redis.service.js');
const { UninstallCleanupJob } =
  await import('../dist/modules/connections/application/uninstall-cleanup.service.js');
const { AnalyticsService, analyticsWindow } =
  await import('../dist/modules/engagement/application/analytics.service.js');
const { localDate } = await import('../dist/common/values.js');
const { DrizzleViewRepository } =
  await import('../dist/modules/engagement/infrastructure/drizzle-view.repository.js');
let conn, app, http, repository;
const tables = [
  'tenants',
  'store_connections',
  'products',
  'views_daily',
  'view_events',
  'views_hourly',
];
const zone = 'Asia/Ho_Chi_Minh';
const shop = 'analytics-a.myshopify.com';
const other = 'analytics-b.myshopify.com';

function token(domain = shop, claims = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString(
    'base64url',
  );
  const body = Buffer.from(
    JSON.stringify({
      aud: 'f6-client',
      dest: `https://${domain}`,
      iss: `https://${domain}/admin`,
      exp: Date.now() / 1000 + 60,
      nbf: Date.now() / 1000 - 1,
      ...claims,
    }),
  ).toString('base64url');
  return `Bearer ${header}.${body}.${createHmac('sha256', 'f6-secret').update(`${header}.${body}`).digest('base64url')}`;
}
const get = (path = '', authorization = token()) =>
  request(http)
    .get('/api/admin/analytics' + path)
    .set('Authorization', authorization);

before(async () => {
  conn = await mysql.createConnection({
    host: process.env.DATABASE_HOST || 'localhost',
    port: Number(process.env.DATABASE_PORT) || 3306,
    user: process.env.DATABASE_USER || 'event_proof_user',
    password: process.env.DATABASE_PASSWORD || 'event_proof_pass',
    database: process.env.DATABASE_NAME || 'event_proof',
    timezone: 'Z',
  });
  // Fixtures only shadow real tables on this private connection; no merchant data is modified.
  for (const table of tables) {
    const [rows] = await conn.query(`SHOW CREATE TABLE ${table}`);
    await conn.query(
      rows[0]['Create Table'].replace('CREATE TABLE', 'CREATE TEMPORARY TABLE'),
    );
  }
  const [columns] = await conn.query('SHOW COLUMNS FROM store_connections');
  for (const name of [
    'installed_at',
    'uninstalled_at',
    'redact_requested_at',
  ]) {
    if (!columns.some((column) => column.Field === name))
      await conn.query(
        `ALTER TABLE store_connections ADD COLUMN ${name} DATETIME(3) NULL`,
      );
  }
  const dbService = new DbService();
  dbService.database = drizzle(conn);
  dbService.onModuleInit = () => {};
  dbService.onModuleDestroy = () => {};
  repository = new DrizzleViewRepository(dbService);
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DbService)
    .useValue(dbService)
    .overrideProvider(RedisService)
    .useValue({ getClient: () => ({}) })
    .overrideProvider(UninstallCleanupJob)
    .useValue({})
    .compile();
  app = module.createNestApplication({ logger: false });
  await app.init();
  http = app.getHttpServer();
});

beforeEach(async () => {
  for (const table of [...tables].reverse())
    await conn.query(`DELETE FROM ${table}`);
  await conn.query('INSERT INTO tenants (id,store_domain) VALUES (?,?),(?,?)', [
    'a',
    shop,
    'b',
    other,
  ]);
  await conn.query(
    `INSERT INTO store_connections (id,tenant_id,external_store_id,timezone_iana,active,installed_at) VALUES ('ca','a',?, ?,TRUE,NOW()),('cb','b',?, ?,TRUE,NOW())`,
    [shop, zone, other, zone],
  );
});
after(async () => {
  await app?.close();
  await conn?.end();
});

test('empty response contains 30 zero dates and cannot be cached', async () => {
  const { body, headers } = await get().expect(200);
  assert.equal(body.daily.length, 30);
  assert.equal(body.totalViews, 0);
  assert.ok(body.daily.every((day) => day.views === 0));
  assert.deepEqual(body.topProducts, []);
  assert.equal(body.timezone, zone);
  assert.equal(headers['cache-control'], 'no-store');
});

test('full 30 days, gaps, inclusive boundaries, totals and top 10 order are tenant scoped', async () => {
  const now = new Date('2026-11-12T17:00:00Z');
  const { dates, startDate, endDate } = analyticsWindow(zone, now);
  for (let i = 0; i < 12; i++) {
    const id = `p${String(i).padStart(2, '0')}`;
    await conn.query(
      'INSERT INTO products(id,tenant_id,title) VALUES (?,?,?)',
      [id, 'a', `Product ${i}`],
    );
    for (const date of dates)
      await conn.query('INSERT INTO views_daily VALUES (?,?,?,?)', [
        'a',
        id,
        date,
        i + 1,
      ]);
  }
  await conn.query(
    "INSERT INTO products(id,tenant_id,title) VALUES ('secret','b','PRIVATE TITLE')",
  );
  await conn.query(
    "INSERT INTO views_daily VALUES ('b','secret',?,999999),('a','p00','2026-10-14',99999),('a','p00','2026-11-14',99999)",
    [endDate],
  );
  const service = new AnalyticsService(repository);
  let result = await service.dashboard('a', zone, now);
  assert.equal(result.totalViews, 78 * 30);
  assert.deepEqual(
    result.daily,
    dates.map((date) => ({ date, views: 78 })),
  );
  assert.deepEqual(
    result.topProducts.map((p) => p.productId),
    ['p11', 'p10', 'p09', 'p08', 'p07', 'p06', 'p05', 'p04', 'p03', 'p02'],
  );
  assert.deepEqual(
    result.topProducts.map((p) => p.views),
    [360, 330, 300, 270, 240, 210, 180, 150, 120, 90],
  );
  assert.equal(result.startDate, startDate);
  assert.equal(result.endDate, endDate);
  await conn.query('DELETE FROM views_daily WHERE tenant_id = ? AND date = ?', [
    'a',
    dates[5],
  ]);
  result = await service.dashboard('a', zone, now);
  assert.equal(result.daily[5].views, 0);
  assert.equal(result.totalViews, 78 * 29);
});

test('ties are deterministic, missing catalog entries retain counts, cross-tenant titles never leak', async () => {
  const { endDate } = analyticsWindow(zone);
  await conn.query(
    "INSERT INTO products(id,tenant_id,title) VALUES ('foreign','b','SECRET')",
  );
  await conn.query(
    "INSERT INTO views_daily VALUES ('a','foreign',?,5),('a','missing',?,5)",
    [endDate, endDate],
  );
  const { body } = await get().expect(200);
  assert.deepEqual(body.topProducts, [
    { productId: 'foreign', title: null, views: 5 },
    { productId: 'missing', title: null, views: 5 },
  ]);
  assert.equal(body.totalViews, 10);
  const standalone = await get('/top-products').expect(200);
  assert.deepEqual(standalone.body.topProducts, body.topProducts);
});

test('HTTP ignores query overrides and derives tenant from signed destination', async () => {
  const { endDate } = analyticsWindow(zone);
  await conn.query(
    "INSERT INTO views_daily VALUES ('a','one',?,2),('b','two',?,888)",
    [endDate, endDate],
  );
  const a = await get(`?tenantId=b&shop=${other}&timezone=UTC`).expect(200);
  assert.equal(a.body.totalViews, 2);
  const b = await get('', token(other)).expect(200);
  assert.equal(b.body.totalViews, 888);
});

test('both APIs reject anonymous, expired, forged and inactive access', async () => {
  for (const path of ['', '/top-products']) {
    await get(path, '').expect(401);
    await get(path, token(shop, { exp: 1 })).expect(401);
    await get(path, token() + 'forged').expect(401);
    await get(path, token('uninstalled.myshopify.com')).expect(403);
  }
  await conn.query(
    "UPDATE store_connections SET active=FALSE WHERE tenant_id='a'",
  );
  await get().expect(403);
  await get('/top-products').expect(403);
});

test('event deduplication counts page views and records both sides of local midnight', async () => {
  const before = new Date('2026-11-12T16:59:59Z');
  const after = new Date('2026-11-12T17:00:00Z');
  const view = {
    tenantId: 'a',
    productId: 'page',
    eventKey: 'event-1',
    occurredAt: before,
  };
  assert.deepEqual(await repository.recordView(view, localDate(before, zone)), {
    isNew: true,
  });
  assert.deepEqual(await repository.recordView(view, localDate(before, zone)), {
    isNew: false,
  });
  await repository.recordView(
    { ...view, eventKey: 'reload', occurredAt: after },
    localDate(after, zone),
  );
  assert.deepEqual(
    await repository.getViewsByDate('a', '2026-11-12', '2026-11-13'),
    [
      { date: '2026-11-12', views: 1 },
      { date: '2026-11-13', views: 1 },
    ],
  );
});

test('database failures return HTTP errors, never a successful empty dashboard', async () => {
  await conn.query(
    'ALTER TABLE views_daily RENAME COLUMN total_views TO unavailable_counter',
  );
  try {
    await get().expect(500);
    await get('/top-products').expect(500);
  } finally {
    await conn.query(
      'ALTER TABLE views_daily RENAME COLUMN unavailable_counter TO total_views',
    );
  }
});
