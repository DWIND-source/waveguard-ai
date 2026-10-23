import { compareControllers } from '../src/engine/simulator';
import { getScenario, SCENARIO_IDS } from '../src/engine/scenarios';
const seeds = process.argv[2] ? process.argv[2].split(',').map(Number) : [2026];
for (const id of SCENARIO_IDS) for (const seed of seeds) {
  const t0 = Date.now();
  const runs = compareControllers(getScenario(id, seed), ['fixed', 'maxpressure', 'waveguard'], undefined, { recordFrames: false });
  console.log(`\n== ${id} seed=${seed} (${Date.now() - t0} ms)`);
  for (const [k, r] of Object.entries(runs)) {
    const m = r.metrics;
    console.log(k.padEnd(12), 'disch', m.totalDischarged.toFixed(0), 'wait', (m.cumulativeWaitingVehS/3600).toFixed(1)+'vh', 'side', (m.sideStreetWaitingVehS/3600).toFixed(1), 'avgQ', m.avgQueue.toFixed(1), 'maxOcc', m.maxLinkOccupancy.toFixed(2), m.maxOccupancyLink, 'spill', m.spillbackDurationS, 'ext', m.finalEntryQueue.toFixed(0), 'warn', m.avgActiveWarnings?.toFixed(2), 'cons', m.conservationError.toExponential(1), 'dec', r.decisions.length);
  }
}
