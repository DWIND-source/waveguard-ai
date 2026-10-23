import { Pause, Play, RotateCcw, SkipForward } from 'lucide-react';
import type { TimelineEvent } from '../engine/types';
import { usePrefs, useT } from '../lib/i18n';
import { engineText } from '../lib/engineText';

interface Props {
  time: number;
  duration: number;
  playing: boolean;
  speed: number;
  events: TimelineEvent[];
  onPlay: () => void;
  onPause: () => void;
  onSeek: (t: number) => void;
  onReplay: () => void;
  onSpeed: (s: number) => void;
}

const KIND_COLOR: Record<TimelineEvent['kind'], string> = {
  incident: '#ef4444',
  incident_end: '#22c55e',
  warning: '#22d3ee',
  meter: '#22d3ee',
  spillback: '#f97316',
  occupancy: '#fb923c',
  sensor: '#94a3b8',
  sensor_end: '#94a3b8',
  fallback: '#94a3b8',
};

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export function Timeline({ time, duration, playing, speed, events, onPlay, onPause, onSeek, onReplay, onSpeed }: Props) {
  const { lang } = usePrefs();
  const t = useT();
  const end = Math.max(1, duration);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={playing ? onPause : onPlay} className="rounded-lg p-2 bg-white/5 hover:bg-white/10" aria-label={playing ? t('Tạm dừng', 'Pause') : t('Phát', 'Play')}>
          {playing ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <button onClick={onReplay} className="rounded-lg p-2 bg-white/5 hover:bg-white/10" aria-label={t('Phát lại từ đầu', 'Replay from start')}>
          <RotateCcw size={18} />
        </button>
        <button onClick={() => onSeek(end)} className="rounded-lg p-2 bg-white/5 hover:bg-white/10" aria-label={t('Tới kết quả cuối', 'Jump to end')}>
          <SkipForward size={18} />
        </button>
        <span className="font-mono text-sm tabular-nums text-slate-300 w-28">
          {fmt(time)} / {fmt(end)}
        </span>
        <div className="flex items-center gap-1 text-xs ml-auto" role="group" aria-label={t('Tốc độ phát', 'Playback speed')}>
          {[10, 30, 60].map((s) => (
            <button key={s} onClick={() => onSpeed(s)} className={`px-2 py-1 rounded-md ${speed === s ? 'bg-wg-cyan text-navy-950 font-semibold' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}>
              {s}×
            </button>
          ))}
        </div>
      </div>
      <div className="relative h-8">
        <input
          type="range"
          min={1}
          max={end}
          step={1}
          value={Math.floor(time)}
          onChange={(e) => onSeek(Number(e.target.value))}
          className="absolute inset-x-0 top-3 w-full accent-cyan-400"
          aria-label={t('Thời gian mô phỏng', 'Simulation time')}
        />
        {events.map((e, i) => (
          <button
            key={i}
            onClick={() => onSeek(e.t)}
            title={`t=${e.t}s · ${engineText(e.text, lang)}`}
            aria-label={`t=${e.t}s: ${engineText(e.text, lang)}`}
            className="absolute top-0 w-2 h-2 rounded-full -translate-x-1"
            style={{ left: `${Math.min(100, (e.t / Math.max(1, end)) * 100)}%`, background: KIND_COLOR[e.kind] }}
          />
        ))}
      </div>
      <ol className="flex gap-2 overflow-x-auto pb-1 text-xs">
        {events.map((e, i) => (
          <li key={i}>
            <button
              onClick={() => onSeek(e.t)}
              className={`whitespace-nowrap px-2.5 py-1 rounded-full border transition ${time >= e.t ? 'border-white/25 text-slate-100' : 'border-white/10 text-slate-500'}`}
            >
              <span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle" style={{ background: KIND_COLOR[e.kind] }} />
              {fmt(e.t)} {engineText(e.text, lang)}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
