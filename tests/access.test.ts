import { afterAll, beforeAll, expect, it } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { apiAccess } from '../server/access';

let server: Server;
let base: string;
let time = 0;
beforeAll(async () => {
  const app = express();
  app.use('/api', apiAccess(['https://dwind-source.github.io'], () => time));
  app.all('/api/test', (_req, res) => res.json({ ok: true }));
  server = await new Promise<Server>(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api/test`;
});
afterAll(() => new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())));
it('allows GitHub Pages preflight without invoking the API', async () => {
  const r = await fetch(base, { method: 'OPTIONS', headers: { Origin: 'https://dwind-source.github.io', 'Access-Control-Request-Method': 'POST' } });
  expect(r.status).toBe(204);
  expect(r.headers.get('access-control-allow-origin')).toBe('https://dwind-source.github.io');
});
it('rejects other browser origins', async () => {
  const r = await fetch(base, { method: 'POST', headers: { Origin: 'https://untrusted.example' } });
  expect(r.status).toBe(403);
  expect(r.headers.get('access-control-allow-origin')).toBeNull();
});
it('limits direct API calls and permits them after the window expires', async () => {
  for (let i = 0; i < 12; i++) expect((await fetch(base, { method: 'POST' })).status).toBe(200);
  const limited = await fetch(base, { method: 'POST' });
  expect(limited.status).toBe(429);
  expect(limited.headers.get('retry-after')).toBe('60');
  time += 60000;
  expect((await fetch(base, { method: 'POST' })).status).toBe(200);
});
