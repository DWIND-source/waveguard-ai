# WaveGuard AI — audit demo, 23/10/2026

Phạm vi đã được người dùng xác nhận: chỉnh WaveGuard hiện có, giữ mô phỏng CTM. Không chuyển thành CrossGuard hay dựng pipeline Computer Vision giả.

## Thay đổi chính

- Giao diện phòng nghiên cứu: phân cấp typography, panel phẳng, khoảng trắng, phạm vi mô hình hiện ngay đầu trang, lộ trình demo 3 bước.
- Bản đồ giữ kích thước đọc được và cuộn ngang trên điện thoại; thêm nút kiểm tra A/B/C ngoài SVG, bố trí callout thành ba cột, ID SVG riêng cho mỗi bản đồ. Dừng phát khi mở quyết định; hỗ trợ focus bàn phím và Escape trong inspector.
- Sửa thời gian phát khớp timestamp của frame cuối. Số liệu lấy mẫu không còn lấy từ tương lai; ghi rõ thời điểm mẫu. Điểm xe là biểu diễn mật độ CTM, không phải tracking hay quỹ đạo xe thực.
- Việt/Anh cho tiêu đề trang, nội dung chính, lỗi API, chế độ nghiên cứu và báo cáo HTML. Nội dung người dùng nhập được giữ nguyên. Đổi ngôn ngữ xoá lời giải thích AI cũ để tránh gắn ngôn ngữ hoặc dữ liệu cũ vào phiên mới; phiên mô phỏng và vị trí phát được giữ.
- Chặn kết quả phân tích Gemini cũ ghi đè sau khi chọn preset/đổi ngôn ngữ; lời giải thích và benchmark không được tái sử dụng cho phiên/cấu hình khác. Huỷ tác vụ ước lượng bất định đã lỗi thời.
- Kiểm tra số Gemini theo đơn vị: phút không thể làm bằng chứng cho phần trăm, phần trăm không thể làm bằng chứng cho thời lượng. Loại intent unknown/enum sai, chỉ giữ trường được hỗ trợ, không thực thi mã hay điều khiển tín hiệu từ Gemini.
- Bổ sung định nghĩa TTC = Time-to-Capacity và từ chối lời giải thích dùng Time-to-Collision. Kiểm tra số học chỉ là kiểm tra sơ bộ, không được trình bày như xác minh ngữ nghĩa hoàn chỉnh.
- Không trả lỗi provider thô hoặc raw output về client; che giá trị khoá trong log lỗi. Khoá vẫn nằm ở server.
- Tách tải biểu đồ theo nhu cầu; memo hoá báo cáo/dữ liệu biểu đồ, không tính nhật ký nghiên cứu khi đóng. JavaScript ban đầu khoảng 311 KB thay vì 695 KB (chưa gzip); biểu đồ tải riêng khoảng 393 KB.
- `npm start` chạy trên Windows. Cập nhật Vitest lên 4.1.12; npm audit không báo lỗ hổng tại thời điểm kiểm tra.

## Đối chiếu 14 yêu cầu

| Mục | Kết quả / giới hạn |
| --- | --- |
| 1. Việt/Anh | Kiểm thử DOM đổi hai chiều, bảo toàn mô tả và vị trí phát; sửa các nhãn phát hiện được và xuất HTML theo ngôn ngữ. Văn bản do người dùng/AI nhập không tự dịch lại. Chưa rà từng pixel bằng browser. |
| 2. Light/Dark | Kiểm thử đổi hai chiều trong phiên đang tồn tại; không reset seed, dữ liệu, mô tả hoặc vị trí phát. |
| 3. Upload video / inference | Không có trong WaveGuard. Không thêm nút upload không hoạt động. |
| 4. Webcam / permission | Không có trong WaveGuard. Không yêu cầu quyền camera. |
| 5. Polygon | Không có trong WaveGuard. Bản đồ SVG dùng cùng phép chiếu/toạ độ cho đường, mật độ và nhãn; chưa kiểm chứng pixel trên browser. |
| 6. Detector / tracking | Không có detector. Xe hiển thị được tính từ cell density và movement của CTM, có nhãn giới hạn rõ ràng. |
| 7. Rủi ro và false positive | Test có bottleneck, spillback, dữ liệu cảm biến thiếu, dòng xe giảm, mạng không có nhu cầu. Cảnh báo trên mạng không nhu cầu phải bằng 0. Đây không phải đánh giá precision/recall trên video thật. |
| 8. Nguồn cảnh báo/timeline | Test mọi warning event có risk message tương ứng về thời điểm và link. Timeline lấy từ engine; các mục incident/sensor là sự kiện kịch bản, không phải cảnh báo rủi ro. |
| 9. Gemini API thật | Đã gọi parse tiếng Việt, tiếng Anh và explain qua Express + Google SDK; trả 200. Xem artifacts/live-api-audit.json. Đây là bộ phân tích sự cố, không phải trình thực thi quy tắc tuỳ ý. |
| 10. Quy tắc không an toàn | Prompt yêu cầu shell, lộ khoá, mọi đèn xanh bị từ chối HTTP 422. DTO được allowlist; không có eval/tool execution. Kiểm thử này không phải chứng minh chống mọi prompt injection. |
| 11. Báo cáo | HTML Việt/Anh, JSON, CSV được xuất từ cùng phiên seed 2026. Test đối chiếu mọi hàng metric HTML với session, JSON metrics/events và các hàng chuỗi thời gian CSV. HTML escape đầu vào. |
| 12. Khoá server-only | Quét theo giá trị khoá thật: không có trong src client hoặc dist. HTTP /.env và /server/gemini.ts trên bản production trả SPA, không trả khoá/mã server. Không in khoá trong audit. |
| 13. Số liệu/nút giả | Không thêm detection, video hay KPI giả. Metric từ engine; preset ghi rõ là giả định. Nút demo đổi thành tên trung lập, không hứa chắc giải quyết ùn tắc. Test nút demo, chuyển chế độ và tới khung cuối. Không tuyên bố đã click mọi nút trong browser. |
| 14. Tests | 37 tests đạt, TypeScript đạt, production build đạt. Benchmark cả normal/rush/incident/sensor với cả 3 controller đã chạy. |

## Bằng chứng và cách chạy

- `npm.cmd test` — 37 tests, gồm 27 tests ban đầu và 10 tests audit/UI.
- `npm.cmd run typecheck`, `npm.cmd run build`, `npm.cmd run bench`.
- `npm.cmd start` — production tại port mặc định 5173, hoặc đặt PORT trước khi chạy.
- `npm.cmd run test:live` — cần server và GEMINI_API_KEY đã cấu hình; mặc định kiểm tra localhost:5183, có thể đặt VERIFY_URL. Có dùng quota Gemini thật. Script lưu status, response và evidence vào artifacts/live-api-audit.json, trả exit code khác 0 khi kiểm tra thất bại.
- `npx.cmd tsx scripts/export-demo.ts` — tái tạo artifacts/demo-report-vi.html, demo-report-en.html, demo-session.json, demo-series.csv, demo-decisions.csv. Các file này dùng cùng một phiên, gồm cả Max-Pressure.

## Demo ba phút

1. **0:00–0:25**: Nêu câu hỏi phối hợp nút giao; chỉ rõ đây là CTM trên ba nút, chưa phải camera hoặc dữ liệu giao thông đo thật.
2. **0:25–1:10**: Bấm Chạy demo phối hợp. Quan sát sự cố, cảnh báo C→B→A, bấm nút B và giải thích quyết định từ trace. Có thể đổi ngôn ngữ/sáng tối mà giữ phiên.
3. **1:10–1:55**: Đóng inspector, tới cuối phiên, so sánh Fixed-Time/WaveGuard; chỉ ra cùng seed/demand. Xuất HTML/JSON để người xem kiểm tra. Không dùng phần trăm của seed khác để mô tả phiên này.
4. **1:55–2:40**: Nhập “Xe tải hỏng gần nút C trên đoạn B-C, giảm 50% năng lực trong 20 phút”, phân tích Gemini thật và xem form xác nhận. Gemini không tự áp dụng. Nếu API chậm, chuyển nhập thủ công với nhãn đúng.
5. **2:40–3:00**: Kết luận bằng giới hạn và hướng kiểm chứng thực địa. Ở benchmark rush seed 2026, WaveGuard có tổng chờ khoảng 21.3 xe·giờ so với 19.7 của Fixed-Time; không che kết quả bất lợi.

## Giới hạn chưa xử lý bằng kiểm thử thực tế

Không có ảnh tham chiếu MIT Media Lab trong nội dung được cung cấp hoặc workspace, nên chưa thể đối chiếu chính xác với reference. Không có browser/native UI được kết nối trong phiên này; kiểm thử UI dùng jsdom, không chứng minh layout, contrast, tốc độ vẽ, tải ảnh vệ tinh hay thao tác cảm ứng trên thiết bị thật. Thiết kế responsive đã sửa bằng CSS và cấu trúc, cần một lượt kiểm tra bằng mắt trước khi lên sân khấu.

Mô hình vẫn là CTM vĩ mô, nhu cầu Poisson tổng hợp; chưa hiệu chỉnh với Hà Nội, không mô hình hoá xe máy hỗn hợp/người đi bộ. Hình ảnh vệ tinh cần mạng. Gemini có latency, quota, fallback model và khả năng diễn giải sai; kiểm tra số và thuật ngữ không chứng minh mọi câu đều đúng. Ứng dụng là demo cục bộ, chưa bổ sung xác thực/rate limit cho triển khai Internet công khai. Tính mô phỏng vẫn chạy trên main thread, kịch bản/benchmark lớn có thể làm UI tạm khựng.
