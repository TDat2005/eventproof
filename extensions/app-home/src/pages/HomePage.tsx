import { useState, useEffect } from "preact/hooks";
import type { Api } from "@shopify/ui-extensions/admin.app.home.render";

declare const shopify: Api;

type Metric = "recent" | "daily" | "order";
type Settings = { [K in `${Metric}Enabled`]: boolean } & {
  [K in `${Metric}Threshold`]: number;
};

const defaults: Settings = {
  recentEnabled: true,
  recentThreshold: 1,
  dailyEnabled: true,
  dailyThreshold: 1,
  orderEnabled: true,
  orderThreshold: 1,
};
const fields: Array<[Metric, string, string]> = [
  [
    "recent",
    "Người xem gần đây",
    "Số trình duyệt có hoạt động trong 5 phút gần nhất.",
  ],
  [
    "daily",
    "Lượt xem hôm nay",
    "Mỗi lần mở hoặc tải lại trang tính một lượt, theo múi giờ shop.",
  ],
  [
    "order",
    "Sản phẩm được đặt trong 24 giờ",
    "Tính số lượng khi đơn được tạo, không tính đơn test. Không điều chỉnh theo các lần sửa hoặc hủy đơn sau đó.",
  ],
];

export default function HomePage() {
  const [settings, setSettings] = useState(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [timezone, setTimezone] = useState("");

  async function api<T = unknown>(
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const token = await shopify.auth.idToken();
    if (!token)
      throw new Error(
        "Không lấy được phiên xác thực Shopify. Vui lòng mở lại ứng dụng.",
      );
    const response = await fetch("/api/admin/" + path, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok)
      throw new Error(
        "Không thể tải hoặc lưu cài đặt (HTTP " + response.status + ").",
      );
    return response.json() as Promise<T>;
  }

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const query = "query EventProofShop { shop { ianaTimezone } }";
        const result = await shopify.query<{ shop: { ianaTimezone: string } }>(
          query,
        );
        const zone = result.data?.shop?.ianaTimezone;
        if (result.errors?.length || !zone)
          throw new Error("Không đọc được múi giờ shop từ Shopify.");
        await api("connection", { timezoneIana: zone });
        const data = await api<Settings>("settings");
        if (active) {
          setTimezone(zone);
          setSettings(data);
        }
      } catch (err) {
        if (active)
          setError(
            err instanceof Error
              ? err.message
              : "Kh?ng th? k?t n?i ??n ?ng d?ng.",
          );
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function save() {
    setSaved(false);
    setError("");
    for (const [name] of fields) {
      const value = settings[`${name}Threshold`];
      if (!Number.isSafeInteger(value) || value < 1 || value > 1000000) {
        setError("Ngưỡng phải là số nguyên từ 1 đến 1.000.000.");
        return;
      }
    }
    setSaving(true);
    try {
      await api("settings", settings);
      setSaved(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Kh?ng th? k?t n?i ??n ?ng d?ng.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <s-page heading="Social Proof & Analytics">
      <s-link href="/analytics">Analytics · Thống kê lượt xem</s-link>
      <s-stack direction="block" gap="base">
        {error && <s-banner tone="critical">{error}</s-banner>}
        {saved && (
          <s-banner tone="success">
            Đã lưu cài đặt. Widget áp dụng trong lần cập nhật tiếp theo.
          </s-banner>
        )}
        {loading && <s-spinner accessibilityLabel="Đang tải cài đặt" />}
        <s-section heading="Cấu hình hiển thị Widget">
          <s-stack direction="block" gap="base">
            {timezone && <s-paragraph>Múi giờ shop: {timezone}</s-paragraph>}
            {fields.map(([name, label, help]) => (
              <s-box
                key={name}
                padding="base"
                border="base"
                borderRadius="base"
              >
                <s-stack direction="block" gap="base">
                  <s-switch
                    label={label}
                    checked={settings[`${name}Enabled`]}
                    disabled={loading || !timezone || saving}
                    onChange={(event) => {
                      setSaved(false);
                      setSettings({
                        ...settings,
                        [`${name}Enabled`]: event.currentTarget.checked,
                      });
                    }}
                  />
                  <s-paragraph>{help}</s-paragraph>
                  <s-number-field
                    label="Ngưỡng hiển thị tối thiểu"
                    min={1}
                    max={1000000}
                    step={1}
                    value={String(settings[`${name}Threshold`])}
                    disabled={loading || !timezone || saving}
                    onChange={(event) => {
                      setSaved(false);
                      setSettings({
                        ...settings,
                        [`${name}Threshold`]: Number(event.currentTarget.value),
                      });
                    }}
                  />
                </s-stack>
              </s-box>
            ))}
            <s-button
              variant="primary"
              disabled={loading || !timezone || saving}
              loading={saving}
              onClick={save}
            >
              Lưu cài đặt
            </s-button>
          </s-stack>
        </s-section>
        <s-section heading="Kích hoạt trên cửa hàng">
          <s-paragraph>
            Vào Online Store → Themes → Customize, mở trang Product, thêm block
            Social Proof Box rồi lưu theme.
          </s-paragraph>
          <s-paragraph>
            Các chỉ số chỉ xuất hiện khi đã bật và đạt ngưỡng. Không có dữ liệu
            thì widget được ẩn.
          </s-paragraph>
        </s-section>
      </s-stack>
    </s-page>
  );
}
