import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiAccess } from './access';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// minimal .env loader (the .env file is git-ignored; never commit API keys)
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const { explain, geminiAvailable, GEMINI_MODEL, parseIncident } = await import('./gemini');

const app = express();
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.use('/api', apiAccess((process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)));
app.use(express.json({ limit: '2mb' }));

app.get('/api/status', (_req, res) => {
  res.json({ gemini: geminiAvailable(), model: geminiAvailable() ? GEMINI_MODEL : null });
});

function errMessage(e: unknown): string {
  const s = e instanceof Error ? e.message : String(e);
  // never echo credentials back
  const key = process.env.GEMINI_API_KEY;
  return (key ? s.split(key).join('[redacted]') : s).replace(/key=[^&\s"]+/gi, 'key=***').slice(0, 300);
}

app.post('/api/incident/parse', async (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, 2000) : '';
  if (!text) return res.status(400).json({ error: 'empty_text', message: 'Vui lòng mô tả sự cố.' });
  if (!geminiAvailable()) return res.status(503).json({ error: 'gemini_unavailable', message: 'Chưa cấu hình GEMINI_API_KEY trên máy chủ.' });
  try {
    const out = await parseIncident(text, req.body?.lang === 'en' ? 'en' : 'vi');
    if (!out.parsed) return res.status(422).json({ error: 'invalid_output', model: out.model });
    res.json(out);
  } catch (e) {
    console.error('[gemini parse]', errMessage(e));
    res.status(502).json({ error: 'gemini_error' });
  }
});

app.post('/api/explain', async (req, res) => {
  const evidence = req.body?.evidence;
  const question = typeof req.body?.question === 'string' ? req.body.question.slice(0, 500) : undefined;
  if (!evidence || typeof evidence !== 'object') return res.status(400).json({ error: 'missing_evidence' });
  if (!geminiAvailable()) return res.status(503).json({ error: 'gemini_unavailable', message: 'Chưa cấu hình GEMINI_API_KEY trên máy chủ.' });
  try {
    res.json(await explain(evidence, question, req.body?.lang === 'en' ? 'en' : 'vi'));
  } catch (e) {
    console.error('[gemini explain]', errMessage(e));
    res.status(502).json({ error: 'gemini_error' });
  }
});

const port = Number(process.env.PORT) || 5173;
if (process.env.NODE_ENV === 'production' || process.argv.includes('--production')) {
  const dist = path.join(root, 'dist');
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ root, server: { middlewareMode: true, hmr: { port: port + 1 } }, appType: 'spa' });
  app.use(vite.middlewares);
}
app.listen(port, process.env.HOST || '0.0.0.0', () => {
  console.log(`WaveGuard AI → http://localhost:${port}  (Gemini: ${geminiAvailable() ? GEMINI_MODEL : 'chưa cấu hình — chế độ thủ công'})`);
});
