import type { ParsedIncident } from '../shared/incident';

export interface ApiStatus {
  gemini: boolean;
  model: string | null;
}

export interface Explanation {
  headline: string;
  observations: string[];
  predictions: string[];
  actions: string[];
  outcomes: string[];
  uncertainty: string[];
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const en = (body as { lang?: string })?.lang === 'en';
  if (import.meta.env.VITE_STATIC_DEMO === 'true') {
    throw new ApiError('gemini_unavailable', en ? 'Gemini requires a separate backend. Use manual parameters in this demo.' : 'Gemini cần backend riêng. Hãy dùng tham số thủ công trong bản demo này.');
  }
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new ApiError('network', en ? 'Cannot connect to the WaveGuard server.' : 'Không kết nối được tới máy chủ WaveGuard.');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const messages: Record<string, [string, string]> = {
      empty_text: ['Vui lòng mô tả sự cố.', 'Please describe the incident.'],
      gemini_unavailable: ['Gemini không khả dụng trong bản triển khai này.', 'Gemini is unavailable in this deployment.'],
      invalid_output: ['Không có sự cố hợp lệ được hỗ trợ. Vui lòng diễn đạt lại hoặc nhập thủ công.', 'No valid supported incident was returned. Rephrase or enter parameters manually.'],
      gemini_error: ['Dịch vụ Gemini không trả lời thành công. Có thể thử lại hoặc nhập thủ công.', 'Gemini did not respond successfully. Retry or enter parameters manually.'],
    };
    throw new ApiError(json.error ?? `http_${res.status}`, messages[json.error]?.[en ? 1 : 0] ?? (en ? `Server error (${res.status})` : `Lỗi máy chủ (${res.status})`));
  }
  return json as T;
}

export async function getStatus(): Promise<ApiStatus> {
  if (import.meta.env.VITE_STATIC_DEMO === 'true') return { gemini: false, model: null };
  try {
    const r = await fetch('/api/status');
    if (!r.ok) return { gemini: false, model: null };
    return await r.json();
  } catch {
    return { gemini: false, model: null };
  }
}

export function parseIncidentText(text: string, lang: 'vi' | 'en' = 'vi') {
  return post<{ parsed: ParsedIncident; errors: string[]; removedUnsupported: string[]; model: string }>('/api/incident/parse', { text, lang });
}

export function explainEvidence(evidence: unknown, question?: string, lang: 'vi' | 'en' = 'vi') {
  return post<{ explanation: Explanation; model: string; ungrounded: string[] }>('/api/explain', { evidence, question, lang });
}

export function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
