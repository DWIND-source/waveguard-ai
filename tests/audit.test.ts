import { describe, expect, it } from 'vitest';
import { compareControllers, runSimulation } from '../src/engine/simulator';
import { getScenario } from '../src/engine/scenarios';
import { benchmarkJson, reportHtml, computeComparison, displayValue, seriesCsv } from '../src/engine/report';
import { validateParsedIncident } from '../src/shared/incident';
import { seriesAt } from '../src/lib/sessionSeries';
import { engineText } from '../src/lib/engineText';

describe('audit: evidence integrity', () => {
  const runs = compareControllers(getScenario('incident'), ['fixed', 'waveguard']);
  it('exports exact session data to JSON and rounded measurements to HTML/CSV', () => {
    const json = benchmarkJson(runs);
    expect(json.controllers.waveguard.metrics).toEqual(runs.waveguard.metrics);
    expect(json.controllers.waveguard.events).toEqual(runs.waveguard.events);
    const html = reportHtml({ lang: 'en', runs, incidentText: '<script>bad()</script>', confirmedSummary: 'Test incident', assumptions: [], geminiExplanation: null, geminiModel: null });
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    for (const row of computeComparison(runs.fixed, runs.waveguard)) {
      expect(html).toContain(displayValue(row.key, row.proposed));
      expect(html).toContain(row.labelEn);
    }
    const rows = seriesCsv(runs).split('\n').slice(1).map((r) => r.split(','));
    for (const [kind, run] of Object.entries(runs)) {
      const exported = rows.filter((r) => r[0] === kind);
      expect(exported).toHaveLength(run.series.length);
      run.series.forEach((p, i) => {
        expect(Number(exported[i][1])).toBe(p.t);
        expect(Number(exported[i][3])).toBeCloseTo(p.cumWaiting, 0);
      });
    }
  });
  it('never shows future samples; the final sample remains reachable', () => {
    expect(seriesAt(runs.waveguard, 1)).toBeNull();
    expect(seriesAt(runs.waveguard, 19)?.t).toBe(10);
    expect(seriesAt(runs.waveguard, runs.waveguard.scenario.durationS)).toEqual(runs.waveguard.series.at(-1));
  });
  it('all engine warning events correspond to actual emitted messages', () => {
    const run = runs.waveguard;
    const events = run.events.filter((e) => e.kind === 'warning');
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) expect(run.messages.some((m) => m.timestamp === event.t && m.linkId === event.linkId)).toBe(true);
  });
  it('does not emit risk warnings on an empty-demand normal scenario', () => {
    const run = runSimulation({ ...getScenario('normal'), demand: { main: 0, side: { A: 0, B: 0, C: 0 } } }, 'waveguard');
    expect(run.events.filter((e) => e.kind === 'warning' || e.kind === 'spillback')).toEqual([]);
  });
  it('translates engine event text for the English session', () => {
    for (const event of runs.waveguard.events) expect(engineText(event.text, 'en')).not.toMatch(/Sự cố|năng lực|cảnh báo|Hàng chờ|Đoạn|Nút/);
  });
});

describe('audit: Gemini numeric validation', () => {
  const payload = { incidentType: 'road_blockage', affectedNode: 'C', affectedLink: 'B-C', summary: 'Test', capacityReduction: 0.5, durationSeconds: 3000 };
  it('does not turn 50 minutes into 50% capacity loss', () => {
    const result = validateParsedIncident(payload, 'Truck blocked for 50 minutes.');
    expect(result.value?.capacityReduction).toBeNull();
    expect(result.value?.durationSeconds).toBe(3000);
  });
  it('does not infer a duration from a percentage', () => {
    const result = validateParsedIncident(payload, 'Capacity reduced by 50%.');
    expect(result.value?.capacityReduction).toBe(0.5);
    expect(result.value?.durationSeconds).toBeNull();
  });
  it('discards unsupported executable fields and unknown missing-information fields', () => {
    const result = validateParsedIncident({ ...payload, execute: 'shell', missingInformation: ['execute'] }, 'Capacity reduced by 50%.');
    expect(result.value).not.toHaveProperty('execute');
    expect(result.value?.missingInformation).not.toContain('execute');
  });
});
