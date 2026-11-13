# Event-Proof: luồng core sau khi sửa

## 1. Merchant mở ứng dụng

App Home lấy múi giờ IANA từ Shopify và gửi ID token tới backend. Backend kiểm tra HS256, audience, issuer/destination và hạn token, rồi xác định shop từ token. Shop trong request body không được dùng để chọn tenant.

`POST /api/admin/connection` tạo/kích hoạt connection sau xác thực. ID tenant và connection mới có độ dài cố định; connection và mapping cũ được giữ nguyên. Merchant phải mở App Home ít nhất một lần trước khi storefront bắt đầu tracking.

App Home đọc/lưu sáu trường cấu hình qua `/api/admin/settings`: bật/tắt và ngưỡng tối thiểu cho presence, daily views và sales. Giá trị ngưỡng là số nguyên từ 1 đến 1.000.000. Lỗi HTTP hoặc lỗi mạng hiện thông báo lỗi, không hiện thông báo thành công.

## 2. Khách mở trang sản phẩm

Theme block tạo `clientId` lưu trong localStorage và một `eventId` mới cho lần mở trang. Các block trên cùng trang dùng chung client ID và event ID. Nếu localStorage bị chặn, dùng client ID tạm cho trang đó.

Widget gửi `POST /apps/social-proof/events/view`. Shopify chuyển tiếp qua App Proxy, thêm shop, timestamp và signature. Backend xác thực chữ ký, thời gian request, connection đang active, product ID, event ID và thời gian event trước khi ghi dữ liệu. Backend không tự tạo shop từ traffic công khai.

Trong một transaction MySQL:

1. Insert raw event với khóa duy nhất theo connection + product + event ID.
2. Nếu khóa đã tồn tại: trả `isNew: false`, không tăng counter.
3. Nếu mới: tăng daily views theo ngày tại múi giờ shop và hourly views theo UTC.
4. Nếu một thao tác lỗi: rollback cả event lẫn các counter để lần retry vẫn ghi được.

Reload/mở tab mới tạo event mới nên tăng view. Retry do lỗi mạng giữ nguyên event ID. Presence và view là hai chỉ số khác nhau: hai tab chung trình duyệt có thể tạo hai view nhưng chỉ tính một browser trong presence.

Pixel tùy chọn chỉ relay custom event `sp:view` do widget phát, dùng đúng event ID đó. Pixel không còn ghi độc lập `product_viewed` hay tạo heartbeat bằng client ID riêng. Vì vậy không cần pixel để widget hoạt động và không bị cộng hai lần khi pixel được kích hoạt. Pixel không còn cần backend URL trỏ localhost.

## 3. Khách tiếp tục xem

Khi trang đang hiển thị, mỗi 10 giây widget gửi heartbeat rồi đọc metrics. Heartbeat cập nhật Redis ZSET theo tenant/product với member là client ID và score là thời gian server.

Presence là số browser có heartbeat trong 300 giây gần nhất. Redis tự hết hạn key và dọn member cũ. Khi tab bị ẩn, widget dừng polling; khách còn có thể nằm trong cửa sổ 5 phút cho tới khi heartbeat cũ hết hạn. Đây là số browser hoạt động gần đây, không phải số người được nhận diện tuyệt đối.

`GET /apps/social-proof/metrics/:productId` chỉ đọc số liệu và cấu hình, không ghi view, không ghi heartbeat và không tạo product mapping. Kết quả không cache. Widget chỉ hiển thị từng dòng khi backend trả cờ `display` tương ứng; số 0 được giữ nguyên. Nếu không dòng nào đạt ngưỡng thì ẩn toàn bộ widget/tab.

Các request storefront có giới hạn tần suất theo shop/IP. Khi Customer Privacy API có mặt và không cho phép analytics, widget không gửi tracking.

## 4. Đơn hàng được tạo

App chỉ khai báo subscription `orders/create` cho thống kê đơn hàng trong `shopify.app.toml`. Đây là sự kiện đơn được tạo, không phải trạng thái thanh toán hay hoàn tất giao hàng. Backend xác thực HMAC trên raw body trước khi xử lý. Đơn của connection chưa active hoặc đã uninstall được bỏ qua, không tự tạo tenant.

Mỗi đơn được ghi đúng một lần trong transaction, khóa theo connection + external order ID. Lần tạo đã lưu thành công sẽ được giữ nguyên; gửi lại webhook cùng đơn không cộng thêm và không thay thế số lượng, kể cả payload retry khác đi. Nếu lưu lỗi giữa chừng, cả snapshot, line và contribution đều rollback để retry lại an toàn.

Lấy `line_items.quantity` tại thời điểm tạo đơn, không lấy `current_quantity`. Các line/variant cùng product được gom tổng quantity. Đơn test không đóng góp số lượng. Các lần sửa, hủy hoặc hoàn tiền sau đó không thay đổi số đã ghi; nếu webhook update/cancel cũ còn được gửi tới endpoint thì được xác thực và acknowledge nhưng không xử lý nghiệp vụ.

`ordersLast24h` là **số lượng sản phẩm được đặt khi đơn được tạo**, không phải số đơn hay số sản phẩm đã thanh toán: một đơn đặt 3 sản phẩm A đóng góp 3 cho A. Chỉ cộng contribution có thời điểm tạo đơn nằm trong 24 giờ gần nhất và không ở tương lai. Sau 24 giờ, contribution tự nằm ngoài truy vấn thống kê; không cần nhận webhook khác để trừ.

Các snapshot cũ từng được điều chỉnh theo update/cancel được giữ nguyên; không tự suy đoán hoặc ghi đè lại số lượng ban đầu. Quy tắc create-only áp dụng cho đơn được tiếp nhận từ bản sửa này.

`shop/update` cập nhật múi giờ cho connection active. `app/uninstalled` vô hiệu connection; API storefront từ chối traffic tiếp theo.

## Chạy và kiểm thử

### Test số lượng được đặt trong 24 giờ trên dev store

Đơn tạo qua cổng thanh toán thử của Shopify có `test: true`; mặc định không được cộng vào widget. Để thử luồng thực tế trên một shop dev, cấu hình trong `server/.env`:

```dotenv
NODE_ENV=development
SALES_TEST_ORDER_SHOPS=tadnot.myshopify.com
```

Chế độ này chỉ cho phép shop nằm trong danh sách và bắt buộc `NODE_ENV=development`; production luôn loại đơn test. Cờ `test_order` vẫn được lưu đúng giá trị nhận từ Shopify. Chỉ định shop dev khác nếu cần; nhiều domain phân tách bằng dấu phẩy.

Khởi động lại `pnpm dev`, mở App Home để kích hoạt connection và bật “Sản phẩm được đặt trong 24 giờ” với ngưỡng 1. Tạo **đơn test mới** qua checkout cho đúng sản phẩm, quantity 2. Shopify cần gửi `orders/create` thành công tới tunnel còn hoạt động. Khi quay lại trang sản phẩm, lần polling kế tiếp (10 giây, chưa tính độ trễ webhook) sẽ tăng quantity thêm 2. Hủy/sửa đơn không giảm số đã ghi vì hiện chỉ xử lý sự kiện tạo đơn.

Đơn test đã được xử lý trước khi bật chế độ này không được tính lại qua retry; cần tạo đơn mới. Tắt cấu hình không xóa contribution của các đơn test đã nhận trước đó, nhưng truy vấn metrics sẽ loại chúng khỏi kết quả. Production luôn loại đơn test cả khi dữ liệu thử đã được ghi từ trước; dữ liệu thử chỉ nên nằm trong shop dev riêng.

Tab bên lề trên desktop mở khi rê chuột vào tab hoặc panel và đóng khi chuột rời khỏi cả hai vùng (trễ 180ms để tránh nhấp nháy). Trên thiết bị cảm ứng vẫn bấm để mở/đóng; phím Escape và nút đóng vẫn hoạt động.

```sh
pnpm install
docker compose up -d
pnpm dev
```

Shopify CLI cấp `SHOPIFY_API_KEY` và `SHOPIFY_API_SECRET` cho backend khi chạy dev. Nếu chạy backend riêng hoặc deploy, cấu hình hai biến này trong môi trường server; xem `server/.env.example`. Backend từ chối request cần xác thực nếu thiếu cấu hình, không tự bỏ qua xác thực.

Sau khi cập nhật cấu hình webhook, khởi động lại `pnpm dev` để CLI đồng bộ subscription cho dev store, mở App Home, rồi reload trang sản phẩm. Khi deploy, phải cấu hình application URL/backend HTTPS thực tế và áp dụng app config; không dùng URL mặc định của template.

```sh
pnpm --filter server test
pnpm --filter server test:integration
pnpm --filter server exec tsc --project ../extensions/app-home/tsconfig.json
shopify app config validate --json
shopify app build
```

Integration test cần MySQL/Redis đang chạy. Test dùng bản sao bảng dạng TEMPORARY trên một connection riêng; không sửa dữ liệu merchant. Redis fixture có namespace riêng và được dọn sau test, rate-limit fixture tự hết hạn.

## Dữ liệu có sẵn và giới hạn

### Lỗi Shopify không cho đăng ký webhook đơn hàng

Nếu app preview báo `This app is not approved to subscribe to webhook topics containing protected customer data`, subscription `orders/create` vẫn cần quyền Protected customer data vì dữ liệu liên quan tới đơn hàng được Shopify xếp vào nhóm này. Scope `read_orders` không tự cấp quyền đó. Chỉ nhận sự kiện tạo đơn không loại bỏ yêu cầu cấp quyền.

Trong dashboard của Event-Proof, mở **API access requests → Protected customer data access → Request access**, chọn Protected customer data và lưu mục đích: tổng hợp số lượng sản phẩm trong đơn hợp lệ tạo trong 24 giờ để hiển thị social proof. Ứng dụng không cần tên, địa chỉ, email hay số điện thoại khách hàng, nên không chọn các trường nhận dạng đó. Nếu chưa có mục yêu cầu quyền, cần chọn distribution method phù hợp với kế hoạch phát hành trước; không chọn tùy ý vì lựa chọn này ảnh hưởng cách phân phối app.

Theo [hướng dẫn Shopify](https://shopify.dev/docs/apps/launch/protected-customer-data), app chỉ cài trên development store có thể dùng quyền sau khi khai báo và lưu, không cần gửi duyệt public app. Khi quyền đã được cấp, chạy lại `pnpm dev` và chấp nhận cập nhật scope nếu Shopify yêu cầu. App cài trên shop thật có thể cần quy trình duyệt tương ứng.

Payload order webhook đã được giới hạn các trường cần cho đồng bộ. Cấu hình này giảm dữ liệu nhận về nhưng không bỏ yêu cầu cấp quyền. Không xóa các subscription order để che lỗi vì việc đó làm ngừng đồng bộ sales.

Thay đổi này không reset counter lịch sử và không xóa dữ liệu merchant. Daily views từng bị tăng sai bởi polling vẫn cần được đối soát riêng; raw event cũ không đủ để khôi phục chính xác mọi page view thực tế. Các counter mới áp dụng quy tắc đúng từ lúc chạy bản sửa.

Chưa có backfill đơn hàng trước lần kích hoạt app hoặc job đối soát Shopify định kỳ. Sales phản ánh các snapshot webhook đã nhận; việc triển khai lên shop thật vẫn cần kiểm tra delivery webhook và quyền đọc orders. Cơ chế retry sau lỗi lưu đơn dựa vào retry webhook của Shopify, chưa có hàng đợi bền vững riêng.
