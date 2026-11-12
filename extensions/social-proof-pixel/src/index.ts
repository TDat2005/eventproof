import { register } from "@shopify/web-pixels-extension";

// The theme creates one page-view ID and one browser ID. Never independently
// ingest product_viewed here: that would count the same visit a second time.
register(({ analytics, init }) => {
  analytics.subscribe("sp:view", async (event) => {
    const data = event.customData as {
      productId?: string;
      eventId?: string;
      occurredAt?: string;
    };
    if (!data?.productId || !data.eventId || !data.occurredAt) return;
    try {
      const response = await fetch(
        `https://${init.data.shop.myshopifyDomain}/apps/social-proof/events/view`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productId: data.productId,
            eventId: data.eventId,
            occurredAt: data.occurredAt,
          }),
          keepalive: true,
        },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      console.warn("[EventProof Pixel] View relay failed:", error);
    }
  });
});
