import { expect, it, vi } from 'vitest';
import { createEdgeHandler } from '../server/edge-handler';

function setup() {
  const parseIncident = vi.fn().mockResolvedValue({ parsed: null, model: 'test' });
  const explain = vi.fn().mockRejectedValue(new Error('private provider details'));
  return { parseIncident, explain, handle: createEdgeHandler({ geminiAvailable: () => true, GEMINI_MODEL: 'test', parseIncident, explain }, ['https://dwind-source.github.io']) };
}
const url = 'https://project.supabase.co/functions/v1/waveguard-api';
it('serves status and GitHub Pages preflight through the Supabase route prefix', async () => {
  const { handle } = setup();
  const status = await handle(new Request(url + '/api/status'));
  expect(await status.json()).toEqual({ gemini: true, model: 'test' });
  const preflight = await handle(new Request(url + '/api/incident/parse', { method: 'OPTIONS', headers: { Origin: 'https://dwind-source.github.io' } }));
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get('access-control-allow-origin')).toBe('https://dwind-source.github.io');
});
it('rejects unapproved origins before calling Gemini', async () => {
  const { handle, parseIncident } = setup();
  const r = await handle(new Request(url + '/api/incident/parse', { method: 'POST', headers: { Origin: 'https://other.example' }, body: '{"text":"test"}' }));
  expect(r.status).toBe(403);
  expect(parseIncident).not.toHaveBeenCalled();
});
it.each(['null', '[]', '{bad'])('rejects invalid JSON body %s', async body => {
  const { handle, parseIncident } = setup();
  expect((await handle(new Request(url + '/api/incident/parse', { method: 'POST', body }))).status).toBe(400);
  expect(parseIncident).not.toHaveBeenCalled();
});
it('keeps rejected model output rejected and forwards the requested language', async () => {
  const { handle, parseIncident } = setup();
  const r = await handle(new Request(url + '/api/incident/parse', { method: 'POST', body: JSON.stringify({ text: 'unsupported instruction', lang: 'en' }) }));
  expect(r.status).toBe(422);
  expect(parseIncident).toHaveBeenCalledWith('unsupported instruction', 'en');
});
it('never exposes provider exceptions to the browser', async () => {
  const { handle } = setup();
  const r = await handle(new Request(url + '/api/explain', { method: 'POST', body: '{"evidence":{"duration":120}}' }));
  expect(r.status).toBe(502);
  expect(await r.json()).toEqual({ error: 'gemini_error' });
});
