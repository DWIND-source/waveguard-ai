import { mkdirSync, writeFileSync } from 'node:fs';
import { compareControllers } from '../src/engine/simulator';
import { applyIncidentToScenario } from '../src/shared/incident';
import { PRESETS, baseScenario, confirmedSummary, assumptionText } from '../src/lib/presets';
import { benchmarkJson, reportHtml, seriesCsv, decisionsCsv } from '../src/engine/report';

const preset = PRESETS[0];
const scenario = applyIncidentToScenario(baseScenario(2026), preset.draft);
const runs = compareControllers(scenario, ['fixed', 'maxpressure', 'waveguard']);
mkdirSync('artifacts', { recursive: true });
for (const lang of ['vi', 'en'] as const) {
  writeFileSync(`artifacts/demo-report-${lang}.html`, reportHtml({
    lang, runs, incidentText: lang === 'en' ? preset.textEn : preset.text,
    confirmedSummary: confirmedSummary(preset.draft, lang), assumptions: assumptionText(preset.draft, lang),
    geminiExplanation: null, geminiModel: null,
  }));
}
writeFileSync('artifacts/demo-session.json', JSON.stringify(benchmarkJson(runs, { confirmedIncident: preset.draft }), null, 2));
writeFileSync('artifacts/demo-series.csv', seriesCsv(runs));
writeFileSync('artifacts/demo-decisions.csv', decisionsCsv(runs.waveguard));
console.log('Exported bilingual HTML reports and matching JSON / CSV session data to artifacts/.');
