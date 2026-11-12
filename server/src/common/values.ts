import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';

export function internalId(kind: string, ...parts: string[]): string {
  return `${kind}_${createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 48)}`;
}

export function textValue(value: unknown, name: string, max = 128): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new BadRequestException(`Invalid ${name}`);
  }
  return value.trim();
}

export function shopDomain(value: unknown): string {
  const shop = textValue(value, 'shop', 255).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
    throw new BadRequestException('Invalid Shopify domain');
  }
  return shop;
}

export function productId(value: unknown): string {
  const id = textValue(value, 'productId', 128).replace(
    /^gid:\/\/shopify\/Product\//,
    '',
  );
  if (!/^[1-9]\d{0,19}$/.test(id))
    throw new BadRequestException('Invalid productId');
  return id;
}

export function timezoneValue(value: unknown): string {
  const zone = textValue(value, 'timezoneIana', 64);
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone }).format();
  } catch {
    throw new BadRequestException('Invalid timezoneIana');
  }
  return zone;
}

export function localDate(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function eventDate(value: unknown): Date {
  const date = new Date(textValue(value, 'occurredAt', 40));
  const age = Date.now() - date.getTime();
  if (!Number.isFinite(age) || age < -300_000 || age > 48 * 3600_000) {
    throw new BadRequestException('Event timestamp outside accepted window');
  }
  return date;
}
