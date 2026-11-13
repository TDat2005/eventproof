# F1 — App Uninstall Cleanup

## Hành vi

- `app/uninstalled` được kiểm tra HMAC trên raw body, topic, domain và `X-Shopify-Triggered-At`. Chỉ cập nhật connection Shopify còn active, với event thuộc lần cài hiện tại. Ghi `uninstalled_at` theo thời điểm event (UTC), đặt `active=false`, xóa token. Retry không đẩy lùi retention. Event trước `installed_at` bị bỏ qua.
- Ingest view, heartbeat, order và ghi settings giữ khóa connection trong transaction. Catalog và repository dùng cùng transaction qua `DbService`/AsyncLocalStorage; không đổi công thức F2–F5. `shop/update` chỉ sửa timezone của connection đang active, không kích hoạt lại store.
- Reinstall giữ ID hiện hữu (kể cả ID legacy), cập nhật `installed_at` khi chuyển inactive → active, xóa uninstall/redaction marker. Mở Admin nhiều lần khi còn active không thay mốc install.
- `UninstallCleanupJob` chạy sau startup khoảng một giây để bù downtime; lần kế tiếp sau khi job trước hoàn tất 24 giờ. Cần ít nhất một backend luôn chạy. Không thêm queue, RabbitMQ hay scheduler dependency.
- Job phân trang 100 connection/lần. Khóa tenant rồi connection, đọc lại trạng thái dưới khóa trước khi xóa. Reinstall chờ cleanup commit; cleanup chờ ingest đang chạy. Nhiều replica có thể chọn cùng candidate nhưng chỉ một replica xóa được. Nếu tenant có connection khác còn active/chưa hết hạn hoặc thuộc platform khác, giữ nguyên tenant để tránh xóa dữ liệu dùng chung.
- Redis được SCAN/DEL theo namespace chính xác `recent:{tenantId}:*`, `rate:{shopDomain}:*` trước khi xóa MySQL. Redis lỗi: rollback MySQL và giữ candidate. MySQL lỗi sau Redis: rollback toàn bộ MySQL, retry việc xóa Redis an toàn. Không có transaction phân tán; chỉ xóa Redis của tenant đã inactive trong lúc giữ khóa MySQL. Rate bucket cũ trước F1 không có namespace shop và tự hết hạn sau tối đa 70 giây; request mới vẫn có thể tạo rate bucket ngắn hạn dù shop đã inactive.
- Xóa mappings theo connection, rồi tất cả bảng tenant-owned: order contributions/lines/snapshots, view events/hourly/daily, settings, products, connections, tenant. Không dùng `FLUSHDB`, wildcard toàn cục hay xóa dữ liệu tenant khác.
- Lỗi từng tenant được log và không chặn tenant tiếp theo. Candidate vẫn trong MySQL để lần chạy sau retry; lỗi selection được job log. Theo dõi log lỗi và thời gian candidate tồn đọng trong vận hành.

## Privacy của Shopify

Nguồn chính thức: [Privacy law compliance](https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance) và [shop/redact](https://shopify.dev/docs/api/webhooks/latest#list-of-topics-shop/redact).

Shopify gửi `shop/redact` không sớm hơn 48 giờ sau uninstall; không gửi nếu app đã được reinstall. Shopify yêu cầu hoàn thành compliance request trong 30 ngày **tính từ request**, đây không phải quyền trì hoãn mọi request theo retention uninstall.

F1 đăng ký `shop/redact` qua `compliance_topics` và xử lý tại `/api/webhooks/shop-redact`. Request phải có HMAC, domain trong payload khớp header và timestamp hợp lệ. Với store inactive, ghi marker ưu tiên vào DB trước, rồi xóa ngay, bỏ qua `UNINSTALL_RETENTION_DAYS`. Lỗi trả 5xx để Shopify retry; marker còn lại cũng được daily job nhặt lại. Store đang active hoặc event thuộc installation cũ được bảo vệ. Không tạo tenant mới từ webhook và không log payload/token.

**Giới hạn compliance hiện tại:** codebase chưa có handlers `customers/data_request` và `customers/redact`. F1 này xử lý xóa toàn shop; chưa phải triển khai đầy đủ ba mandatory compliance topics để phát hành App Store. Trước khi publish cần bổ sung luồng cung cấp dữ liệu cho merchant và xóa theo customer/order IDs. Schema không giữ tên/email/địa chỉ customer nhưng có external order IDs; không thể mặc định coi app không có dữ liệu cần xử lý. Cũng cần chính sách riêng cho backups/logs/exports ngoài schema và Redis của ứng dụng. Không trì hoãn các yêu cầu đó theo retention F1.

## Migration và cấu hình

- Biến mới duy nhất: `UNINSTALL_RETENTION_DAYS`, mặc định `30`; chấp nhận số nguyên `0..36500`. Giá trị rỗng, âm, thập phân hoặc không hợp lệ khiến startup thất bại. Chỉ dùng `0` với database dev riêng.
- [SQL migration](../server/migrations/20261113_f1_uninstall_cleanup.sql) thêm `installed_at`, `uninstalled_at`, `redact_requested_at` (`DATETIME(3)`) và index `(active, uninstalled_at)`.
- Dự án chưa có Drizzle migration runner/journal. Theo kiến trúc hiện có, `DbService.initTables` áp dụng migration tương đương, kiểm tra metadata và dùng MySQL named lock để nhiều replica không chạy DDL đồng thời. SQL là lựa chọn apply thủ công **một lần trước deploy**; không chạy thủ công sau khi startup đã migrate. Migration không xóa merchant data.
- Record inactive từ phiên bản cũ chưa biết thời điểm uninstall: bắt đầu retention tại thời điểm migration và xóa token. `installed_at` legacy lấy từ `created_at`; thời điểm các lần reinstall lịch sử chưa từng được lưu nên không thể khôi phục chính xác.
- Apply cấu hình webhook bằng quy trình Shopify deploy/dev hiện có. Build/config validate chỉ xác nhận cấu hình, không chứng minh subscriptions đã được đăng ký trên Shopify.

## Kiểm thử trên dev store

1. Dùng database MySQL và Redis dev riêng; không trỏ backend hay test vào production. Giữ `UNINSTALL_RETENTION_DAYS=30`, chạy `pnpm dev`, mở app trong Shopify Admin để activate connection. Xác nhận `active=1`, `uninstalled_at=NULL`; tạo view, heartbeat, settings và order fixture như hướng dẫn [core flow](core-flow.md).
2. Uninstall thật từ dev store. Trong Dev Dashboard xem delivery `/api/webhooks/app-uninstalled`. Kiểm tra đúng shop: `active=0`, `access_token=NULL`, `uninstalled_at` có giá trị. Gửi view/heartbeat sẽ bị từ chối; order webhook đến sau uninstall không thu thập dữ liệu mới. Redeliver cùng event: thời gian uninstall không đổi.
3. Kiểm tra retention mặc định: restart backend, dữ liệu vừa uninstall vẫn còn. Trong môi trường **chỉ chứa fixture dev**, đặt `UNINSTALL_RETENTION_DAYS=0` và restart. Job startup xóa tenant đã inactive; đối chiếu đủ bảng và Redis theo ID trước khi xóa. Đưa retention về `30` sau thử nghiệm.
4. Reinstall và mở Admin trước cleanup: connection active, marker được clear và dữ liệu được giữ. Redeliver uninstall cũ với `X-Shopify-Triggered-At` ban đầu: connection vẫn active. Có thể chạy hai backend cùng DB dev để kiểm tra phối hợp nhiều worker.
5. Thử `shop/redact` với body có `shop_domain` đúng dev shop và HMAC hợp lệ, topic `shop/redact`, `X-Shopify-Triggered-At` đúng thời điểm event. Với inactive shop, dữ liệu được xóa ngay dù retention=30. Với active reinstall, dữ liệu được giữ. Shopify CLI `webhook trigger --help` cho biết các cờ của phiên bản đang cài; fixture CLI có thể dùng domain giả, nên cần fixture khớp dev shop. Trigger thủ công không kiểm chứng subscription. Delivery thật `shop/redact` cần chờ tối thiểu 48 giờ.
6. Với fixture dev, ngắt Redis rồi gửi `shop/redact`: endpoint trả lỗi và marker DB còn lại. Khôi phục Redis, redeliver hoặc restart backend: dữ liệu được dọn. Không thử mất kết nối trên production.

## Automated checks

```powershell
pnpm --filter server typecheck
pnpm --filter server test
pnpm --filter server test:integration
pnpm build
pnpm exec shopify app config validate --json
```

Core integration dùng temporary MySQL tables trên một connection, không sửa bảng merchant; scheduler được override để không chạy trong suite này. Fixture order dùng timestamp lùi một phút, tránh MySQL DATETIME làm tròn timestamp thành tương lai và khiến assertion F5 chập chờn.

F1 integration cần một schema **test riêng** đã được cấp quyền, tên bắt buộc bắt đầu `f1_test_`. Suite tự tạo/migrate bảng, xóa fixture và thử migration legacy trên schema đó. Không chạy đồng thời suite với `nest build` khác vì build thay thư mục `dist`.

```powershell
$env:DATABASE_NAME='f1_test_cleanup'
pnpm --filter server test:f1
```

Đã chạy: 31 unit tests, 11 core integration tests, 9 F1 integration tests trên MySQL 8.4/Redis 7 local. F1 bao gồm HMAC/uninstall idempotence/token revocation, retention boundary/zero, Redis isolation, tenant isolation, hai worker, Redis outage, DB failure sau Redis, reinstall thắng stale candidate, cleanup chặn reinstall, in-flight ingest, redaction ưu tiên/retry và migration legacy/idempotence. Typecheck, backend build, Shopify app build và config validate đều thành công.

Chưa kiểm chứng: OAuth/uninstall/reinstall và redaction delivery thật trên Shopify dev store; vận hành đủ chu kỳ 24 giờ; kill process tại mọi điểm commit; tải lớn/thời gian giữ khóa; triển khai nhiều host; xóa backups/logs ngoài app. Test scheduler dùng fake timer và test nhiều worker dùng các connection pool thực trong cùng process.

## File thay đổi

- `server/src/db/schema.ts`, `server/src/db/db.service.ts`: lifecycle columns, index, migration và transaction scope.
- `server/src/modules/connections/domain/connection.entity.ts`, `connections.repository.port.ts`: contract lifecycle và khóa connection.
- `server/src/modules/connections/infrastructure/drizzle-connections.repository.ts`: install/uninstall idempotent, legacy IDs, timezone update, khóa ingest.
- `server/src/modules/connections/application/connections.service.ts`, `uninstall-cleanup.service.ts`, `server/src/modules/connections/connections.module.ts`: orchestration và daily job.
- `server/src/modules/engagement/application/view-tracker.service.ts`, `server/src/modules/sales/application/order-sync.service.ts`, `server/src/modules/settings/presentation/settings.controller.ts`: transaction/lock bao quanh ghi dữ liệu.
- `server/src/modules/shopify-adapter/presentation/shopify-webhook.controller.ts`: timestamp, uninstall và shop redaction.
- `server/src/redis/redis.service.ts`, `server/src/security/storefront-request.service.ts`: xóa Redis theo namespace và rate buckets theo shop.
- `shopify.app.toml`, `server/.env.example`, `server/package.json`: subscription, env, typecheck/F1 test scripts.
- `server/migrations/20261113_f1_uninstall_cleanup.sql`: migration thủ công tương đương startup migration.
- `server/src/modules/connections/application/uninstall-cleanup.service.spec.ts`, `server/test/f1.integration.mjs`, `server/test/core.integration.mjs`: kiểm thử.
- `docs/f1-uninstall-cleanup.md`, `README.md`: tài liệu.
