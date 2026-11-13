# F6 – Analytics Dashboard

Trang `/analytics` trong App Home có tổng lượt xem, biểu đồ cột 30 ngày, bảng Top 10, nút làm mới, trạng thái tải/trống/lỗi và liên kết về cài đặt. Biểu đồ cuộn ngang trên màn hình nhỏ để giữ nhãn đọc được; bảng dùng responsive Polaris Table. Không thêm thư viện chart hay scope Shopify.

## Dữ liệu và khoảng thời gian

- Nguồn: `views_daily.total_views`. Một event view mới tăng counter một lần; gửi lại cùng event không tăng. Reload/mở tab mới là lượt xem mới. Đây là **page views của trang sản phẩm có tracking**, không phải unique viewers, lượt hiển thị widget hay tất cả page views của cửa hàng. Heartbeat/Redis presence không tham gia Analytics.
- 30 ngày lịch gồm hôm nay và 29 ngày trước, theo `store_connections.timezone_iana`. Hôm nay chưa kết thúc. Không dùng cửa sổ 720 giờ hoặc ngày UTC của server. Backend cố định thời điểm một lần cho mỗi response; ngày bắt đầu/kết thúc được dùng chung cho daily và Top 10.
- `ViewTrackerService` đang tính ngày từ `occurredAt` theo timezone của connection khi tiếp nhận event. F6 đọc nguyên các bucket này, không thay đổi ingest F1–F5. Khoảng ngày là hai đầu inclusive; calendar arithmetic không lệch khi DST, qua tháng/năm hoặc năm nhuận.
- **Giới hạn lịch sử khi đổi timezone:** `views_daily` không lưu timezone của bucket, nên số cũ giữ ngày đã ghi; không thể quy đổi chính xác toàn bộ lịch sử sang timezone mới chỉ bằng counter daily/hourly, nhất là múi giờ lệch 30/45 phút. F6 không tự suy đoán/backfill. Timezone hiện tại chọn cửa sổ ngày, còn các bucket giữ quy ước lúc ghi. UI cũng nêu quy ước này. Muốn tái phân nhóm lịch sử cần thiết kế riêng việc lưu/giữ raw events và backfill; không nằm trong thay đổi này.
- Product title lấy từ catalog nội bộ `products`, có thể là tên dự phòng `Product <externalId>` do ingest hiện tại tạo. Không gọi Admin API mỗi dòng để lấy tên. Product thiếu title hoặc thiếu catalog vẫn giữ số view và hiển thị ID dự phòng. F6 không thêm đồng bộ tên catalog.

## API

Cả hai endpoint yêu cầu `Authorization: Bearer <Shopify ID token>`. `ShopifyAuthService.verifyAdmin` xác thực chữ ký, audience, issuer/destination và thời hạn token như settings hiện tại. Tenant lấy từ shop trong token và active connection; query/body không chọn được tenant/timezone. Không tạo hoặc kích hoạt connection khi đọc Analytics. Response có `Cache-Control: no-store`.

| Endpoint | Response |
| --- | --- |
| `GET /api/admin/analytics` | `{ timezone, startDate, endDate, totalViews, daily: [{ date, views }], topProducts: [{ productId, title, views }] }` |
| `GET /api/admin/analytics/top-products` | `{ timezone, startDate, endDate, topProducts: [{ productId, title, views }] }` |

`daily` luôn đủ 30 ngày, tăng dần theo ngày, ngày thiếu là 0. `totalViews` bằng tổng `daily[].views`. `topProducts` tối đa 10 sản phẩm có tổng lớn hơn 0, giảm dần theo views; bằng điểm thì tăng dần theo internal product ID. ID trả về là ID nội bộ, không phải Shopify GID. Khoảng thời gian của hai endpoint được tính tại từng request; Dashboard gọi endpoint tổng hợp để hai phần luôn dùng cùng cửa sổ.

HTTP 401: token thiếu/sai/hết hạn. HTTP 403: connection không tồn tại hoặc inactive. Lỗi DB trả 500 qua Nest, không chuyển thành số 0. Frontend nêu lỗi và cho phép thử lại, lấy token mới mỗi lần, loại kết quả request cũ khi unmount; không hiển thị số liệu cũ như kết quả làm mới thành công.

## Truy vấn và migration

Tái sử dụng `IViewRepository`/`DrizzleViewRepository`: một truy vấn `SUM/GROUP BY date`, một truy vấn `SUM/GROUP BY product` và `LEFT JOIN products` có điều kiện tenant, `ORDER BY ... LIMIT 10`. Điều kiện tenant và date được áp dụng trước aggregate. Không N+1, không đọc raw events hoặc toàn bộ từng dòng daily về Node. Bù ngày trống tại application service. Không thêm module/repository abstraction riêng.

Index mới: `idx_views_daily_tenant_date (tenant_id, date)`. Primary key cũ `(tenant_id, product_id, date)` vẫn phục vụ widget; index mới phục vụ range scan 30 ngày xuyên tất cả sản phẩm của một tenant. MySQL có thể chọn full scan cho bảng fixture nhỏ; đánh giá `EXPLAIN` với phân bố dữ liệu production trước khi cân nhắc covering index lớn hơn.

`DbService` tự thêm index nếu thiếu khi startup, có MySQL advisory lock để tránh nhiều replica tạo cùng lúc. Không sửa dữ liệu. File SQL tương đương: `server/migrations/20261113_f6_analytics.sql`; chỉ chạy một lần nếu index chưa tồn tại, hoặc để startup xử lý. Không chạy lại file SQL sau khi startup đã tạo index. Với bảng lớn nên lên lịch DDL trước deploy. Không sửa migration F1.

Hai truy vấn aggregate cùng cửa sổ ngày nhưng không giữ snapshot transaction chung: lượt xem đến đồng thời giữa hai truy vấn có thể khiến Top 10 và tổng lệch tạm thời; lần làm mới sau đọc dữ liệu mới. Không khóa ingest để hiển thị Dashboard.

## Kiểm thử tự động

Từ root repo:

```powershell
pnpm --filter server typecheck
node server/node_modules/typescript/bin/tsc --noEmit -p extensions/app-home/tsconfig.json
pnpm --filter server test
pnpm --filter server test:frontend
pnpm --filter server test:f6
pnpm --filter server test:integration
pnpm build
```

F6 integration cần MySQL local cấu hình bằng các biến `DATABASE_*` của backend và các bảng đã khởi tạo. Chỉ dùng temporary tables trên connection riêng để shadow bảng merchant, không ghi fixture vào bảng thật. Không cần Redis cho suite F6; core integration cần Redis. F1 integration riêng cần schema test `f1_test_*` theo `docs/f1-uninstall-cleanup.md`.

Đã qua: 45 backend unit tests (14 cho F6), 8 frontend API-client tests, 7 F6 MySQL/HTTP tests, 11 core integration tests và 9 F1 integration tests trên schema test. Các kiểm thử F6 bao gồm trống/đủ 30 ngày/ngày 0, tổng và order Top 10, ties, catalog thiếu/sai tenant, query injection, token thiếu/sai/hết hạn, inactive connection, DB failure, event dedup, trước/sau nửa đêm, múi giờ âm/dương/lệch 45 phút, DST, năm nhuận và qua năm. Backend/frontend typecheck, backend build, Shopify app build và Shopify Toolkit validation cho Polaris cùng query timezone hiện có đều qua.

## Thử trên dev store

1. Chạy MySQL/Redis và `pnpm dev` theo hướng dẫn core. Mở ứng dụng qua Shopify Admin, chờ trang cài đặt đọc timezone từ Shopify Admin API và kết nối thành công. Vào **Analytics · Thống kê lượt xem**.
2. Shop chưa có view: tổng bằng 0, đủ cửa sổ 30 ngày, biểu đồ trống và thông báo chưa có dữ liệu. Kiểm tra response `/api/admin/analytics` trong DevTools: 30 phần tử daily, mỗi ngày 0, Top 10 rỗng. Không chia sẻ token trong ảnh/log.
3. Bật block Social Proof trên product template, lưu theme. Mở trang sản phẩm thực tế ngoài theme editor, chấp nhận analytics consent nếu store yêu cầu. Mở/reload vài lần rồi quay lại Analytics và bấm **Làm mới**. Tổng tăng và cột hôm nay tăng theo timezone shop; chỉ chờ heartbeat không tăng view. Lặp lại trên sản phẩm khác để kiểm tra thứ tự bảng.
4. Thử nhiều sản phẩm với số lượt khác nhau; bảng tối đa 10, giảm dần. Tên có thể là tên fallback của catalog hiện tại. Đối chiếu `SUM(total_views)` trong DB theo tenant và hai ngày response; không dùng COUNT rows làm page views. Các ngày lịch sử/ngày 0 và boundary được phủ bằng fixture tự động, không sửa dữ liệu merchant để giả lập.
5. Đối chiếu timezone hiển thị với Settings → General của shop. Thử gần nửa đêm shop, quan sát cột đúng ngày. Nếu đổi timezone shop, đợi webhook `shop/update` hoặc mở lại trang cài đặt; bucket cũ giữ ngày đã ghi như giới hạn trên.
6. Mở shop thứ hai trong đúng phiên Admin của shop đó: số liệu chỉ thuộc shop thứ hai. Request thiếu token phải 401; query `tenantId`/`shop` không thay đổi tenant. Uninstall/inactive phải 403.
7. DevTools chặn request Analytics rồi bấm làm mới: hiện lỗi, không thay bằng 0. Bỏ chặn và thử lại: loading rồi hiển thị dữ liệu. Thu nhỏ viewport, kiểm tra bảng responsive, cuộn chart và điều hướng bằng bàn phím.

Chưa xác nhận trực tiếp trong lần triển khai này: hiển thị thực tế trong iframe Shopify Admin trên dev store, tracking/consent và webhook timezone delivery thật, hiệu năng trên dữ liệu production. Build/typecheck và tests local không thay thế các bước này.

## File thuộc thay đổi F6

- `server/src/modules/engagement/domain/engagement.ports.ts`
- `server/src/modules/engagement/infrastructure/drizzle-view.repository.ts`
- `server/src/modules/engagement/application/analytics.service.ts`
- `server/src/modules/engagement/application/analytics.service.spec.ts`
- `server/src/modules/engagement/presentation/analytics.controller.ts`
- `server/src/modules/engagement/engagement.module.ts`
- `server/src/db/schema.ts`
- `server/src/db/db.service.ts`
- `server/migrations/20261113_f6_analytics.sql`
- `server/test/f6.integration.mjs`
- `server/vitest.frontend.config.ts`
- `server/package.json` (scripts F6/frontend)
- `extensions/app-home/src/pages/AnalyticsPage.tsx`
- `extensions/app-home/src/pages/HomePage.tsx` (chỉ thêm link Analytics)
- `extensions/app-home/src/AppHome.jsx`
- `extensions/app-home/shopify.d.ts` (Shopify build sinh khai báo trang mới)
- `extensions/app-home/tests/analytics.spec.ts`
- `README.md` và `docs/f6-analytics.md`

Các thay đổi F1 có sẵn trước F6 được giữ nguyên; F6 không sửa công thức tracking, presence, sales hoặc settings.
