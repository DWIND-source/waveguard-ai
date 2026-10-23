import type { Lang } from './i18n';

/**
 * The engine logs warnings, events and decision reasons in Vietnamese. For the English UI
 * these phrase-level patterns translate them at display time, leaving the engine untouched.
 * Order matters: longer phrases come before the shorter phrases they contain.
 */
const N = '(-?[\\d.]+)';
const L = '([\\w-]+)';
const RULES: Array<[RegExp, string]> = [
  // shared fragments
  [new RegExp(`rủi ro hạ lưu ρ=${N} \\(cục bộ ${N}, pheromone τ=${N}\\)`, 'g'), 'downstream risk ρ=$1 (local $2, pheromone τ=$3)'],

  // forecasts (predictor)
  [new RegExp(`Hàng chờ trên ${L} đã lan tới nút thượng lưu \\(spillback\\), chiếm ${N}% sức chứa\\.`, 'g'), 'Queue on $1 has reached the upstream intersection (spillback), at $2% of capacity.'],
  [new RegExp(`Hàng chờ trên ${L} lan ngược ~${N} m/s, có thể chạm nút thượng lưu sau ~${N} s\\.`, 'g'), 'Queue on $1 is growing backwards at ~$2 m/s and may reach the upstream intersection in ~$3 s.'],
  [new RegExp(`Đoạn ${L} có thể đạt sức chứa trong ~${N} s \\(cửa sổ dự báo ${N} s\\)\\.`, 'g'), 'Link $1 may reach capacity in ~$2 s (forecast horizon $3 s).'],
  [new RegExp(`Đoạn ${L} đã đầy ${N}% sức chứa\\.`, 'g'), 'Link $1 is at $2% of capacity.'],

  // timeline events (simulator)
  [new RegExp(`Sự cố trên ${L}: năng lực thông hành giảm ${N}%`, 'g'), 'Incident on $1: capacity down $2%'],
  [new RegExp(`Sự cố trên ${L} được giải phóng`, 'g'), 'Incident on $1 cleared'],
  [new RegExp(`Lưu lượng tăng ${N}%`, 'g'), 'Demand up $1%'],
  [/Cảm biến nút (\w) mất tín hiệu \(không có dữ liệu\)/g, 'Sensor at node $1 lost (no data)'],
  [/Cảm biến nút (\w) mất tín hiệu \(dữ liệu đóng băng\)/g, 'Sensor at node $1 lost (frozen data)'],
  [/Cảm biến nút (\w) hoạt động lại/g, 'Sensor at node $1 restored'],
  [new RegExp(`Nút (\\w) bắt đầu điều tiết dòng về ${L}`, 'g'), 'Node $1 starts metering flow into $2'],
  [/Nút (\w) chuyển sang phương án dự phòng do thiếu dữ liệu/g, 'Node $1 switches to fallback (missing data)'],
  [new RegExp(`Nút (\\w) gửi cảnh báo rủi ro ${N} về ${L} tới nút (\\w)`, 'g'), 'Node $1 warns node $4: risk $2 on $3'],
  [new RegExp(`Đoạn ${L} vượt 80% sức chứa`, 'g'), 'Link $1 above 80% capacity'],
  [new RegExp(`Hàng chờ trên ${L} lan tới nút thượng lưu \\(spillback\\)`, 'g'), 'Queue on $1 reached the upstream intersection (spillback)'],

  // decision reasons (WaveGuard / Max-Pressure controllers)
  [new RegExp(`Điều tiết dòng về ${L}: `, 'g'), 'Metering flow into $1: '],
  [new RegExp(`; khả năng tiếp nhận hiệu dụng giảm còn ${N} xe/s nên nhường xanh cho đường ngang \\(${N} xe chờ\\)\\.`, 'g'), '; effective receiving capacity drops to $1 veh/s, so green goes to the side street ($2 veh waiting).'],
  [new RegExp(`Giữ xanh đường ngang để hạn chế xe đổ vào ${L}: `, 'g'), 'Holding side-street green to limit inflow into $1: '],
  [/\. Nếu bỏ qua rủi ro, bộ điều khiển đã chuyển về trục chính\./g, '. Without the risk term, the controller would have switched back to the main road.'],
  [new RegExp(`Chuyển sang pha (\\w+): điểm ${N} > ${N} \\(hàng chờ chính ${N}, đường ngang ${N} xe; `, 'g'), 'Switch to phase $1: score $2 > $3 (main queue $4, side street $5 veh; '],
  [new RegExp(`Kéo dài xanh trục chính: còn ${N} xe gần vạch dừng và hạ lưu còn tiếp nhận ${N} xe/s \\(`, 'g'), 'Extend main-road green: $1 veh still near the stop line and downstream can take $2 veh/s ('],
  [/Muốn chuyển pha nhưng bị ràng buộc thời gian xanh tối thiểu; giữ pha (\w+)\./g, 'Wants to switch but minimum green applies; holding phase $1.'],
  [new RegExp(`Giữ pha (\\w+): điểm ${N} ≥ ${N} \\(`, 'g'), 'Hold phase $1: score $2 ≥ $3 ('],
  [/Nút (\w) không có quan sát đáng tin cậy nên không suy đoán trạng thái giao thông; áp dụng chu kỳ cố định thận trọng/g, 'Node $1 has no reliable observations, so it does not guess the traffic state; applying a conservative fixed cycle'],
  [new RegExp(`, vẫn tiếp nhận và chuyển tiếp cảnh báo từ hạ lưu \\(τ=${N}\\)`, 'g'), ', still receiving and relaying downstream warnings (τ=$1)'],
  [new RegExp(`Áp lực pha (\\w+) \\(${N}\\) lớn hơn pha (\\w+) \\(${N}\\)\\.`, 'g'), 'Pressure of phase $1 ($2) exceeds phase $3 ($4).'],

  // constraints and candidate notes
  [new RegExp(`Thời gian xanh tối thiểu: pha (\\w+) mới xanh ${N}s < ${N}s`, 'g'), 'Minimum green: phase $1 has only been green $2s < $3s'],
  [new RegExp(`Độ tin cậy cảm biến ${N}% < ${N}% → dùng phương án dự phòng an toàn \\(chu kỳ cố định\\)`, 'g'), 'Sensor confidence $1% < $2% → safe fallback (fixed cycle)'],
  [new RegExp(`Hạ lưu ${L} có rủi ro tràn ${N} → giảm tiếp nhận hiệu dụng ${N}%`, 'g'), 'Downstream $1 has spill risk $2 → effective receiving reduced $3%'],
  [new RegExp(`Công bằng: đường ngang đã chờ ${N}s \\(tối đa ${N}s\\)`, 'g'), 'Fairness: side street has waited $1s (max $2s)'],
  [/Sắp chạm thời gian xanh tối đa → bộ an toàn sẽ buộc chuyển pha/g, 'Approaching maximum green → the safety layer will force a switch'],
  [new RegExp(`phục vụ ~${N} xe chính / ${N}s`, 'g'), 'serves ~$1 main-road veh / $2s'],
  [new RegExp(`phục vụ ~${N} xe đường ngang / ${N}s`, 'g'), 'serves ~$1 side-street veh / $2s'],
  [new RegExp(`mất ${N}s chuyển pha`, 'g'), 'loses $1s switching'],
  [/chưa đủ xanh tối thiểu/g, 'minimum green not reached'],
  [/chỉ dùng khi độ tin cậy thấp/g, 'only used at low confidence'],
  [/Không đủ dữ liệu để chấm điểm/g, 'Not enough data to score'],
  [/Chu kỳ cố định/g, 'Fixed cycle'],

  // scenario names (preset summaries become the scenario name)
  [/Xe tải hỏng trên đoạn B-C gần nút C, nguy cơ ùn ngược về A\./g, 'Truck broken down on B-C near node C, risk of queue backing up to A.'],
  [/Lưu lượng giờ cao điểm vào hành lang qua nút A tăng đột biến\./g, 'Rush-hour demand entering the corridor through node A surges.'],
  [/Nút B mất dữ liệu cảm biến; xe dừng đỗ gây cản trở trên B-C\./g, 'Node B lost sensor data; a parked vehicle obstructs B-C.'],
  [/Giao thông bình thường \(xem trước\)/g, 'Normal traffic (preview)'],
  [/Giao thông bình thường/g, 'Normal traffic'],
  [/Lưu lượng tăng đột biến giờ cao điểm/g, 'Rush-hour demand surge'],
  [/Xe tải hỏng gần nút C/g, 'Broken-down truck near node C'],
  [/Cảm biến tại nút B mất tín hiệu/g, 'Sensor at node B offline'],
];

export function engineText(s: string | null | undefined, lang: Lang): string {
  if (!s) return '';
  if (lang === 'vi') return s;
  let out = s;
  for (const [re, rep] of RULES) out = out.replace(re, rep);
  return out;
}
