import { loadAnalytics } from "../src/pages/AnalyticsPage";

describe("Analytics authenticated API client", () => {
  const idToken = vi.fn();
  const fetchMock = vi.fn();
  beforeEach(() => {
    idToken.mockReset().mockResolvedValue("fresh-shopify-token");
    fetchMock.mockReset();
    vi.stubGlobal("shopify", { auth: { idToken } });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("loads real API data with a fresh token on each refresh and disables cache", async () => {
    const payload = {
      totalViews: 7,
      daily: [{ date: "2026-11-13", views: 7 }],
      topProducts: [],
    };
    fetchMock.mockResolvedValue({ ok: true, json: async () => payload });
    expect(await loadAnalytics()).toEqual(payload);
    expect(await loadAnalytics()).toEqual(payload);
    expect(idToken).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/analytics", {
      headers: { Authorization: "Bearer fresh-shopify-token" },
      cache: "no-store",
    });
  });

  it("preserves an empty successful response as zero, without substituting demo data", async () => {
    const payload = { totalViews: 0, daily: [], topProducts: [] };
    fetchMock.mockResolvedValue({ ok: true, json: async () => payload });
    expect(await loadAnalytics()).toEqual(payload);
  });

  it("rejects missing authentication before sending a request", async () => {
    idToken.mockResolvedValue(null);
    await expect(loadAnalytics()).rejects.toThrow("Phiên Shopify");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [401, "Phiên Shopify"],
    [403, "Shop chưa kết nối"],
    [500, "HTTP 500"],
    [429, "HTTP 429"],
  ])(
    "reports HTTP %s without treating it as empty analytics",
    async (status, message) => {
      fetchMock.mockResolvedValue({ ok: false, status });
      await expect(loadAnalytics()).rejects.toThrow(message);
    },
  );

  it("propagates network and malformed response errors", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network failure"));
    await expect(loadAnalytics()).rejects.toThrow("network failure");
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => {
        throw new Error("invalid JSON");
      },
    });
    await expect(loadAnalytics()).rejects.toThrow("invalid JSON");
  });
});
