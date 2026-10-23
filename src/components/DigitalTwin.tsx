import { memo, useMemo, useId } from 'react';
import { buildNetwork } from '../engine/network';
import type { ActionKind, DecisionTrace, Frame, LinkId, NodeId, ScenarioConfig } from '../engine/types';
import { bestForecasts } from '../lib/insights';
import { MAIN_LINE, SIDE_LINES, type LatLon } from '../lib/corridor';
import { tr, usePrefs, type Lang } from '../lib/i18n';
import { engineText } from '../lib/engineText';

/**
 * Digital twin drawn on satellite imagery of the real Kim Mã corridor (Ba Đình, Hà Nội).
 * Coordinates are Web-Mercator pixels at zoom Z; imagery tiles are fetched one level deeper
 * for sharpness. Engine links are mapped proportionally onto the real road geometry, so
 * positions are schematic along the road (the CTM link lengths are not the surveyed ones).
 */

const Z = 17;
const TILE_Z = 18;
const TILE = 256 / 2 ** (TILE_Z - Z);
const TILE_URL = (x: number, y: number) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${TILE_Z}/${y}/${x}`;
const NODES: NodeId[] = ['A', 'B', 'C'];
const MAIN_LINKS: LinkId[] = ['in-A', 'A-B', 'B-C', 'C-out'];

const NODE_NAME: Record<NodeId, string> = { A: 'Kim Mã × Liễu Giai', B: 'Kim Mã × Ngọc Khánh', C: 'Kim Mã × Núi Trúc' };

type Pt = [number, number];

function worldPx([lat, lon]: LatLon): Pt {
  const s = 256 * 2 ** Z;
  const sin = Math.sin((lat * Math.PI) / 180);
  return [((lon + 180) / 360) * s, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s];
}

// SVG renders in float32, so draw relative to a tile-aligned local origin instead of raw world pixels (~3e7)
const ORIGIN: Pt = (() => {
  const [x, y] = worldPx(MAIN_LINE[0]);
  return [Math.floor(x / TILE) * TILE - 2 * TILE, Math.floor(y / TILE) * TILE - 4 * TILE];
})();

function project(p: LatLon): Pt {
  const [x, y] = worldPx(p);
  return [x - ORIGIN[0], y - ORIGIN[1]];
}

class Polyline {
  pts: Pt[];
  cum: number[];
  constructor(pts: Pt[]) {
    this.pts = pts;
    this.cum = [0];
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  get length() {
    return this.cum[this.cum.length - 1];
  }
  private seg(s: number) {
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i] < s) i++;
    return i;
  }
  at(s: number): { x: number; y: number; nx: number; ny: number } {
    s = Math.max(0, Math.min(this.length, s));
    const i = this.seg(s);
    const [a, b] = [this.pts[i - 1], this.pts[i]];
    const L = this.cum[i] - this.cum[i - 1] || 1;
    const f = (s - this.cum[i - 1]) / L;
    const dx = (b[0] - a[0]) / L;
    const dy = (b[1] - a[1]) / L;
    // right-hand normal (traffic direction → right)
    return { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, nx: -dy, ny: dx };
  }
  path(s0 = 0, s1 = this.length): string {
    const p0 = this.at(s0);
    let d = `M${p0.x.toFixed(1)} ${p0.y.toFixed(1)}`;
    for (let i = 1; i < this.pts.length - 1; i++) if (this.cum[i] > s0 && this.cum[i] < s1) d += `L${this.pts[i][0].toFixed(1)} ${this.pts[i][1].toFixed(1)}`;
    const p1 = this.at(s1);
    return d + `L${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`;
  }
  nearest(p: Pt): number {
    let best = 0;
    let bd = Infinity;
    for (let s = 0; s <= this.length; s += 1) {
      const q = this.at(s);
      const d = Math.hypot(q.x - p[0], q.y - p[1]);
      if (d < bd) [bd, best] = [d, s];
    }
    return best;
  }
}

function buildGeo() {
  const net = buildNetwork();
  const main = new Polyline(MAIN_LINE.map(project));
  const side = Object.fromEntries(NODES.map((n) => [n, new Polyline(SIDE_LINES[n].map(project))])) as Record<NodeId, Polyline>;
  const nodeS = Object.fromEntries(NODES.map((n) => [n, main.nearest(side[n].pts[side[n].pts.length - 1])])) as Record<NodeId, number>;
  const range: Partial<Record<LinkId, [number, number]>> = {
    'in-A': [0, nodeS.A],
    'A-B': [nodeS.A, nodeS.B],
    'B-C': [nodeS.B, nodeS.C],
    'C-out': [nodeS.C, main.length],
  };
  const xs = [...main.pts, ...NODES.flatMap((n) => side[n].pts)].map((p) => p[0]);
  const ys = [...main.pts, ...NODES.flatMap((n) => side[n].pts)].map((p) => p[1]);
  const bbox = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  return { net, main, side, nodeS, range, bbox };
}

const GEO = buildGeo();

function viewBox(compact: boolean) {
  const b = GEO.bbox;
  const padX = 40;
  const top = compact ? 70 : 300;
  const bottom = compact ? 50 : 70;
  return { x: b.x0 - padX, y: b.y0 - top, w: b.x1 - b.x0 + 2 * padX, h: b.y1 - b.y0 + top + bottom };
}

function tilesFor(vb: { x: number; y: number; w: number; h: number }) {
  const out: Array<{ x: number; y: number; tx: number; ty: number }> = [];
  const [ox, oy] = ORIGIN;
  for (let ty = Math.floor((vb.y + oy) / TILE); ty * TILE < vb.y + oy + vb.h; ty++)
    for (let tx = Math.floor((vb.x + ox) / TILE); tx * TILE < vb.x + ox + vb.w; tx++) out.push({ x: tx * TILE - ox, y: ty * TILE - oy, tx, ty });
  return out;
}

const VB_FULL = viewBox(false);
const VB_COMPACT = viewBox(true);
const TILES_FULL = tilesFor(VB_FULL);
const TILES_COMPACT = tilesFor(VB_COMPACT);

function densityColor(ratio: number): string {
  if (ratio < 0.28) return 'rgba(74,222,128,0.55)';
  if (ratio < 0.5) return 'rgba(250,204,21,0.75)';
  if (ratio < 0.72) return 'rgba(249,115,22,0.85)';
  return 'rgba(239,68,68,0.92)';
}

function lightColor(phaseIsMine: boolean, stage: string) {
  if (!phaseIsMine) return '#ef4444';
  if (stage === 'GREEN') return '#22c55e';
  if (stage === 'YELLOW') return '#facc15';
  return '#ef4444';
}

const ACTION_STYLE: Record<ActionKind, { color: string; label: (n: NodeId, lang: Lang) => string }> = {
  MAINTAIN: { color: '#94a3b8', label: (_, l) => tr(l, 'Giữ pha hiện tại', 'Hold current phase') },
  EXTEND: { color: '#22c55e', label: (_, l) => tr(l, 'Kéo dài xanh trục chính', 'Extend main-road green') },
  SWITCH: { color: '#fb923c', label: (_, l) => tr(l, 'Đổi pha', 'Switch phase') },
  METER: { color: '#22d3ee', label: (n, l) => tr(l, `Điều tiết dòng vào ${GEO.net.mainOut[n]}`, `Meter flow into ${GEO.net.mainOut[n]}`) },
  FALLBACK: { color: '#a78bfa', label: (_, l) => tr(l, 'Chu kỳ cố định (dự phòng)', 'Fixed cycle (fallback)') },
};

function latestDecision(list: DecisionTrace[] | undefined, t: number): DecisionTrace | null {
  if (!list?.length || list[0].t > t) return null;
  let lo = 0;
  let hi = list.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (list[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return list[lo];
}

const fmtMs = (ms: number) => `${ms < 0.1 ? ms.toFixed(3) : ms.toFixed(2)} ms`;
const fmtClock = (t: number) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export interface DigitalTwinProps {
  frame: Frame;
  /** 0..1 progress between this frame and the next (for smooth vehicle motion) */
  progress: number;
  scenario: ScenarioConfig;
  /** WaveGuard decision log; enables the per-intersection callouts */
  decisions?: DecisionTrace[];
  compact?: boolean;
  showPrediction?: boolean;
  selectedNode?: NodeId | null;
  onNodeClick?: (n: NodeId) => void;
  title?: string;
}

function DigitalTwinImpl({ frame, progress, scenario, decisions, compact = false, showPrediction = true, selectedNode, onNodeClick, title }: DigitalTwinProps) {
  const uid = useId().replace(/:/g, "");
  const { net, main, side, nodeS, range } = GEO;
  const vb = compact ? VB_COMPACT : VB_FULL;
  const tiles = compact ? TILES_COMPACT : TILES_FULL;
  const k = compact ? 1.6 : 1.3; // label scale
  const { lang } = usePrefs();
  const t = (vi: string, en: string) => tr(lang, vi, en);

  const mainPos = (l: LinkId, m: number) => {
    const [r0, r1] = range[l]!;
    return r0 + (Math.max(0, Math.min(net.links[l].lengthM, m)) / net.links[l].lengthM) * (r1 - r0);
  };

  const byNode = useMemo(() => {
    const out: Partial<Record<NodeId, DecisionTrace[]>> = {};
    for (const d of decisions ?? []) (out[d.node] ??= []).push(d);
    return out;
  }, [decisions]);

  const vehicles = useMemo(() => {
    const dots: Array<{ x: number; y: number; key: string; stopped: boolean }> = [];
    for (const l of net.linkList) {
      for (let i = 0; i < l.numCells; i++) {
        const c = l.cellStart + i;
        const count = Math.round(frame.cells[c]);
        if (count <= 0) continue;
        const off = progress * frame.moveFrac[c];
        const stopped = frame.moveFrac[c] < 0.5;
        if (l.kind === 'main') {
          const slots = Math.ceil(count / 2);
          for (let j = 0; j < count; j++) {
            const lane = j % 2 ? 1 : -1;
            const fx = (Math.floor(j / 2) + 0.5) / slots + off;
            const p = main.at(mainPos(l.id, ((i + fx) / l.numCells) * l.lengthM));
            dots.push({ x: p.x + p.nx * 2.6 * lane, y: p.y + p.ny * 2.6 * lane, key: `${c}-${j}`, stopped });
          }
        } else {
          const sl = side[l.to as NodeId];
          for (let j = 0; j < count; j++) {
            const fy = (j + 0.5) / count + off;
            const p = sl.at(((i + fy) / l.numCells) * (sl.length - 6));
            dots.push({ x: p.x, y: p.y, key: `${c}-${j}`, stopped });
          }
        }
      }
    }
    return dots;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, progress]);

  const forecasts = showPrediction ? bestForecasts(frame) : [];
  const incidents = scenario.incidents.filter((i) => i.type !== 'demand_surge' && frame.t >= i.startS && frame.t < i.startS + i.durationS);
  const upstreamLink: Partial<Record<LinkId, LinkId>> = { 'A-B': 'in-A', 'B-C': 'A-B', 'C-out': 'B-C' };
  const nodePt = (n: NodeId) => main.at(nodeS[n]);

  const labels: Array<{ text: string; at: Pt; anchor?: 'start' | 'middle' | 'end' }> = [
    { text: 'Kim Mã', at: [main.at(30).x, main.at(30).y - 14], anchor: 'start' },
    { text: 'Nguyễn Chí Thanh', at: [side.A.pts[0][0] - 10, side.A.pts[0][1] + 14], anchor: 'end' },
    { text: 'Ngọc Khánh', at: [side.B.pts[0][0] + 10, side.B.pts[0][1] + 14], anchor: 'start' },
    { text: 'Núi Trúc', at: [side.C.pts[0][0] + 12, side.C.pts[0][1] + 14], anchor: 'start' },
    { text: 'Giang Văn Minh', at: [main.at(main.length).x - 4, main.at(main.length).y + 24], anchor: 'end' },
  ];

  return (
    <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} className="w-full h-auto select-none rounded-xl" style={{ background: '#0b1220' }} role="img" aria-label={title ?? t('Mô phỏng giao thông 3 nút A, B, C trên phố Kim Mã', 'Traffic simulation of intersections A, B, C on Kim Mã street')}>
      <defs>
        <clipPath id={`${uid}-clip`}>
          <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} rx={compact ? 10 : 14} />
        </clipPath>
        <linearGradient id={`${uid}-vignette`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#030816" stopOpacity={compact ? 0.35 : 0.7} />
          <stop offset="0.35" stopColor="#030816" stopOpacity="0.25" />
          <stop offset="1" stopColor="#030816" stopOpacity="0.55" />
        </linearGradient>
        <filter id={`${uid}-glow`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id={`${uid}-shadow`} x="-20%" y="-20%" width="140%" height="160%">
          <feDropShadow dx="0" dy="3" stdDeviation="4" floodColor="#000" floodOpacity="0.45" />
        </filter>
      </defs>

      <g clipPath={`url(#${uid}-clip)`}>
        {/* satellite imagery */}
        <g style={{ filter: 'saturate(0.8) brightness(0.82) contrast(1.05)' }}>
          {tiles.map((t) => (
            <image key={`${t.tx}-${t.ty}`} href={TILE_URL(t.tx, t.ty)} x={t.x} y={t.y} width={TILE + 0.5} height={TILE + 0.5} preserveAspectRatio="none" />
          ))}
        </g>
        <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill={`url(#${uid}-vignette)`} />

        {/* road network (thin lines, like a routing graph) */}
        <path d={main.path()} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth={14} strokeLinecap="round" strokeLinejoin="round" />
        {NODES.map((n) => (
          <path key={`sr-${n}`} d={side[n].path()} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" />
        ))}

        {/* current congestion (cell density) */}
        {net.linkList.map((l) =>
          Array.from({ length: l.numCells }, (_, i) => {
            const c = l.cellStart + i;
            const ratio = frame.cells[c] / net.cellCap[c];
            if (ratio < 0.12) return null;
            if (l.kind === 'main') {
              const s0 = mainPos(l.id, (i / l.numCells) * l.lengthM);
              const s1 = mainPos(l.id, ((i + 1) / l.numCells) * l.lengthM);
              return <path key={`d${c}`} d={main.path(s0, s1 + 0.6)} fill="none" stroke={densityColor(ratio)} strokeWidth={11} />;
            }
            const sl = side[l.to as NodeId];
            const L = sl.length - 6;
            return <path key={`d${c}`} d={sl.path((i / l.numCells) * L, ((i + 1) / l.numCells) * L + 0.6)} fill="none" stroke={densityColor(ratio)} strokeWidth={7} />;
          }),
        )}

        <path d={main.path()} fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth={1.2} strokeDasharray="1 5" strokeLinecap="round" />

        {/* predicted congestion wave (only where the WaveGuard model predicts a backward-moving queue) */}
        {forecasts.map((f) => {
          if (f.queueTailM === null || f.shockSpeed === null || f.shockSpeed > -0.05 || f.projectedTailM === null || f.confidence < 0.5 || f.risk < 0.3) return null;
          if (!range[f.linkId]) return null;
          const s1 = mainPos(f.linkId, f.queueTailM);
          let s0 = mainPos(f.linkId, f.projectedTailM);
          const spill = f.projectedTailM < 0 ? upstreamLink[f.linkId] : undefined;
          if (spill) s0 = mainPos(spill, net.links[spill].lengthM - Math.min(net.links[spill].lengthM, -f.projectedTailM));
          const lp = main.at(s0);
          return (
            <g key={`pred-${f.linkId}`}>
              <path d={main.path(s0, s1)} fill="none" stroke="rgba(251,146,60,0.35)" strokeWidth={22} />
              <path className="wave-pred" d={main.path(s0, s1)} fill="none" stroke="#fdba74" strokeWidth={2.5} strokeDasharray="8 4" transform="translate(0,-14)" />
              {!compact && (
                <text x={lp.x} y={lp.y - 22} fill="#fed7aa" fontSize={15} fontWeight={600} stroke="#030816" strokeWidth={3} paintOrder="stroke">
                  ◀ {t('dự báo sóng ùn', 'predicted queue wave')} · {Math.abs(f.shockSpeed).toFixed(1)} m/s
                </text>
              )}
            </g>
          );
        })}

        {/* vehicles */}
        {vehicles.map((v) => (
          <circle key={v.key} cx={v.x} cy={v.y} r={compact ? 2.8 : 2.4} fill={v.stopped ? '#fdba74' : '#f8fafc'} stroke="#020617" strokeWidth={0.6} />
        ))}

        {/* street labels */}
        {labels.map((l) => (
          <text key={l.text} x={l.at[0]} y={l.at[1]} textAnchor={l.anchor} fontSize={11 * k} fill="#e2e8f0" stroke="#030816" strokeWidth={3} paintOrder="stroke" fontWeight={500}>
            {l.text}
          </text>
        ))}

        {/* incident markers */}
        {incidents.map((inc) => {
          if (!range[inc.linkId]) return null;
          const p = main.at(mainPos(inc.linkId, inc.positionFrac * net.links[inc.linkId].lengthM));
          return (
            <g key={inc.id}>
              <circle className="pulse-ring" cx={p.x} cy={p.y} r={20} fill="none" stroke="#ef4444" strokeWidth={2} />
              <circle cx={p.x} cy={p.y} r={9 * k} fill="#7f1d1d" stroke="#fca5a5" strokeWidth={2} filter={`url(#${uid}-glow)`} />
              <text x={p.x} y={p.y + 4 * k} fontSize={12 * k} fontWeight={800} fill="#fff" textAnchor="middle">
                !
              </text>
              <g transform={`translate(${p.x + 14},${p.y + 14})`}>
                <rect width={128 * k} height={22 * k} rx={11 * k} fill="#450a0a" stroke="#ef4444" opacity={0.95} />
                <text x={64 * k} y={15 * k} fontSize={11 * k} fill="#fecaca" textAnchor="middle">
                  {t('Sự cố', 'Incident')} · −{Math.round(inc.capacityReduction * 100)}% {t('năng lực', 'capacity')}
                </text>
              </g>
            </g>
          );
        })}

        {/* risk communication between intersections */}
        {frame.activeMessages.map((m) => {
          const a = nodePt(m.source);
          const b = nodePt(m.target);
          const life = Math.max(0, Math.min(1, (m.expiry - frame.t) / Math.max(1, m.expiry - m.timestamp)));
          const d = `M ${a.x} ${a.y - 14} Q ${(a.x + b.x) / 2} ${Math.min(a.y, b.y) - 120} ${b.x} ${b.y - 14}`;
          return (
            <g key={m.id} opacity={0.3 + 0.7 * life}>
              <path d={d} fill="none" stroke="#22d3ee" strokeWidth={1.5 + 3 * m.risk * m.confidence} strokeDasharray={m.confidence < 0.5 ? '4 4' : undefined} filter={`url(#${uid}-glow)`} />
              <circle r={4} fill="#cffafe">
                <animateMotion dur="1.4s" repeatCount="indefinite" path={d} />
              </circle>
              {!compact && life > 0.6 && (
                <text x={(a.x + b.x) / 2} y={Math.min(a.y, b.y) - 72} fill="#a5f3fc" fontSize={15} textAnchor="middle" stroke="#030816" strokeWidth={3} paintOrder="stroke">
                  {m.source}→{m.target} · {t('rủi ro', 'risk')} {m.risk.toFixed(2)}
                </text>
              )}
            </g>
          );
        })}

        {/* entrance queue */}
        {frame.entryQueues['in-A'] > 0.5 && (
          <g transform={`translate(${main.at(0).x + 4},${main.at(0).y - 40})`}>
            <rect width={104 * k} height={22 * k} rx={11 * k} fill="#450a0a" stroke="#ef4444" />
            <text x={52 * k} y={15 * k} fill="#fecaca" fontSize={11 * k} textAnchor="middle">
              +{Math.round(frame.entryQueues['in-A'])} {t('xe chờ vào', 'veh waiting')}
            </text>
          </g>
        )}

        {/* link occupancy */}
        {MAIN_LINKS.map((l) => {
          const [r0, r1] = range[l]!;
          const p = main.at((r0 + r1) / 2);
          const occ = frame.linkOccupancy[l];
          return (
            <text key={l} x={p.x} y={p.y + 26 * k} fontSize={11 * k} textAnchor="middle" fill={occ > 0.7 ? '#fca5a5' : occ > 0.45 ? '#fdba74' : '#cbd5e1'} stroke="#030816" strokeWidth={3} paintOrder="stroke">
              {l} · {Math.round(occ * 100)}%
            </text>
          );
        })}

        {/* decision callouts (WaveGuard only) */}
        {!compact &&
          decisions &&
          NODES.map((n) => {
            const d = latestDecision(byNode[n], frame.t);
            const p = nodePt(n);
            const cw = (vb.w - 48) / 3;
            const cx = vb.x + 12 + NODES.indexOf(n) * (cw + 12);
            const cy = vb.y + 14;
            const action = frame.actions[n] ?? d?.selected ?? 'MAINTAIN';
            const st = ACTION_STYLE[action];
            const s = frame.signals[n];
            const msg = d?.receivedMessages[d.receivedMessages.length - 1];
            const occ = frame.linkOccupancy[net.mainOut[n]];
            return (
              <g key={`card-${n}`}>
                <line x1={p.x} y1={p.y - 16} x2={Math.max(cx + 20, Math.min(cx + cw - 20, p.x))} y2={cy + 246} stroke="rgba(255,255,255,0.55)" strokeWidth={1} />
                <foreignObject x={cx} y={cy} width={cw} height={250}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 15, fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' }}>
                    <span style={{ alignSelf: 'flex-start', background: 'rgba(0,0,0,.75)', color: '#fff', borderRadius: 4, padding: '2px 6px', fontSize: 14, fontWeight: 600 }}>
                      {n} · {NODE_NAME[n]}
                    </span>
                    <div style={{ background: 'rgba(255,255,255,.96)', color: '#0f172a', border: `2px solid ${st.color}`, borderRadius: 8, padding: '8px 10px', boxShadow: '0 6px 16px rgba(0,0,0,.35)' }}>
                      <div style={{ fontWeight: 600, lineHeight: 1.2 }}>
                        {t('Nút', 'Node')} {n} · {s.phase === 'MAIN' ? t('Trục chính', 'Main road') : t('Đường ngang', 'Side street')}{' '}
                        <span style={{ fontWeight: 400, color: '#64748b' }}>
                          {s.stage === 'GREEN' ? t('xanh', 'green') : s.stage === 'YELLOW' ? t('vàng', 'amber') : t('đỏ', 'red')} {Math.round(s.elapsed)}s
                        </span>
                      </div>
                      <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.2, marginTop: 2 }}>
                        {t('Hàng chờ', 'Queue')} {d?.state.mainQueue != null ? d.state.mainQueue.toFixed(0) : '—'} {t('xe', 'veh')} · {t('ngang', 'side')} {d?.state.sideQueue != null ? d.state.sideQueue.toFixed(0) : '—'} {t('xe', 'veh')} · {t('hạ lưu', 'downstream')} {Math.round(occ * 100)}%
                      </div>
                      <div style={{ marginTop: 4, lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {frame.sensorFault.includes(n)
                          ? t('Mất tín hiệu cảm biến — không suy đoán, dùng chu kỳ an toàn.', 'Sensor offline — no guessing, running a safe cycle.')
                          : msg
                            ? t(
                                `Nhận cảnh báo ${msg.path.join('→')}: rủi ro ${msg.risk.toFixed(2)}${msg.timeToCapacity != null ? `, đầy sau ~${Math.round(msg.timeToCapacity)}s` : ''}. Xử lý thế nào?`,
                                `Warning ${msg.path.join('→')}: risk ${msg.risk.toFixed(2)}${msg.timeToCapacity != null ? `, full in ~${Math.round(msg.timeToCapacity)}s` : ''}. What next?`,
                              )
                            : d
                              ? engineText(d.reason, lang)
                              : t('Đang quan sát dòng xe…', 'Observing traffic…')}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,.92)', color: '#0f172a', border: `2px solid ${st.color}`, borderRadius: 8, padding: '6px 10px', fontWeight: 600, boxShadow: '0 4px 10px rgba(0,0,0,.3)' }}>
                      <span>{d ? (action === 'SWITCH' ? `${t('Đổi pha', 'Switch')} → ${s.phase === 'MAIN' ? t('trục chính', 'main road') : t('đường ngang', 'side street')}` : st.label(n, lang)) : t('Đang chờ quyết định…', 'Awaiting decision…')}</span>
                      {d && <span style={{ fontSize: 13, fontWeight: 400, color: '#64748b' }}>{fmtMs(d.decisionTimeMs)}</span>}
                    </div>
                  </div>
                </foreignObject>
              </g>
            );
          })}

        {/* intersections, lights, risk halos */}
        {NODES.map((n) => {
          const p = nodePt(n);
          const s = frame.signals[n];
          const risk = Math.max(frame.pheromone[n] ?? 0, ...frame.forecasts.filter((f) => f.observer === n && f.linkId === net.mainOut[n]).map((f) => f.risk));
          const action = frame.actions[n];
          const fault = frame.sensorFault.includes(n);
          const sel = selectedNode === n;
          const ring = action ? ACTION_STYLE[action].color : '#e2e8f0';
          return (
            <g
              key={n}
              onClick={() => onNodeClick?.(n)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNodeClick?.(n); } }}
              role={onNodeClick ? 'button' : undefined}
              tabIndex={onNodeClick ? 0 : undefined}
              aria-label={t(`Nút ${n}: xem quyết định`, `Node ${n}: view decision`)}
              style={{ cursor: onNodeClick ? 'pointer' : 'default' }}
            >
              {risk >= 0.3 && <circle className="pulse-ring" cx={p.x} cy={p.y} r={22} fill="none" stroke={risk >= 0.7 ? '#ef4444' : '#fb923c'} strokeWidth={2} />}
              <circle cx={p.x} cy={p.y} r={15 * k} fill="rgba(3,8,22,0.85)" stroke={fault ? '#64748b' : ring} strokeWidth={sel ? 4 : 2.5} filter={`url(#${uid}-shadow)`} />
              <text x={p.x} y={p.y + 5 * k} fill="#fff" fontSize={14 * k} fontWeight={700} textAnchor="middle">
                {n}
              </text>
              {/* signal heads: mainline (top) and side street (bottom) */}
              <g transform={`translate(${p.x + 19 * k},${p.y - 13 * k})`}>
                <rect width={11 * k} height={26 * k} rx={5 * k} fill="#020617" stroke="#475569" />
                <circle cx={5.5 * k} cy={7 * k} r={3.4 * k} fill={lightColor(s.phase === 'MAIN', s.stage)} />
                <circle cx={5.5 * k} cy={19 * k} r={3.4 * k} fill={lightColor(s.phase === 'SIDE', s.stage)} />
              </g>
              {fault && (
                <text x={p.x} y={p.y - 22 * k} fontSize={11 * k} fill="#cbd5e1" textAnchor="middle" stroke="#030816" strokeWidth={3} paintOrder="stroke">
                  {t('mất cảm biến', 'sensor offline')}
                </text>
              )}
            </g>
          );
        })}

        {/* footer chips */}
        <g transform={`translate(${vb.x + 12},${vb.y + vb.h - 12 - 20 * k})`}>
          <rect width={(compact ? 150 : 270) * k} height={20 * k} rx={4} fill="rgba(0,0,0,0.7)" />
          <text x={8} y={14 * k} fontSize={10.5 * k} fill="#e2e8f0">
            {compact ? `${t('Mô phỏng', 'Simulation')} · ${fmtClock(frame.t)}` : `${t('Bản ghi mô phỏng', 'Recorded simulation')} · ${fmtClock(frame.t)} · Kim Mã, Ba Đình, ${t('Hà Nội', 'Hanoi')}`}
          </text>
        </g>
        <text x={vb.x + vb.w - 10} y={vb.y + vb.h - 8} fontSize={8 * k} fill="rgba(226,232,240,0.7)" textAnchor="end">
          {t('Ảnh vệ tinh', 'Imagery')} © Esri, Maxar · {t('Đường', 'Roads')} © OpenStreetMap
        </text>
      </g>
    </svg>
  );
}

export const DigitalTwin = memo(DigitalTwinImpl);
