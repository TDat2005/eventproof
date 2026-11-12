import { createHmac } from 'node:crypto';
import { ShopifyAuthService } from './shopify-auth.service.js';

describe('Shopify request authentication', () => {
  const auth = new ShopifyAuthService();
  const shop = 'review-shop.myshopify.com';
  beforeEach(() => {
    vi.stubEnv('SHOPIFY_API_SECRET', 'test-secret');
    vi.stubEnv('SHOPIFY_API_KEY', 'test-client');
  });
  afterEach(() => vi.unstubAllEnvs());

  function token(extra: Record<string, unknown> = {}, algorithm = 'HS256') {
    const header = Buffer.from(JSON.stringify({ alg: algorithm })).toString(
      'base64url',
    );
    const payload = Buffer.from(
      JSON.stringify({
        dest: `https://${shop}`,
        iss: `https://${shop}/admin`,
        aud: 'test-client',
        exp: Date.now() / 1000 + 60,
        nbf: Date.now() / 1000 - 1,
        ...extra,
      }),
    ).toString('base64url');
    return `Bearer ${header}.${payload}.${createHmac('sha256', 'test-secret').update(`${header}.${payload}`).digest('base64url')}`;
  }

  it('validates the raw webhook bytes and rejects a changed payload or missing signature', () => {
    const body = Buffer.from('{"id":123}');
    const signature = createHmac('sha256', 'test-secret')
      .update(body)
      .digest('base64');
    expect(() => auth.verifyWebhook(body, signature)).not.toThrow();
    expect(() =>
      auth.verifyWebhook(Buffer.from('{"id":124}'), signature),
    ).toThrow('Invalid webhook signature');
    expect(() => auth.verifyWebhook(body, undefined)).toThrow(
      'Missing webhook signature',
    );
  });

  it('accepts only a fresh signed proxy query and rejects shop substitution', () => {
    const query = {
      shop,
      timestamp: String(Math.floor(Date.now() / 1000)),
      extra: ['a', 'b'],
    };
    const sign = (q: Record<string, unknown>) =>
      createHmac('sha256', 'test-secret')
        .update(
          Object.keys(q)
            .sort()
            .map(
              (key) =>
                `${key}=${Array.isArray(q[key]) ? (q[key] as string[]).join(',') : String(q[key])}`,
            )
            .join(''),
        )
        .digest('hex');
    expect(auth.verifyProxy({ ...query, signature: sign(query) })).toBe(shop);
    expect(() =>
      auth.verifyProxy({
        ...query,
        shop: 'other.myshopify.com',
        signature: sign(query),
      }),
    ).toThrow();
    const old = { ...query, timestamp: '1' };
    expect(() => auth.verifyProxy({ ...old, signature: sign(old) })).toThrow(
      'Expired proxy request',
    );
  });

  it('derives the admin tenant from a verified ID token', () =>
    expect(auth.verifyAdmin(token())).toBe(shop));
  it.each([
    { aud: 'different-client' },
    { exp: 1 },
    { nbf: Date.now() / 1000 + 3600 },
    { iss: 'https://other.myshopify.com/admin' },
    { dest: 'https://attacker.example' },
  ])('rejects invalid ID token claims %j', (claims) =>
    expect(() => auth.verifyAdmin(token(claims))).toThrow(),
  );
  it('rejects algorithm substitution and anonymous admin access', () => {
    expect(() => auth.verifyAdmin(token({}, 'none'))).toThrow();
    expect(() => auth.verifyAdmin(undefined)).toThrow();
  });
});
