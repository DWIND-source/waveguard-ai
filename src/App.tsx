import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Info, Loader2, Moon, Sun, Waves } from 'lucide-react';
import { DEFAULT_CONFIG } from './engine/network';
import { compareControllers } from './engine/simulator';
import { DISCLAIMER, DISCLAIMER_EN } from './engine/report';
import { usePrefs, useT } from './lib/i18n';
import { engineText } from './lib/engineText';
import type { ControllerKind, EngineConfig, NodeId, ScenarioConfig, SimulationRun } from './engine/types';
import { applyIncidentToScenario, type ConfirmedIncident } from './shared/incident';
import { getStatus, parseIncidentText, type ApiStatus } from './lib/api';
import { assumptionText, baseScenario, confirmedSummary, draftFromParsed, PRESETS, type Preset } from './lib/presets';
import { IncidentPanel } from './components/IncidentPanel';
import { ConfirmPanel } from './components/ConfirmPanel';
import { DigitalTwin } from './components/DigitalTwin';
import { InsightPanel, type Uncertainty } from './components/InsightPanel';
import { Timeline } from './components/Timeline';
const Comparison = lazy(() => import('./components/Comparison').then((m) => ({ default: m.Comparison })));
import { ReportSection } from './components/ReportSection';
import { NodeInspector } from './components/NodeInspector';
import { ResearchMode } from './components/ResearchMode';

type Runs = Partial<Record<ControllerKind, SimulationRun>>;

export default function App() {
  const { lang, setLang, theme, setTheme } = usePrefs();
  const t = useT();
  const disclaimer = lang === 'en' ? DISCLAIMER_EN : DISCLAIMER;
  const [status, setStatus] = useState<ApiStatus | null>(null);
  const [text, setText] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ConfirmedIncident | null>(null);
  const [parseMeta, setParseMeta] = useState<{ model: string | null; removed: string[]; missing: string[] }>({ model: null, removed: [], missing: [] });
  const [confirmed, setConfirmed] = useState<ConfirmedIncident | null>(null);
  const [runText, setRunText] = useState('');
  const [config, setConfig] = useState<EngineConfig>(DEFAULT_CONFIG);
  const [seed, setSeed] = useState(2026);
  const [includeMP, setIncludeMP] = useState(false);
  const [scenario, setScenario] = useState<ScenarioConfig | null>(null);
  const [runs, setRuns] = useState<Runs | null>(null);
  const [preview, setPreview] = useState(true);
  const [busy, setBusy] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [sessionId, setSessionId] = useState(0);
  const [uncertainty, setUncertainty] = useState<Uncertainty | null>(null);
  const [selectedNode, setSelectedNode] = useState<NodeId | null>(null);

  // playback
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(30);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const twinRef = useRef<HTMLDivElement>(null);
  const uncertaintyGeneration = useRef(0);
  const parseGeneration = useRef(0);
  useEffect(() => () => { ++uncertaintyGeneration.current; ++parseGeneration.current; }, []);

  const duration = runs?.waveguard ? runs.waveguard.frames.at(-1)?.t ?? 0 : 0;

  useEffect(() => {
    getStatus().then(setStatus);
  }, []);

  // ambient preview: normal traffic, real engine, looped
  useEffect(() => {
    const sc = { ...baseScenario(seed), demand: { main: 0.45, side: { A: 0.06, B: 0.07, C: 0.06 } }, durationS: 600, name: 'Giao thông bình thường (xem trước)' };
    setScenario(sc);
    setRuns(compareControllers(sc, ['fixed', 'waveguard'], config));
    setPreview(true);
    setTime(1);
    setPlaying(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!playing || !duration) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      // rAF timestamps can precede the performance.now() taken at setup, so clamp at 0
      const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
      last = now;
      setTime((t) => {
        const nt = t + dt * speedRef.current;
        if (nt >= duration) {
          if (preview) return 1;
          setPlaying(false);
          return duration;
        }
        return nt;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, duration, preview]);

  const computeUncertainty = useCallback((sc: ScenarioConfig, cfg: EngineConfig) => {
    const generation = ++uncertaintyGeneration.current;
    setUncertainty(null);
    const seeds = [1, 2, 3, 4, 5].map((i) => sc.seed + i);
    const out: number[] = [];
    let i = 0;
    const step = () => {
      if (generation !== uncertaintyGeneration.current) return;
      const r = compareControllers({ ...sc, seed: seeds[i] }, ['fixed', 'waveguard'], cfg, { recordFrames: false });
      const baseline = r.fixed.metrics.cumulativeWaitingVehS;
      if (baseline > 0) out.push(((r.waveguard.metrics.cumulativeWaitingVehS - baseline) / baseline) * 100);
      i++;
      if (i < seeds.length) setTimeout(step, 0);
      else setUncertainty({ seeds, waitChangePct: out });
    };
    setTimeout(step, 50);
  }, []);

  const runScenario = useCallback(
    (inc: ConfirmedIncident, incidentText: string, opts: { demo?: boolean; cfg?: EngineConfig; seedOverride?: number } = {}) => {
      const cfg = opts.cfg ?? config;
      const sd = opts.seedOverride ?? seed;
      setBusy(true);
      ++uncertaintyGeneration.current;
      setUncertainty(null);
      setPlaying(false);
      setSelectedNode(null);
      setTimeout(() => {
        const sc = applyIncidentToScenario(baseScenario(sd), inc);
        const kinds: ControllerKind[] = includeMP ? ['fixed', 'maxpressure', 'waveguard'] : ['fixed', 'waveguard'];
        const r = compareControllers(sc, kinds, cfg);
        setScenario(sc);
        setRuns(r);
        setSessionId((id) => id + 1);
        setPreview(false);
        setConfirmed(inc);
        setRunText(incidentText);
        setDemoMode(Boolean(opts.demo));
        setTime(1);
        setPlaying(true);
        setBusy(false);
        computeUncertainty(sc, cfg);
        requestAnimationFrame(() => twinRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      }, 30);
    },
    [config, seed, includeMP, computeUncertainty],
  );

  useEffect(() => { ++parseGeneration.current; setAnalyzing(false); setError(null); }, [lang]);

  const onAnalyze = async () => {
    if (analyzing || !text.trim()) return;
    setError(null);
    if (!status?.gemini) {
      // Gemini unavailable: clearly labelled manual controls, never a fake AI response
      setDraft({ ...PRESETS[0].draft, summary: text.trim() || PRESETS[0].draft.summary, source: 'manual', assumptions: ['capacityReduction', 'durationSeconds'] });
      setParseMeta({ model: null, removed: [], missing: [] });
      setError(status ? t('Gemini không khả dụng trong bản triển khai này nên không thể tự động phân tích mô tả. Vui lòng chọn tham số thủ công bên dưới.', 'Gemini is unavailable in this deployment, so the description cannot be analysed automatically. Please choose the parameters manually below.') : null);
      return;
    }
    setAnalyzing(true);
    const request = ++parseGeneration.current;
    try {
      const res = await parseIncidentText(text, lang);
      if (request !== parseGeneration.current) return;
      setDraft(draftFromParsed(res.parsed));
      setParseMeta({ model: res.model, removed: res.removedUnsupported, missing: res.parsed.missingInformation });
      if (res.errors.length) setError(t(`Gemini trả về một số trường không hợp lệ đã bị loại bỏ: ${res.errors.join('; ')}`, `Gemini returned some invalid fields, which were removed: ${res.errors.join('; ')}`));
    } catch (e) {
      if (request !== parseGeneration.current) return;
      setError(t(`Không phân tích được bằng Gemini (${e instanceof Error ? e.message : e}). Bạn có thể nhập tham số thủ công.`, `Gemini could not analyse this (${e instanceof Error ? e.message : e}). You can enter the parameters manually.`));
      setDraft({ ...PRESETS[0].draft, summary: text.trim(), source: 'manual' });
      setParseMeta({ model: null, removed: [], missing: [] });
    } finally {
      if (request === parseGeneration.current) setAnalyzing(false);
    }
  };

  const onPreset = (p: Preset) => {
    ++parseGeneration.current;
    setAnalyzing(false);
    setText(lang === 'en' ? p.textEn : p.text);
    setError(null);
    setDraft({ ...p.draft });
    setParseMeta({ model: null, removed: [], missing: [] });
  };

  const onDemo = () => {
    ++parseGeneration.current;
    setAnalyzing(false);
    const p = PRESETS[0];
    const demoText = lang === 'en' ? p.textEn : p.text;
    setText(demoText);
    setDraft(null);
    setError(null);
    setSpeed(30);
    runScenario({ ...p.draft }, demoText, { demo: true });
  };

  // ?demo=1 opens straight into the one-click demo (shareable link)
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('demo')) onDemo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onConfirm = () => {
    if (!draft) return;
    const d = draft;
    setDraft(null);
    runScenario(d, text);
  };

  const idx = Math.max(0, Math.min((runs?.waveguard?.frames.length ?? 1) - 1, Math.floor(time / (runs?.waveguard?.config.network.dt ?? 1)) - 1));
  const progress = time - Math.floor(time);
  const wgRun = runs?.waveguard;
  const fxRun = runs?.fixed;
  const frame = wgRun?.frames[idx];
  const finished = !preview && duration > 0 && time >= duration;

  const events = useMemo(() => {
    if (!wgRun || !fxRun) return [];
    const extra = fxRun.events.filter((e) => e.kind === 'spillback').map((e) => ({ ...e, text: `[Fixed-Time] ${e.text}` }));
    return [...wgRun.events.filter((e) => e.kind !== 'occupancy' || e.linkId !== 'in-A'), ...extra].sort((a, b) => a.t - b.t);
  }, [wgRun, fxRun]);

  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 bg-wg-cyan text-navy-950 px-3 py-1 rounded">
        {t('Bỏ qua tới nội dung chính', 'Skip to main content')}
      </a>
      <header className="border-b border-white/5 bg-navy-950/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
          <Waves className="text-wg-cyan" />
          <span className="font-bold tracking-tight">WaveGuard AI</span>
          <span className="hidden sm:inline text-sm text-slate-400">{t('Phòng thí nghiệm giao thông', 'Traffic systems lab')}</span>
          <span className="ml-auto text-xs text-slate-500 hidden lg:inline">DevFest Cloud Hanoi 2026 · {t('Hỗ trợ quyết định dựa trên mô phỏng', 'Simulation-based decision support')}</span>
          <div className="ml-auto lg:ml-3 flex items-center gap-2">
            <div className="flex rounded-lg border border-white/10 p-0.5 text-xs font-semibold" role="group" aria-label={t('Ngôn ngữ', 'Language')}>
              {(['vi', 'en'] as const).map((l) => (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  aria-pressed={lang === l}
                  className={`px-2.5 py-1 rounded-md transition ${lang === l ? 'bg-wg-cyan text-navy-950' : 'text-slate-300 hover:bg-white/5'}`}
                >
                  {l === 'vi' ? 'VI' : 'EN'}
                </button>
              ))}
            </div>
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="rounded-lg border border-white/10 p-1.5 text-slate-300 hover:bg-white/5"
              aria-label={theme === 'dark' ? t('Chuyển sang giao diện sáng', 'Switch to light theme') : t('Chuyển sang giao diện tối', 'Switch to dark theme')}
              title={theme === 'dark' ? t('Giao diện sáng', 'Light theme') : t('Giao diện tối', 'Dark theme')}
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </div>
      </header>

      <main id="main" className="max-w-7xl mx-auto px-4 pb-16">
        {/* Section A — hero + incident input */}
        <section className="research-hero">
          <div>
            <p className="eyebrow">{t('THỬ NGHIỆM 01 / HỆ THỐNG ĐÔ THỊ', 'EXPERIMENT 01 / URBAN SYSTEMS')}</p>
            <h1>WaveGuard<span className="text-wg-cyan"> AI</span></h1>
            <p className="hero-question">{t('Nếu các nút giao có thể cùng suy nghĩ?', 'What if intersections could think together?')}</p>
            <p className="mt-4 text-slate-400 max-w-2xl">{t('Quan sát dòng xe. Dự báo ùn tắc. Kiểm chứng sự phối hợp trên cùng một kịch bản.', 'Observe traffic flow. Forecast congestion. Test coordination on the same scenario.')}</p>
          </div>
          <aside className="experiment-note">
            <span className="eyebrow">{t('PHẠM VI NGHIÊN CỨU', 'RESEARCH SCOPE')}</span>
            <p className="mt-3 text-sm leading-relaxed">{t('Mô phỏng CTM · 3 nút giao · nhu cầu theo seed. Các điểm xe biểu diễn mật độ, không phải xe được camera nhận diện.', 'CTM simulation · 3 intersections · seeded demand. Vehicle dots represent density, not camera detections.')}</p>
            <p className="mt-3 text-xs text-slate-400">{t('Gemini diễn giải sự cố; thuật toán xác định quyết định tín hiệu.', 'Gemini interprets incidents; deterministic algorithms decide signals.')}</p>
          </aside>
        </section>
        <nav className="demo-path" aria-label={t('Lộ trình demo ba phút', 'Three-minute demo path')}>
          <a href="#incident-h"><b>01 /</b> {t('Chọn sự cố', 'Choose an incident')}</a>
          <a href="#simulation"><b>02 /</b> {t('Theo dõi phối hợp', 'Inspect coordination')}</a>
          <a href="#results"><b>03 /</b> {t('So sánh & xuất bằng chứng', 'Compare & export evidence')}</a>
        </nav>

        <div className="flex flex-col gap-5">
          <IncidentPanel
            status={status}
            text={text}
            onText={setText}
            onAnalyze={onAnalyze}
            onPreset={onPreset}
            onDemo={onDemo}
            onManual={() => {
              setDraft({ ...PRESETS[0].draft, summary: text.trim() || t('Sự cố nhập thủ công', 'Manually entered incident'), source: 'manual' });
              setParseMeta({ model: null, removed: [], missing: [] });
            }}
            analyzing={analyzing}
            error={error}
            demoBusy={busy}
          />
          {draft && (
            <ConfirmPanel draft={draft} onChange={setDraft} onConfirm={onConfirm} onCancel={() => setDraft(null)} model={parseMeta.model} removedUnsupported={parseMeta.removed} missing={parseMeta.missing} />
          )}
        </div>

        {/* Section B + C — digital twin + insight */}
        <div id="simulation" ref={twinRef} className="scroll-mt-20 mt-8">
          <div className="flex flex-wrap items-end justify-between gap-2 mb-3">
            <div>
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <Activity size={20} className="text-wg-cyan" /> {t('Bản sao số hành lang Kim Mã', 'Digital twin of the Kim Mã corridor')} · A → B → C
              </h2>
              <p className="text-sm text-slate-400">
                {preview
                  ? t('Xem trước: giao thông bình thường do WaveGuard điều khiển. Chọn một sự cố hoặc bấm “Chạy demo phối hợp”.', 'Preview: normal traffic under WaveGuard control. Pick an incident or click “Run coordination demo”.')
                  : `${engineText(scenario?.name ?? '', lang)} · ${t('WaveGuard điều khiển · bấm vào nút A, B, C để xem lý do quyết định', 'WaveGuard in control · click node A, B or C to see why it decided')}`}
              </p>
            </div>
            {busy && (
              <span className="inline-flex items-center gap-2 text-sm text-cyan-200">
                <Loader2 size={16} className="animate-spin" /> {t('Đang tính mô phỏng…', 'Computing simulation…')}
              </span>
            )}
          </div>
          {demoMode && (
            <p className="mb-3 text-xs rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-slate-300 flex items-start gap-2">
              <Info size={14} className="shrink-0 mt-0.5" />
              {t('Chế độ demo dùng kịch bản có cấu trúc định sẵn (xe tải hỏng gần C, giảm 70% năng lực — giả định thử nghiệm).', 'Demo mode uses a predefined structured scenario (truck breakdown near C, capacity −70% — test assumption).')}{' '}
              {status === null
                ? null
                : status.gemini
                ? t('Phân tích sự cố bằng Gemini không được dùng cho demo này; hãy nhập mô tả của bạn ở trên để thử.', 'Gemini incident analysis is not used for this demo; type your own description above to try it.')
                : t('Phân tích sự cố bằng AI đang tắt (cần backend Gemini).', 'AI incident analysis is off (Gemini backend required).')}
            </p>
          )}
          {frame && wgRun && fxRun && scenario ? (
            <div className="flex flex-col gap-4">
              <div className="panel p-2 md:p-3 min-w-0">
                <div className="map-viewport" role="region" tabIndex={0} aria-label={t('Bản đồ mô phỏng; cuộn ngang trên màn hình nhỏ', 'Simulation map; scroll horizontally on small screens')}>
                  <DigitalTwin frame={frame} progress={progress} scenario={wgRun.scenario} decisions={wgRun.decisions} selectedNode={selectedNode} onNodeClick={(node) => { setPlaying(false); setSelectedNode(node); }} />
                </div>
                <div className="grid grid-cols-3 gap-2 my-3" aria-label={t('Kiểm tra nút giao', 'Inspect intersections')}>
                  {(['A', 'B', 'C'] as NodeId[]).map((node) => <button key={node} onClick={() => { setPlaying(false); setSelectedNode(node); }} className="border border-white/10 rounded-md p-2 text-sm text-left hover:bg-white/5">
                    <b>{t('Nút', 'Node')} {node}</b><span className="block text-xs text-slate-400 mt-1">{t('Xem quyết định', 'Inspect decision')} ↗</span>
                  </button>)}
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-400 px-1 mt-1 mb-3">
                  <span className="flex items-center gap-1.5">
                    <span className="w-4 h-2 rounded-sm" style={{ background: 'linear-gradient(90deg,#4ade80,#facc15,#f97316,#ef4444)' }} /> {t('Mật độ hiện tại (thấp → kẹt)', 'Current density (low → jammed)')}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-4 h-0 border-t-2 border-dashed border-orange-400" /> {t('Ùn tắc dự báo (sóng lan ngược)', 'Predicted congestion (backward wave)')}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-4 h-0.5 bg-cyan-400" /> {t('Cảnh báo giữa các nút', 'Warnings between nodes')}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-orange-300" /> {t('Xe đang dừng/chậm', 'Stopped/slow vehicles')}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-full border-2 border-cyan-400" /> {t('Nút giao có đèn (viền = hành động)', 'Signalised intersection (ring = action)')}
                  </span>
                  <span className="text-slate-500">{t('Vị trí nút giao là thật; chiều dài đoạn CTM được ánh xạ tỉ lệ lên tuyến đường.', 'Intersection locations are real; CTM link lengths are mapped proportionally onto the road.')}</span>
                </div>
                <Timeline
                  time={time}
                  duration={duration}
                  playing={playing}
                  speed={speed}
                  events={preview ? [] : events}
                  onPlay={() => {
                    if (time >= duration) setTime(1);
                    setPlaying(true);
                  }}
                  onPause={() => setPlaying(false)}
                  onSeek={(t) => setTime(Math.max(1, Math.min(duration, t)))}
                  onReplay={() => {
                    setTime(1);
                    setPlaying(true);
                  }}
                  onSpeed={setSpeed}
                />
              </div>
              <InsightPanel run={wgRun} baseline={fxRun} frame={frame} uncertainty={preview ? null : uncertainty} preview={preview} />
            </div>
          ) : (
            <div className="panel p-10 text-center text-slate-400">{t('Đang khởi tạo mô phỏng…', 'Initialising simulation…')}</div>
          )}
          {finished && <p className="mt-4 rounded-lg bg-orange-500/10 border border-orange-400/30 p-3 text-sm text-orange-100 font-medium text-center">{disclaimer}</p>}
        </div>

        <div id="results" className="scroll-mt-20" />
        {/* Section D — before vs after */}
        {runs?.fixed && runs.waveguard && !preview && (
          <div className="mt-10">
            <Suspense fallback={<p aria-busy="true">{t('Đang tải biểu đồ…', 'Loading charts…')}</p>}><Comparison runs={runs} frameIndex={idx} progress={progress} time={time} finished={finished} /></Suspense>
          </div>
        )}

        {/* Section E — explanation & report */}
        {runs?.fixed && runs.waveguard && !preview && confirmed && (
          <div className="mt-10">
            <ReportSection key={`${sessionId}-${lang}`} runs={runs} incidentText={runText} confirmed={confirmed} confirmedSummary={confirmedSummary(confirmed, lang)} assumptions={assumptionText(confirmed, lang)} geminiReady={Boolean(status?.gemini)} />
          </div>
        )}

        <div className="mt-10">
          <ResearchMode
            config={config}
            onConfig={setConfig}
            seed={seed}
            onSeed={setSeed}
            includeMP={includeMP}
            onIncludeMP={setIncludeMP}
            onRerun={() => confirmed && runScenario(confirmed, runText, { demo: demoMode })}
            scenario={preview ? null : scenario}
            runs={preview ? null : runs}
            time={time}
          />
        </div>

        <footer className="mt-12 text-xs text-slate-500 leading-relaxed">
          {t(
            'WaveGuard AI là nguyên mẫu hỗ trợ quyết định dựa trên mô phỏng (Cell Transmission Model, 3 nút giao), không điều khiển đèn tín hiệu thực. Gemini chỉ diễn giải sự cố và giải thích quyết định; bộ điều khiển là logic xác định có kiểm tra an toàn. Cơ chế lan truyền rủi ro kiểu stigmergy là giả thuyết thiết kế mang tính thử nghiệm.',
            'WaveGuard AI is a simulation-based decision-support prototype (Cell Transmission Model, 3 intersections); it does not control real traffic signals. Gemini only interprets incidents and explains decisions; the controller is deterministic logic with safety checks. Stigmergy-style risk propagation is an experimental design hypothesis.',
          )}{' '}
          {disclaimer}
          <br />
          {t('Ảnh vệ tinh © Esri, Maxar, Earthstar Geographics · Dữ liệu đường © OpenStreetMap contributors (ODbL).', 'Imagery © Esri, Maxar, Earthstar Geographics · Road data © OpenStreetMap contributors (ODbL).')}
        </footer>
      </main>

      {selectedNode && wgRun && frame && <NodeInspector key={`${sessionId}-${selectedNode}-${lang}`} node={selectedNode} run={wgRun} frame={frame} geminiReady={Boolean(status?.gemini)} onClose={() => setSelectedNode(null)} />}
    </div>
  );
}
