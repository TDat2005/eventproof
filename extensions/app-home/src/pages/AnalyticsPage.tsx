import { useEffect, useState } from "preact/hooks";
import type { Api } from "@shopify/ui-extensions/admin.app.home.render";

declare const shopify: Api;

export type Dashboard = {
  timezone: string;
  startDate: string;
  endDate: string;
  totalViews: number;
  daily: Array<{ date: string; views: number }>;
  topProducts: Array<{
    productId: string;
    title: string | null;
    views: number;
  }>;
};

export async function loadAnalytics(): Promise<Dashboard> {
  const token = await shopify.auth.idToken();
  if (!token)
    throw new Error("Phiên Shopify đã hết hạn. Vui lòng mở lại ứng dụng.");
  const response = await fetch("/api/admin/analytics", {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) {
    if (response.status === 401)
      throw new Error("Phiên Shopify đã hết hạn. Vui lòng mở lại ứng dụng.");
    if (response.status === 403)
      throw new Error(
        "Shop chưa kết nối. Vui lòng mở trang cài đặt để kết nối.",
      );
    throw new Error(
      `Không thể tải Analytics (HTTP ${response.status}). Vui lòng thử lại.`,
    );
  }
  return response.json();
}

export default function AnalyticsPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setData(null);
    loadAnalytics()
      .then((result) => {
        if (active) setData(result);
      })
      .catch((err) => {
        if (active)
          setError(
            err instanceof Error
              ? err.message
              : "Không thể kết nối. Vui lòng thử lại.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  const maximum = Math.max(1, ...(data?.daily.map((day) => day.views) ?? []));
  return (
    <s-page heading="Analytics">
      <s-link href="/">Cài đặt Social Proof</s-link>
      <s-stack direction="block" gap="base">
        <s-button disabled={loading} onClick={() => setAttempt(attempt + 1)}>
          Làm mới
        </s-button>
        {loading && (
          <s-spinner accessibilityLabel="Đang tải thống kê 30 ngày" />
        )}
        {error && (
          <s-banner heading="Không thể tải Analytics" tone="critical">
            {error}
          </s-banner>
        )}
        {data && (
          <>
            <s-section heading="Tổng lượt xem 30 ngày">
              <s-heading>{data.totalViews.toLocaleString("vi-VN")}</s-heading>
              <s-paragraph>
                {data.startDate} – {data.endDate} · {data.timezone} · Bao gồm
                hôm nay (chưa kết thúc).
              </s-paragraph>
              <s-paragraph>
                Mỗi lần mở hoặc tải lại trang sản phẩm là một lượt xem, không
                phải người xem duy nhất. Các ngày được ghi theo múi giờ shop tại
                thời điểm nhận sự kiện.
              </s-paragraph>
            </s-section>
            {data.totalViews === 0 && (
              <s-banner heading="Chưa có lượt xem trong 30 ngày" tone="info">
                Lượt xem sẽ xuất hiện khi khách truy cập trang sản phẩm có bật
                theo dõi Social Proof.
              </s-banner>
            )}
            <s-section heading="Lượt xem theo ngày">
              <div
                role="region"
                aria-label="Biểu đồ lượt xem; cuộn ngang trên màn hình nhỏ"
                tabIndex={0}
                style={{ overflowX: "auto", maxWidth: "100%" }}
              >
                <svg
                  viewBox="0 0 720 240"
                  role="img"
                  aria-labelledby="views-chart-title views-chart-description"
                  style={{
                    width: "100%",
                    minWidth: "600px",
                    height: "auto",
                    display: "block",
                  }}
                >
                  <title id="views-chart-title">
                    Lượt xem sản phẩm trong 30 ngày
                  </title>
                  <desc id="views-chart-description">
                    {data.daily
                      .map((day) => `${day.date}: ${day.views}`)
                      .join("; ")}
                  </desc>
                  <text x="0" y="18" font-size="12" fill="currentColor">
                    {maximum.toLocaleString("vi-VN")}
                  </text>
                  <line
                    x1="45"
                    y1="200"
                    x2="715"
                    y2="200"
                    stroke="currentColor"
                  />
                  {data.daily.map((day, index) => {
                    const height = (day.views / maximum) * 170;
                    return (
                      <rect
                        key={day.date}
                        x={50 + index * 22}
                        y={200 - height}
                        width="16"
                        height={height}
                        fill="#008060"
                      >
                        <title>
                          {day.date}: {day.views.toLocaleString("vi-VN")} lượt
                          xem
                        </title>
                      </rect>
                    );
                  })}
                  <text x="45" y="225" font-size="12" fill="currentColor">
                    {data.startDate}
                  </text>
                  <text
                    x="710"
                    y="225"
                    text-anchor="end"
                    font-size="12"
                    fill="currentColor"
                  >
                    {data.endDate}
                  </text>
                  <text x="25" y="204" font-size="12" fill="currentColor">
                    0
                  </text>
                </svg>
              </div>
            </s-section>
            <s-section heading="Top 10 sản phẩm được xem nhiều nhất">
              {data.topProducts.length === 0 ? (
                <s-paragraph>
                  Chưa có sản phẩm được xem trong khoảng này.
                </s-paragraph>
              ) : (
                <s-table>
                  <s-table-header-row>
                    <s-table-header listSlot="secondary">Hạng</s-table-header>
                    <s-table-header listSlot="primary">Sản phẩm</s-table-header>
                    <s-table-header listSlot="labeled" format="numeric">
                      Lượt xem
                    </s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {data.topProducts.map((product, index) => (
                      <s-table-row key={product.productId}>
                        <s-table-cell>{index + 1}</s-table-cell>
                        <s-table-cell>
                          {product.title || `Sản phẩm ${product.productId}`}
                        </s-table-cell>
                        <s-table-cell>
                          {product.views.toLocaleString("vi-VN")}
                        </s-table-cell>
                      </s-table-row>
                    ))}
                  </s-table-body>
                </s-table>
              )}
            </s-section>
          </>
        )}
      </s-stack>
    </s-page>
  );
}
