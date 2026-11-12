import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(
  new URL(
    '../../extensions/social-proof-widget/assets/social-proof.js',
    import.meta.url,
  ),
  'utf8',
);
const drain = () => new Promise<void>((resolve) => setImmediate(resolve));

function browser(
  options: {
    failView?: boolean;
    storageDenied?: boolean;
    metrics?: Record<string, unknown>;
  } = {},
) {
  const nodes = new Map<string, any>();
  const events: Record<string, () => void> = {};
  const timers: Array<() => void> = [];
  let serial = 0;
  let failView = options.failView;
  const document = {
    currentScript: {
      dataset: { blockId: 'one', productId: '123', shop: 'shop.myshopify.com' },
    },
    hidden: false,
    getElementById(id: string) {
      if (!nodes.has(id))
        nodes.set(id, {
          style: {},
          textContent: '',
          classList: { remove: vi.fn(), toggle: vi.fn() },
          addEventListener: vi.fn(),
          setAttribute: vi.fn(),
          contains: () => false,
        });
      return nodes.get(id);
    },
    addEventListener(name: string, callback: () => void) {
      events[name] = callback;
    },
    removeEventListener: vi.fn(),
  };
  const fetch = vi.fn(async (url: string) => {
    if (url.endsWith('events/view') && failView) {
      failView = false;
      throw new Error('network');
    }
    return {
      ok: true,
      json: async () =>
        url.includes('metrics/')
          ? options.metrics || {
              recentViewers: 0,
              viewsToday: 0,
              ordersLast24h: 3,
              display: {
                showRecent: false,
                showDaily: false,
                showOrders: false,
              },
            }
          : { isNew: true },
    };
  });
  const context = {
    document,
    window: { Shopify: { routes: { root: '/' } } },
    fetch,
    localStorage: {
      getItem: () => {
        if (options.storageDenied) throw new Error('denied');
        return null;
      },
      setItem: () => {
        if (options.storageDenied) throw new Error('denied');
      },
    },
    crypto: { randomUUID: () => `uuid-${++serial}` },
    console: { warn: vi.fn() },
    setInterval: (fn: () => void) => {
      timers.push(fn);
      return timers.length;
    },
    clearInterval: vi.fn(),
  };
  runInNewContext(source, context);
  return { context, fetch, nodes, events, timers, document };
}

describe('Storefront widget behavior', () => {
  it('records one page view while each refresh only heartbeats and reads metrics', async () => {
    const page = browser();
    await drain();
    page.timers[0]();
    await drain();
    const urls = page.fetch.mock.calls.map(([url]) => url);
    expect(urls.filter((url) => url.endsWith('events/view'))).toHaveLength(1);
    expect(urls.filter((url) => url.endsWith('events/heartbeat'))).toHaveLength(
      2,
    );
    expect(urls.filter((url) => url.includes('metrics/'))).toHaveLength(2);
  });

  it('renders real zeros and hides rows and floating tab when thresholds are not met', async () => {
    const page = browser();
    await drain();
    expect(page.nodes.get('sp-recent-count-one').textContent).toBe('0');
    expect(page.nodes.get('sp-daily-count-one').textContent).toBe('0');
    expect(page.nodes.get('sp-orders-one').style.display).toBe('none');
    expect(page.nodes.get('sp-widget-one').style.display).toBe('none');
    expect(page.nodes.get('sp-side-trigger-one').style.display).toBe('none');
  });

  it('shows only enabled qualifying rows', async () => {
    const page = browser({
      metrics: {
        recentViewers: 2,
        viewsToday: 10,
        ordersLast24h: 3,
        display: { showRecent: false, showDaily: true, showOrders: false },
      },
    });
    await drain();
    expect(page.nodes.get('sp-daily-one').style.display).toBe('flex');
    expect(page.nodes.get('sp-recent-one').style.display).toBe('none');
    expect(page.nodes.get('sp-widget-one').style.display).toBe('block');
    expect(page.nodes.get('sp-side-count-one').style.display).toBe('none');
  });

  it('retries a failed view with the same event ID and tolerates denied localStorage', async () => {
    const page = browser({ failView: true, storageDenied: true });
    await drain();
    page.timers[0]();
    await drain();
    const calls = page.fetch.mock.calls as unknown as Array<
      [string, { body: string }]
    >;
    const views = calls
      .filter(([url]) => url.endsWith('events/view'))
      .map(([, init]) => JSON.parse(init.body));
    expect(views).toHaveLength(2);
    expect(views[0].eventId).toBe(views[1].eventId);
  });

  it('shares a page-view event across multiple blocks', async () => {
    const page = browser();
    page.document.currentScript = {
      dataset: { blockId: 'two', productId: '123', shop: 'shop.myshopify.com' },
    };
    runInNewContext(source, page.context);
    await drain();
    expect(
      page.fetch.mock.calls.filter(([url]) => url.endsWith('events/view')),
    ).toHaveLength(1);
  });
});
