import { Inject, Injectable } from '@nestjs/common';
import { localDate } from '../../../common/values.js';
import { VIEW_REPOSITORY } from '../domain/engagement.ports.js';
import type { IViewRepository } from '../domain/engagement.ports.js';

// Calendar arithmetic on date labels, not elapsed milliseconds in the shop's zone.
export function analyticsWindow(timezone: string, now = new Date()) {
  const endDate = localDate(now, timezone);
  const end = new Date(`${endDate}T00:00:00Z`);
  const dates = Array.from({ length: 30 }, (_, index) => {
    const day = new Date(end);
    day.setUTCDate(day.getUTCDate() - 29 + index);
    return day.toISOString().slice(0, 10);
  });
  return { timezone, startDate: dates[0], endDate, dates };
}

@Injectable()
export class AnalyticsService {
  constructor(
    @Inject(VIEW_REPOSITORY) private readonly views: IViewRepository,
  ) {}

  async dashboard(tenantId: string, timezone: string, now = new Date()) {
    const { dates, ...window } = analyticsWindow(timezone, now);
    const [rows, topProducts] = await Promise.all([
      this.views.getViewsByDate(tenantId, window.startDate, window.endDate),
      this.views.getTopProducts(tenantId, window.startDate, window.endDate),
    ]);
    const counts = new Map(rows.map((row) => [row.date, row.views]));
    const daily = dates.map((date) => ({ date, views: counts.get(date) ?? 0 }));
    return {
      ...window,
      totalViews: daily.reduce((total, day) => total + day.views, 0),
      daily,
      topProducts,
    };
  }

  async topProducts(tenantId: string, timezone: string, now = new Date()) {
    const { dates: _dates, ...window } = analyticsWindow(timezone, now);
    return {
      ...window,
      topProducts: await this.views.getTopProducts(
        tenantId,
        window.startDate,
        window.endDate,
      ),
    };
  }
}
