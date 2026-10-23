import type { RequestHandler } from 'express';

// CORS controls browser access; limits also apply to clients without Origin.
export function apiAccess(origins: string[], now = Date.now): RequestHandler {
  const allowed = new Set(origins);
  const windows = new Map<string, { start: number; count: number }>();
  return (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    const origin = req.headers.origin;
    if (origin) {
      res.vary('Origin');
      const sameOrigin = origin === `${req.protocol}://${req.get('host')}`;
      if (!sameOrigin && !allowed.has(origin)) {
        res.status(403).json({ error: 'origin_not_allowed' }); return;
      }
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
    if (req.method !== 'POST') { next(); return; }
    const time = now();
    for (const [key, value] of windows) if (time - value.start >= 60000) windows.delete(key);
    for (const [key, limit] of [['global', 60], [`ip:${req.ip}`, 12]] as const) {
      const value = windows.get(key) ?? { start: time, count: 0 };
      windows.set(key, value);
      if (++value.count > limit) {
        res.setHeader('Retry-After', '60');
        res.status(429).json({ error: 'rate_limit' }); return;
      }
    }
    next();
  };
}
