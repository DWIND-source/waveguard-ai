import { describe, expect, it } from 'vitest';
import { applyIncidentToScenario, numbersInText, validateParsedIncident } from '../src/shared/incident';
import { getScenario } from '../src/engine/scenarios';
import { runSimulation } from '../src/engine/simulator';

const TEXT = 'Xe tải bị hỏng tại đoạn đường giữa nút B và C. Lưu lượng đang cao, xe có nguy cơ ùn ngược về nút A.';

describe('9. structured Gemini incident validation', () => {
  it('accepts a well-formed response and lists missing numeric fields', () => {
    const res = validateParsedIncident(
      {
        incidentType: 'road_blockage',
        affectedNode: 'C',
        affectedLink: 'B-C',
        severity: 'high',
        capacityReduction: null,
        demandChange: null,
        durationSeconds: null,
        summary: 'Xe tải hỏng trên đoạn B-C.',
        missingInformation: [],
      },
      TEXT,
    );
    expect(res.ok).toBe(true);
    expect(res.value!.missingInformation).toEqual(expect.arrayContaining(['capacityReduction', 'durationSeconds']));
    expect(res.value!.missingInformation).not.toContain('demandChange');
  });

  it('strips numbers Gemini invented that are not in the operator text', () => {
    const res = validateParsedIncident(
      { incidentType: 'road_blockage', affectedNode: 'C', affectedLink: 'B-C', severity: 'high', capacityReduction: 0.5, demandChange: null, durationSeconds: 1800, summary: 'x', missingInformation: [] },
      TEXT,
    );
    expect(res.value!.capacityReduction).toBeNull();
    expect(res.value!.durationSeconds).toBeNull();
    expect(res.removedUnsupported).toEqual(['capacityReduction', 'durationSeconds']);
    expect(res.value!.missingInformation).toEqual(expect.arrayContaining(['capacityReduction', 'durationSeconds']));
  });

  it('keeps numbers that are grounded in the text (percent and minutes)', () => {
    const text = 'Xe tải hỏng gần nút C, mất 50% năng lực, dự kiến kéo dài 20 phút';
    const res = validateParsedIncident(
      { incidentType: 'road_blockage', affectedNode: 'C', affectedLink: 'B-C', severity: 'high', capacityReduction: 0.5, demandChange: null, durationSeconds: 1200, summary: 'x', missingInformation: [] },
      text,
    );
    expect(res.value!.capacityReduction).toBe(0.5);
    expect(res.value!.durationSeconds).toBe(1200);
    expect(res.value!.missingInformation).toEqual([]);
    expect(numbersInText('giảm một nửa')).toContain(50);
  });

  it('rejects invalid enums and non-object payloads', () => {
    expect(validateParsedIncident('hello', TEXT).ok).toBe(false);
    const bad = validateParsedIncident({ incidentType: 'alien_attack', affectedNode: 'Z', affectedLink: 'X-Y', severity: 'huge', summary: 's', missingInformation: [] }, TEXT);
    expect(bad.ok).toBe(false);
    expect(bad.errors.length).toBeGreaterThanOrEqual(3);
  });

  it('a confirmed incident becomes a real simulation state change', () => {
    const base = getScenario('normal');
    const sc = applyIncidentToScenario(base, {
      incidentType: 'road_blockage',
      affectedNode: 'C',
      affectedLink: 'B-C',
      capacityReduction: 0.7,
      demandChange: 0,
      durationSeconds: 900,
      startS: 120,
      summary: 'test',
      assumptions: ['capacityReduction'],
      source: 'manual',
    });
    expect(sc.incidents[0].linkId).toBe('B-C');
    const withInc = runSimulation(sc, 'fixed', undefined, { recordFrames: false });
    const without = runSimulation({ ...sc, incidents: [] }, 'fixed', undefined, { recordFrames: false });
    expect(withInc.metrics.cumulativeWaitingVehS).toBeGreaterThan(without.metrics.cumulativeWaitingVehS);
  });
});
