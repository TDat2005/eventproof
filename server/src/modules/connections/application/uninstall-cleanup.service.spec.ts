import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  retentionDays,
  UninstallCleanupJob,
} from './uninstall-cleanup.service.js';

describe('uninstall retention configuration', () => {
  it('defaults to 30 days and allows an explicit zero for dev', () => {
    expect(retentionDays('30')).toBe(30);
    expect(retentionDays('0')).toBe(0);
    const previous = process.env.UNINSTALL_RETENTION_DAYS;
    delete process.env.UNINSTALL_RETENTION_DAYS;
    expect(retentionDays()).toBe(30);
    if (previous !== undefined) process.env.UNINSTALL_RETENTION_DAYS = previous;
  });
  it.each(['', '-1', 'NaN', '1.5', 'Infinity', '36501', ' 30', '3days'])(
    'rejects unsafe retention %s',
    (value) => expect(() => retentionDays(value)).toThrow(),
  );
});

describe('daily cleanup lifecycle', () => {
  afterEach(() => vi.useRealTimers());
  it('catches up on boot, avoids overlapping runs, and stops on shutdown', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const run = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const job = new UninstallCleanupJob({ run } as any);
    job.onModuleInit();
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2 * 86400000);
    expect(run).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(86400000);
    expect(run).toHaveBeenCalledTimes(2);
    await job.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(86400000);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
