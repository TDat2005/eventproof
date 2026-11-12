(function () {
  const script = document.currentScript;
  const blockId = script.dataset.blockId;
  const productId = script.dataset.productId;
  const shop = script.dataset.shop;
  if (!productId || !shop) return;
  const byId = (name) => document.getElementById(name + "-" + blockId);
  const trigger = byId("sp-side-trigger");
  const panel = byId("sp-side-panel");
  const container = byId("sp-widget");
  const close = () => {
    panel?.classList.remove("active");
    if (panel) panel.inert = true;
    trigger?.setAttribute("aria-expanded", "false");
  };
  trigger?.addEventListener("click", (event) => {
    event.stopPropagation();
    const open = panel?.classList.toggle("active");
    if (panel) panel.inert = !open;
    trigger?.setAttribute("aria-expanded", String(Boolean(open)));
  });
  byId("sp-panel-close")?.addEventListener("click", close);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && panel?.classList.contains("active")) {
      close();
      trigger?.focus();
    }
  });
  document.addEventListener("click", (event) => {
    if (!panel?.contains(event.target) && !trigger?.contains(event.target))
      close();
  });

  // Shared by every block on this page, including inline + floating widgets.
  const state = window.__eventProof || (window.__eventProof = { pages: {} });
  if (!state.clientId) {
    let stored;
    try {
      stored = localStorage.getItem("sp_client_id");
    } catch (_) {
      /* Storage can be disabled. */
    }
    state.clientId = stored || "c_" + crypto.randomUUID();
    try {
      localStorage.setItem("sp_client_id", state.clientId);
    } catch (_) {
      /* Use the page-scoped fallback. */
    }
  }
  const key = shop + ":" + productId;
  const page =
    state.pages[key] ||
    (state.pages[key] = {
      eventId: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      recorded: false,
      pending: null,
    });
  const base = (window.Shopify?.routes?.root || "/") + "apps/social-proof/";
  let interval;
  let running = false;
  let disposed = false;

  async function request(path, body) {
    const response = await fetch(
      base + path,
      body
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            keepalive: true,
          }
        : { cache: "no-store" },
    );
    if (!response.ok) throw new Error("HTTP " + response.status);
    return response.json();
  }

  function publish(name, data) {
    // The optional pixel relays the exact same identities; retries deduplicate.
    try {
      window.Shopify?.analytics?.publish(name, data)?.catch?.(() => {});
    } catch (_) {
      /* Optional pixel. */
    }
  }

  function showRow(name, count, visible) {
    const row = byId(name);
    const countNode = byId(name + "-count");
    if (row) row.style.display = visible ? "flex" : "none";
    if (countNode) countNode.textContent = String(count);
  }

  function render(data) {
    const display = data.display || {};
    const recent = Number(data.recentViewers) || 0;
    const daily = Number(data.viewsToday) || 0;
    const orders = Number(data.ordersLast24h) || 0;
    showRow("sp-recent", recent, display.showRecent);
    showRow("sp-side-recent", recent, display.showRecent);
    showRow("sp-daily", daily, display.showDaily);
    showRow("sp-side-daily", daily, display.showDaily);
    showRow("sp-orders", orders, display.showOrders);
    showRow("sp-side-orders", orders, display.showOrders);
    const visible = Boolean(
      display.showRecent || display.showDaily || display.showOrders,
    );
    if (container) container.style.display = visible ? "block" : "none";
    if (trigger) trigger.style.display = visible ? "flex" : "none";
    // Show a neutral activity dot when only daily/sales proof qualifies.
    const badge = byId("sp-side-count");
    if (badge) {
      badge.textContent = String(recent);
      badge.style.display = display.showRecent ? "" : "none";
    }
    if (!visible) close();
  }

  async function sync() {
    if (running || disposed || document.hidden) return;
    const privacy = window.Shopify?.customerPrivacy;
    if (
      privacy?.analyticsProcessingAllowed &&
      !privacy.analyticsProcessingAllowed()
    ) {
      render({});
      return;
    }
    running = true;
    try {
      if (!page.recorded) {
        if (!page.pending) {
          const event = {
            productId,
            eventId: page.eventId,
            occurredAt: page.occurredAt,
            clientId: state.clientId,
          };
          page.pending = request("events/view", event)
            .then(() => {
              page.recorded = true;
              publish("sp:view", event);
            })
            .finally(() => {
              page.pending = null;
            });
        }
        await page.pending;
      }
      await request("events/heartbeat", {
        productId,
        clientId: state.clientId,
      });
      const data = await request("metrics/" + encodeURIComponent(productId));
      if (!disposed) render(data);
    } catch (error) {
      render({});
      console.warn("[EventProof] Could not refresh metrics:", error.message);
    } finally {
      running = false;
    }
  }

  function start() {
    if (disposed || document.hidden) return;
    sync();
    if (!interval) interval = setInterval(sync, 10000);
  }
  function stop() {
    clearInterval(interval);
    interval = null;
  }
  const onVisibility = () => (document.hidden ? stop() : start());
  document.addEventListener("visibilitychange", onVisibility);
  document.addEventListener("visitorConsentCollected", sync);
  document.addEventListener("shopify:section:unload", (event) => {
    if (event.target.contains(script)) {
      disposed = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("visitorConsentCollected", sync);
    }
  });
  render({});
  start();
})();
