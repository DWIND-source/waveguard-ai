# WaveGuard AI — The City That Thinks Ahead

**Tác giả / Author: [DWIND-source](https://github.com/DWIND-source).**

Nguyên mẫu nghiên cứu và demo DevFest do DWIND-source phát triển. Đây là mô phỏng CTM, không phải ứng dụng nhận diện camera hoặc hệ thống điều khiển đèn thực tế.

**Bản demo đã audit:** 37 tests; chuyển Việt/Anh và Light/Dark giữ nguyên phiên; báo cáo HTML song ngữ cùng dữ liệu JSON/CSV. Xem [audit và kịch bản thuyết trình ba phút](AUDIT.md).

Trên Windows PowerShell, dùng `npm.cmd` nếu execution policy chặn `npm.ps1`. Khuyến nghị Node.js 24 LTS. Chạy `npm.cmd install`, sao chép `.env.example` thành `.env`, rồi `npm.cmd run dev`. API key chỉ nhập vào `.env` trên máy chủ, không commit lên GitHub. Đưa repository lên GitHub không tự triển khai máy chủ Express/Gemini.

**Dự báo trước ùn tắc. Phối hợp trước khi đường bị khóa.**
Ứng dụng hỗ trợ quyết định giao thông dựa trên mô phỏng cho DevFest Cloud Hanoi 2026.

Người vận hành mô tả sự cố bằng tiếng Việt → Gemini hiểu sự cố → người vận hành xác nhận tham số → mô phỏng CTM 3 nút giao A → B → C → WaveGuard dự báo sóng ùn tắc, các nút trao đổi cảnh báo rủi ro, điều phối tín hiệu có kiểm tra an toàn → so sánh với điều khiển thông thường trên cùng dữ liệu → Gemini giải thích có căn cứ → xuất báo cáo.

> Đây là kết quả mô phỏng, chưa phải dữ liệu thử nghiệm giao thông thực tế. Ứng dụng không điều khiển đèn tín hiệu thực.

## Chạy ứng dụng

Yêu cầu Node.js 20+.

```bash
npm install
cp .env.example .env        # điền GEMINI_API_KEY (lấy từ Google AI Studio) — có thể bỏ trống
npm run dev                 # http://localhost:5173 (Express + Vite trong một tiến trình)
```

Bản production:

```bash
npm run build
npm start                   # phục vụ dist/ + API trên cổng $PORT (mặc định 5173)
```

Kiểm thử và benchmark:

```bash
npm test                    # 27 bài kiểm thử (vitest)
npm run typecheck
npm run bench               # Fixed-Time vs Max-Pressure vs WaveGuard trên 4 kịch bản
npm run bench -- 1,2,3,4,5  # nhiều seed
```

**Không có GEMINI_API_KEY:** mọi phần mô phỏng, demo một chạm, so sánh, báo cáo và Research Mode vẫn hoạt động. Phân tích sự cố bằng AI được thay bằng bảng tham số thủ công có nhãn rõ ràng; nút “Giải thích bằng Gemini” bị tắt. Ứng dụng không bao giờ hiển thị kết quả Gemini giả.

## Trải nghiệm chính (một trang)

1. **Nhập sự cố** — ô mô tả tiếng Việt, 3 kịch bản mẫu, nút “Xem WaveGuard giải quyết ùn tắc”.
2. **Xác nhận tham số** — Gemini trả JSON theo schema, máy chủ kiểm tra lại; số liệu không có trong mô tả bị loại và chuyển thành “Giả định thử nghiệm” do người vận hành chọn.
3. **Bản sao số** — SVG động: xe (biểu diễn sơ đồ của mật độ CTM), đèn, hàng chờ, ùn tắc hiện tại (đỏ/cam), ùn tắc dự báo (sọc cam, chỉ khi mô hình dự báo), cảnh báo giữa các nút (cung xanh lam). Bấm nút A/B/C để xem bản ghi quyết định và hỏi Gemini “Tại sao nút A thay đổi tín hiệu?”.
4. **Insight** — đang quan sát / dự báo / phối hợp / kết quả kỳ vọng (kèm độ bất định từ 5 seed khác).
5. **Trước và sau** — hai mô phỏng đồng bộ (Fixed-Time vs WaveGuard), biểu đồ, bảng chỉ số; Max-Pressure bật trong Research Mode.
6. **Giải thích & báo cáo** — tóm tắt tự động từ dữ liệu, giải thích bằng Gemini có kiểm tra căn cứ số liệu, xuất HTML (in được), JSON, CSV.
7. **Research Mode** — giả định CTM, tham số rủi ro, cấu hình bộ điều khiển, seed, benchmark nhiều seed + xuất dữ liệu, nhật ký quyết định.

## Kiến trúc

```
src/engine/          Bộ máy giao thông thuần TypeScript (không phụ thuộc React)
  network.ts         Hình học hành lang, tham số CTM, cấu hình mặc định
  demand.ts          Chuỗi xe đến Poisson theo seed (mulberry32), dùng chung cho mọi bộ điều khiển
  signal.ts          Máy trạng thái đèn an toàn (xanh min/max, vàng, đỏ toàn phần, công bằng)
  simulator.ts       Mô phỏng CTM bước thời gian cố định, chỉ số, sự kiện, khung hình
  predictor.ts       PART A — dự báo sóng ùn tắc (TTC, sóng xung kích LWR)
  stigmergy.ts       PART B — lan truyền rủi ro kiểu pheromone (bị chặn, suy giảm, hết hạn)
  controllers/       Fixed-Time, Max-Pressure, WaveGuard (PART C + D)
  report.ts          So sánh, gói bằng chứng cho Gemini, xuất HTML/JSON/CSV
src/shared/incident.ts  Schema sự cố + kiểm tra đầu ra Gemini (dùng chung client/server)
server/              Express + Google GenAI SDK (khoá API chỉ ở máy chủ)
src/components/      Giao diện React + Tailwind + Recharts + Lucide
tests/               Vitest
```

Cùng một bộ máy chạy demo, so sánh, benchmark và file xuất — không có số liệu cố định ẩn. Bộ điều khiển chỉ đọc *quan sát* (có thể mất khi cảm biến hỏng), tách biệt với trạng thái thực của mô phỏng, nên có thể thay bằng SUMO/TraCI hoặc nút ESP32 sau này.

## Mô hình và thuật toán

**CTM (Daganzo 1994).** Ô dài v_f·Δt (Δt = 1 s, v_f = 50 km/h); q_max = 1800 xe/h/làn; k_j = 1/7 xe/m/làn; w = q_max/(k_j − k_c) ≈ 4.7 m/s.
S_i = min(n_i, Q_i), R_i = min(Q_i, (w/v_f)(N_i − n_i)), y = min(S_i, R_{i+1}), n(t+1) = n(t) + vào − ra.
Nút giao: chỉ pha xanh xả xe (vàng 50%), tách dòng FIFO (8% rẽ ra đường ngang): xả = min(S·g, R_hạ_lưu / r). Hàng đợi ngoài cửa vào giữ xe khi đường đầy. Sự cố = giảm Q tại một ô (nút cổ chai). Mất cảm biến chỉ ảnh hưởng quan sát, không ảnh hưởng mô phỏng thực.

**PART A — Dự báo.** EMA dòng vào/ra theo từng đoạn; TTC = dung lượng còn lại / tốc độ tích luỹ (chỉ khi > 0, nếu không thì null); sóng xung kích u = (q_d − q_u)/(k_d − k_u) chỉ khi có hàng chờ; rủi ro = max(chiếm dụng, 1 − TTC/H, 1 − T_tràn/H), H = 120 s.

**PART B — Stigmergy (giả thuyết thiết kế thử nghiệm).** τ ← τ(1 − ρΔt); khi nhận thông điệp: τ ← τ + η·c·r·(τ_max − τ). Thông điệp gồm nguồn, đích, đoạn, rủi ro, TTC, độ tin cậy, thời điểm, hạn. Chỉ lan ngược dòng (C → B → A), suy giảm γ mỗi bước, không gửi tới nút đã có trong đường đi, hết hạn sau TTL. ρ = 0.04/s, η = 0.5, γ = 0.6, θ = 0.3, TTL = 30 s.

**PART C — Quyết định.** ρ_n = max(rủi ro cục bộ, τ_n); khả năng tiếp nhận hiệu dụng R·(1 − κρ_n); điểm Giữ pha vs Chuyển pha theo số xe phục vụ được trong 10 s × hệ số khẩn cấp theo thời gian chờ, trừ tổn thất chuyển pha. Hành động: MAINTAIN, EXTEND, SWITCH, METER (chuyển/giữ do rủi ro hạ lưu), FALLBACK (độ tin cậy < 0.5 → chu kỳ cố định). Mọi yêu cầu đi qua `signal.ts`; Gemini không bao giờ điều khiển đèn.

**PART D — Bản ghi quyết định.** Mỗi quyết định lưu nút, trạng thái, thông điệp nhận được, các phương án và điểm, hành động chọn, lý do, ràng buộc, thời gian tính.

**Baseline.** Fixed-Time: 60 s xanh chính / 20 s xanh ngang / vàng 3 s / đỏ toàn phần 2 s, offset 0/24/44 s. Max-Pressure (Varaiya 2013, đơn giản hoá): P = Σ s_m(x_vào − r·x_ra), chuyển khi P(khác) > P(hiện tại) + 0.5; thiếu dữ liệu thì dùng chu kỳ cố định.

## Gemini

- `POST /api/incident/parse` — `responseSchema` JSON; `validateParsedIncident` loại enum sai, kẹp giá trị, và **xoá mọi số không xuất hiện trong mô tả** (Gemini không được bịa số).
- `POST /api/explain` — gửi gói bằng chứng gọn (sự cố, tham số đã xác nhận, quan sát, dự báo, hành động, thông điệp rủi ro, chỉ số, hạn chế); Gemini trả lời tách biệt quan sát / dự báo / hành động / kết quả / độ bất định; máy chủ đánh dấu những con số không tìm thấy trong bằng chứng.
- Mô hình mặc định `gemini-3-flash-preview`, tự chuyển sang mô hình dự phòng khi quá tải (cấu hình qua biến môi trường).

## Kiểm thử (tests/)

1 bảo toàn xe · 2 sức chứa hữu hạn + hàng đợi cửa vào · 3 chặn hạ lưu và spillback · 4 an toàn pha đèn · 5 suy giảm/hết hạn cảnh báo · 6 nhu cầu giống hệt giữa các bộ điều khiển · 7 phát lại xác định · 8 xử lý thiếu dữ liệu cảm biến · 9 kiểm tra JSON sự cố từ Gemini · 10 tính chỉ số đúng.

## Hạn chế

Mô hình vĩ mô 3 nút, nhu cầu tổng hợp, chưa có xe máy hỗn hợp/người đi bộ/chặn nút giao, tham số chưa hiệu chỉnh với dữ liệu Hà Nội, cơ chế stigmergy là giả thuyết thử nghiệm. Kết quả có thể kém hơn baseline ở một số kịch bản (ví dụ giờ cao điểm không sự cố, WaveGuard chờ lâu hơn Fixed-Time vài phần trăm) và được hiển thị nguyên trạng.
