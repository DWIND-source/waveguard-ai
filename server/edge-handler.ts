import type * as Gemini from './gemini';

type Provider = Pick<typeof Gemini, 'geminiAvailable' | 'GEMINI_MODEL' | 'parseIncident' | 'explain'>;
export function createEdgeHandler(provider: Provider, allowedOrigins: string[]) {
  const windows = new Map<string, { start: number; count: number }>();
  return async (request: Request): Promise<Response> => {
    const headers = new Headers({ 'Cache-Control': 'no-store', Vary: 'Origin' });
    const json = (data: unknown, status = 200) => Response.json(data, { status, headers });
    const origin = request.headers.get('origin');
    if (origin && !allowedOrigins.includes(origin)) return json({ error: 'origin_not_allowed' }, 403);
    if (origin) headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, x-region');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const path = new URL(request.url).pathname.replace(/^\/functions\/v1\/waveguard-api|^\/waveguard-api/, '');
    if (path === '/api/status' && request.method === 'GET') {
      return json({ gemini: provider.geminiAvailable(), model: provider.geminiAvailable() ? provider.GEMINI_MODEL : null });
    }
    if (!['/api/incident/parse', '/api/explain'].includes(path)) return json({ error: 'not_found' }, 404);
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    const now = Date.now();
    for (const [key, value] of windows) if (now - value.start >= 60000) windows.delete(key);
    // Per-isolate protection, not a distributed quota or user authentication.
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'anonymous';
    for (const [key, limit] of [['global', 60], [`ip:${ip}`, 12]] as const) {
      const value = windows.get(key) ?? { start: now, count: 0 };
      windows.set(key, value);
      if (++value.count > limit) { headers.set('Retry-After', '60'); return json({ error: 'rate_limit' }, 429); }
    }
    try {
      const reader = request.body?.getReader();
      if (!reader) return json({ error: 'empty_text' }, 400);
      let bytes = 0, text = '';
      const decoder = new TextDecoder();
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 2 * 1024 * 1024) { await reader.cancel(); return json({ error: 'body_too_large' }, 413); }
        text += decoder.decode(part.value, { stream: true });
      }
      let body: Record<string, unknown>;
      try { body = JSON.parse(text + decoder.decode()); }
      catch { return json({ error: 'invalid_json' }, 400); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'invalid_json' }, 400);
      const lang = body.lang === 'en' ? 'en' : 'vi';
      if (path === '/api/incident/parse') {
        const input = typeof body.text === 'string' ? body.text.trim().slice(0, 2000) : '';
        if (!input) return json({ error: 'empty_text' }, 400);
        if (!provider.geminiAvailable()) return json({ error: 'gemini_unavailable' }, 503);
        const result = await provider.parseIncident(input, lang);
        if (!result.parsed) return json({ error: 'invalid_output', model: result.model }, 422);
        return json(result);
      }
      if (!body.evidence || typeof body.evidence !== 'object' || Array.isArray(body.evidence)) return json({ error: 'missing_evidence' }, 400);
      if (!provider.geminiAvailable()) return json({ error: 'gemini_unavailable' }, 503);
      return json(await provider.explain(body.evidence, typeof body.question === 'string' ? body.question.slice(0, 500) : undefined, lang));
    } catch {
      // Provider errors may contain sensitive request details. Never echo them.
      return json({ error: 'gemini_error' }, 502);
    }
  };
}
