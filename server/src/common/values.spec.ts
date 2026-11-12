import { internalId, localDate, productId, eventDate } from './values.js';

describe('Core value boundaries', () => {
  it('uses shop-local dates across UTC midnight and DST transitions', () => {
    expect(
      localDate(new Date('2026-11-11T17:00:00Z'), 'Asia/Ho_Chi_Minh'),
    ).toBe('2026-11-12');
    expect(
      localDate(new Date('2026-11-12T06:59:59Z'), 'America/Los_Angeles'),
    ).toBe('2026-11-11');
    expect(
      localDate(new Date('2026-03-08T10:00:00Z'), 'America/Los_Angeles'),
    ).toBe('2026-03-08');
  });
  it('bounds internal identifiers independently of domain and external ID lengths', () => {
    expect(
      internalId('line', 'x'.repeat(255), 'y'.repeat(128)).length,
    ).toBeLessThanOrEqual(64);
    expect(internalId('prod', 'a', 'b')).not.toBe(internalId('prod', 'ab', ''));
  });
  it('normalizes only valid Shopify product IDs', () => {
    expect(productId('gid://shopify/Product/123')).toBe('123');
    expect(() => productId('gid://shopify/ProductVariant/123')).toThrow();
    expect(() => productId('fake123')).toThrow();
  });
  it('rejects invalid and future view timestamps', () => {
    expect(() => eventDate('invalid')).toThrow();
    expect(() =>
      eventDate(new Date(Date.now() + 3600_000).toISOString()),
    ).toThrow();
  });
});
