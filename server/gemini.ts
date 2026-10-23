import { GoogleGenAI } from '@google/genai';
import { GEMINI_INCIDENT_SCHEMA, validateParsedIncident, type ParsedIncident } from '../src/shared/incident';

/**
 * Server-side Gemini integration (official Google GenAI SDK).
 * The API key is read from the GEMINI_API_KEY environment variable and never
 * sent to the browser. Gemini is used as a semantic interpreter and an
 * explanation assistant only — it never controls signals.
 */
export const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';

let client: GoogleGenAI | null = null;
export function geminiAvailable(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}
function ai(): GoogleGenAI {
  if (!client) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  return client;
}

const FALLBACK_MODELS = (process.env.GEMINI_FALLBACK_MODELS || 'gemini-flash-latest,gemini-flash-lite-latest').split(',').map((s) => s.trim()).filter(Boolean);

/** generateContent with a short retry on transient overload (429/500/503) and an optional fallback model. */
async function generate(params: { contents: string; config: Record<string, unknown> }): Promise<{ text: string; model: string }> {
  const models = [GEMINI_MODEL, ...FALLBACK_MODELS.filter((m) => m !== GEMINI_MODEL)];
  let lastErr: unknown;
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await ai().models.generateContent({
          model,
          contents: params.contents,
          config: { ...params.config, thinkingConfig: { thinkingLevel: 'low' }, httpOptions: { timeout: 30000 } } as any,
        });
        return { text: res.text ?? '', model };
      } catch (e: any) {
        lastErr = e;
        const status = Number(e?.status ?? 0);
        if (![429, 500, 503, 504].includes(status) && !/timeout|aborted/i.test(String(e?.message))) throw e;
        if (status === 503 || status === 429) break; // overloaded: move to the next model right away
        await new Promise((r) => setTimeout(r, 800));
      }
    }
  }
  throw lastErr;
}

const INCIDENT_SYSTEM = `Bạn là bộ phân tích sự cố giao thông cho WaveGuard AI. Mạng mô phỏng gồm hành lang một chiều Tây→Đông với 3 nút giao có đèn: A → B → C.
Các đoạn trục chính: "in-A" (cửa vào trước nút A), "A-B" (giữa A và B), "B-C" (giữa B và C), "C-out" (sau nút C). Mỗi nút có một đường ngang.
Nhiệm vụ: chuyển mô tả tiếng Việt của điều hành viên thành JSON có cấu trúc.
Quy tắc bắt buộc:
- incidentType: road_blockage (xe hỏng/tai nạn chắn làn), capacity_drop (giảm năng lực do thi công, ngập...), demand_surge (lưu lượng tăng đột biến), sensor_failure (cảm biến/camera mất tín hiệu), unknown.
- Sự cố "gần nút X" hoặc "trước nút X" trên trục chính thường nằm trên đoạn đi vào X (C → B-C, B → A-B, A → in-A). "Giữa B và C" là B-C.
- TUYỆT ĐỐI KHÔNG tự bịa số. capacityReduction, demandChange, durationSeconds chỉ được điền khi văn bản nêu rõ con số (ví dụ "50%", "20 phút"); nếu không, đặt null và liệt kê tên trường trong missingInformation.
- capacityReduction và demandChange là phân số (50% → 0.5). durationSeconds tính bằng giây.
- summary: một câu tiếng Việt ngắn gọn, chỉ dựa trên văn bản.`;

export async function parseIncident(text: string, lang: 'vi' | 'en' = 'vi'): Promise<{ parsed: ParsedIncident | null; errors: string[]; removedUnsupported: string[]; model: string; raw: unknown }> {
  const res = await generate({
    contents: text,
    config: {
      systemInstruction: lang === 'en' ? `${INCIDENT_SYSTEM}
- The operator may write in English. Write the summary field in English.` : INCIDENT_SYSTEM,
      responseMimeType: 'application/json',
      responseSchema: GEMINI_INCIDENT_SCHEMA as any,
      temperature: 0,
    },
  });
  let raw: unknown = null;
  try {
    raw = JSON.parse(res.text ?? '');
  } catch {
    return { parsed: null, errors: ['Gemini trả về JSON không hợp lệ'], removedUnsupported: [], model: res.model, raw: res.text };
  }
  const v = validateParsedIncident(raw, text);
  // Unknown/invalid intents cannot become a default road blockage in the client.
  const accepted = v.ok && v.value?.incidentType !== 'unknown';
  return { parsed: accepted ? v.value : null, errors: accepted ? v.errors : [...v.errors, 'unsupported_incident'], removedUnsupported: v.removedUnsupported, model: res.model, raw: null };
}

const EXPLAIN_SCHEMA = {
  type: 'OBJECT',
  properties: {
    headline: { type: 'STRING' },
    observations: { type: 'ARRAY', items: { type: 'STRING' } },
    predictions: { type: 'ARRAY', items: { type: 'STRING' } },
    actions: { type: 'ARRAY', items: { type: 'STRING' } },
    outcomes: { type: 'ARRAY', items: { type: 'STRING' } },
    uncertainty: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['headline', 'observations', 'predictions', 'actions', 'outcomes', 'uncertainty'],
  propertyOrdering: ['headline', 'observations', 'predictions', 'actions', 'outcomes', 'uncertainty'],
};

const EXPLAIN_SYSTEM = `Bạn là trợ lý giải thích của WaveGuard AI, một ứng dụng hỗ trợ quyết định dựa trên MÔ PHỎNG giao thông.
Bạn nhận một "gói bằng chứng" JSON. Hãy viết lời giải thích bằng tiếng Việt, rõ ràng cho người không chuyên.
Quy tắc bắt buộc:
- CHỈ dùng các con số và sự kiện có trong gói bằng chứng. Không bịa thêm kết quả, không ước tính số liệu mới, không suy ra số vụ tai nạn hay an toàn đường bộ.
- Phân biệt rõ: observations = điều mô phỏng quan sát được; predictions = dự báo của mô hình; actions = hành động bộ điều khiển đã thực hiện; outcomes = kết quả đo được trong mô phỏng; uncertainty = độ bất định và hạn chế.
- Luôn nói rõ đây là kết quả mô phỏng, chưa phải dữ liệu giao thông thực tế.
- Nếu WaveGuard kém hơn ở chỉ số nào, phải nói thẳng.
- TTC luôn là Time-to-Capacity (thời gian tới khi đoạn đường đầy), TUYỆT ĐỐI không phải Time-to-Collision. Risk là điểm mô hình, không phải xác suất tai nạn. Ứng dụng không phát hiện va chạm.
- Mỗi mục 1–4 câu ngắn. headline là một câu tóm tắt.`;

export interface Explanation {
  headline: string;
  observations: string[];
  predictions: string[];
  actions: string[];
  outcomes: string[];
  uncertainty: string[];
}

/** Numbers in the explanation that cannot be found in the evidence package (shown to the user as a grounding check). */
export function ungroundedNumbers(explanation: Explanation, evidence: unknown): string[] {
  const evNums = new Set<number>();
  const walk = (v: unknown) => {
    if (typeof v === 'number') evNums.add(v);
    else if (typeof v === 'string') (v.match(/-?\d+(?:[.,]\d+)?/g) ?? []).forEach((s) => evNums.add(Number(s.replace(',', '.'))));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(evidence);
  const ev = [...evNums];
  const text = [explanation.headline, ...explanation.observations, ...explanation.predictions, ...explanation.actions, ...explanation.outcomes, ...explanation.uncertainty].join(' ');
  const found = (text.match(/\d+(?:[.,]\d+)?/g) ?? []).map((s) => ({ s, v: Number(s.replace(',', '.')) }));
  const bad = new Set<string>();
  for (const { s, v } of found) {
    if (v <= 3) continue; // node ordinals, small counts like "3 nút"
    const ok = ev.map(Math.abs).some((e) => Math.abs(e - v) <= Math.max(0.051, Math.abs(e) * 0.01) || Math.abs(e * 100 - v) < 0.6 || Math.abs(e / 3600 - v) < 0.06 || Math.abs(e / 60 - v) < 0.6);
    if (!ok) bad.add(s);
  }
  return [...bad];
}

export async function explain(evidence: unknown, question?: string, lang: 'vi' | 'en' = 'vi'): Promise<{ explanation: Explanation; model: string; ungrounded: string[] }> {
  const prompt = `${question ? `Câu hỏi của điều hành viên: ${question}\n\n` : ''}Gói bằng chứng (JSON):\n${JSON.stringify(evidence)}`;
  const res = await generate({
    contents: prompt,
    config: {
      systemInstruction: lang === 'en' ? `${EXPLAIN_SYSTEM}
IMPORTANT: write every text field of the answer in English (the evidence is in Vietnamese).` : EXPLAIN_SYSTEM,
      responseMimeType: 'application/json',
      responseSchema: EXPLAIN_SCHEMA as any,
      temperature: 0.2,
    },
  });
  const parsed = JSON.parse(res.text ?? '{}') as Partial<Explanation>;
  const arr = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string').slice(0, 6) : []);
  const explanation: Explanation = {
    headline: typeof parsed.headline === 'string' ? parsed.headline : '',
    observations: arr(parsed.observations),
    predictions: arr(parsed.predictions),
    actions: arr(parsed.actions),
    outcomes: arr(parsed.outcomes),
    uncertainty: arr(parsed.uncertainty),
  };
  if (/time[ -]to[ -]collision|thời gian (?:đến|tới) (?:khi )?va chạm/i.test(JSON.stringify(explanation))) {
    throw new Error('unsupported_collision_interpretation');
  }
  return { explanation, model: res.model, ungrounded: ungroundedNumbers(explanation, evidence) };
}
