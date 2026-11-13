import { AnalyticsService, analyticsWindow } from './analytics.service.js';
import type { IViewRepository } from '../domain/engagement.ports.js';

describe('30-day analytics calendar', () => {
  it.each([
    ['Asia/Ho_Chi_Minh', '2026-11-12T16:59:59Z', '2026-11-12'],
    ['Asia/Ho_Chi_Minh', '2026-11-12T17:00:00Z', '2026-11-13'],
    ['America/Los_Angeles', '2026-11-13T07:59:59Z', '2026-11-12'],
    ['America/Los_Angeles', '2026-11-13T08:00:00Z', '2026-11-13'],
    ['Asia/Kathmandu', '2026-11-12T18:15:00Z', '2026-11-13'],
    ['America/New_York', '2026-03-09T04:00:00Z', '2026-03-09'],
    ['America/New_York', '2026-11-02T05:00:00Z', '2026-11-02'],
    ['UTC', '2028-03-01T00:00:00Z', '2028-03-01'],
    ['UTC', '2026-01-01T00:00:00Z', '2026-01-01'],
  ])('uses store calendar days: %s at %s', (zone, instant, endDate) => {
    const window = analyticsWindow(zone, new Date(instant));
    expect(window.endDate).toBe(endDate);
    expect(window.dates).toHaveLength(30);
    expect(new Set(window.dates).size).toBe(30);
    expect(window.dates[0]).toBe(window.startDate);
    for (let i = 1; i < 30; i++) {
      expect(
        Date.parse(window.dates[i]) - Date.parse(window.dates[i - 1]),
      ).toBe(86_400_000);
    }
  });
});

describe('AnalyticsService', () => {
  const getViewsByDate = vi.fn();
  const getTopProducts = vi.fn();
  const service = new AnalyticsService({
    getViewsByDate,
    getTopProducts,
  } as unknown as IViewRepository);
  const now = new Date('2026-11-12T17:00:00Z');
  beforeEach(() => {
    getViewsByDate.mockReset().mockResolvedValue([]);
    getTopProducts.mockReset().mockResolvedValue([]);
  });

  it('returns exactly 30 zero days for an empty tenant', async () => {
    const data = await service.dashboard('tenant-a', 'Asia/Ho_Chi_Minh', now);
    expect(data.daily).toHaveLength(30);
    expect(data.daily.every((day) => day.views === 0)).toBe(true);
    expect(data.totalViews).toBe(0);
    expect(data.topProducts).toEqual([]);
    expect(getViewsByDate).toHaveBeenCalledExactlyOnceWith(
      'tenant-a',
      '2026-10-15',
      '2026-11-13',
    );
    expect(getTopProducts).toHaveBeenCalledExactlyOnceWith(
      'tenant-a',
      '2026-10-15',
      '2026-11-13',
    );
  });

  it('fills gaps and sums page views rather than days or unique viewers', async () => {
    getViewsByDate.mockResolvedValue([
      { date: '2026-10-15', views: 3 },
      { date: '2026-11-13', views: 8 },
    ]);
    const data = await service.dashboard('tenant-a', 'Asia/Ho_Chi_Minh', now);
    expect(data.totalViews).toBe(11);
    expect(data.daily[0].views).toBe(3);
    expect(data.daily[1].views).toBe(0);
    expect(data.daily[29].views).toBe(8);
  });

  it('preserves all 30 daily counts', async () => {
    getViewsByDate.mockResolvedValue(
      analyticsWindow('UTC', now).dates.map((date, index) => ({
        date,
        views: index,
      })),
    );
    const data = await service.dashboard('tenant-b', 'UTC', now);
    expect(data.totalViews).toBe(435);
    expect(data.daily.map((day) => day.views)).toEqual(
      Array.from({ length: 30 }, (_, i) => i),
    );
  });

  it('propagates repository errors instead of displaying false zero data', async () => {
    getViewsByDate.mockRejectedValue(new Error('database unavailable'));
    await expect(service.dashboard('tenant-a', 'UTC', now)).rejects.toThrow(
      'database unavailable',
    );
  });

  it('uses the identical window for standalone top products', async () => {
    const data = await service.topProducts('tenant-b', 'Asia/Ho_Chi_Minh', now);
    expect(data).toEqual({
      timezone: 'Asia/Ho_Chi_Minh',
      startDate: '2026-10-15',
      endDate: '2026-11-13',
      topProducts: [],
    });
    expect(getTopProducts).toHaveBeenCalledExactlyOnceWith(
      'tenant-b',
      '2026-10-15',
      '2026-11-13',
    );
    expect(getViewsByDate).not.toHaveBeenCalled();
  });
});
