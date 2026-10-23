import type { Incident, ScenarioConfig } from './types';

export type ScenarioId = 'normal' | 'rush' | 'incident' | 'sensor';

const BASE = {
  durationS: 1500,
  seed: 2026,
  demand: { main: 0.55, side: { A: 0.07, B: 0.08, C: 0.07 } },
  demandProfile: [{ t: 0, factor: 1 }],
  incidents: [] as Incident[],
  sensorFaults: [],
};

export function makeIncident(partial: Partial<Incident> = {}): Incident {
  return {
    id: partial.id ?? 'inc-1',
    type: partial.type ?? 'road_blockage',
    linkId: partial.linkId ?? 'B-C',
    positionFrac: partial.positionFrac ?? 0.85,
    capacityReduction: partial.capacityReduction ?? 0.7,
    demandIncrease: partial.demandIncrease ?? 0,
    startS: partial.startS ?? 120,
    durationS: partial.durationS ?? 900,
    description: partial.description,
  };
}

export function getScenario(id: ScenarioId, seed = BASE.seed): ScenarioConfig {
  switch (id) {
    case 'normal':
      return { ...BASE, seed, id, name: 'Giao thông bình thường', description: 'Nhu cầu cân bằng với năng lực đường.', demand: { main: 0.42, side: { A: 0.06, B: 0.06, C: 0.06 } } };
    case 'rush':
      return {
        ...BASE,
        seed,
        id,
        name: 'Lưu lượng tăng đột biến giờ cao điểm',
        description: 'Nhu cầu trục chính tăng dần lên +35% trong giờ cao điểm.',
        demandProfile: [
          { t: 0, factor: 1 },
          { t: 240, factor: 1.35 },
          { t: 1000, factor: 1.35 },
          { t: 1200, factor: 1 },
        ],
      };
    case 'incident':
      return {
        ...BASE,
        seed,
        id,
        name: 'Xe tải hỏng gần nút C',
        description: 'Xe tải hỏng trên đoạn B-C gần nút C, năng lực thông hành giảm 70% trong 15 phút.',
        incidents: [makeIncident({ description: 'Xe tải hỏng trên đoạn B-C gần nút C' })],
      };
    case 'sensor':
      return {
        ...BASE,
        seed,
        id,
        name: 'Cảm biến tại nút B mất tín hiệu',
        description: 'Nút B mất dữ liệu cảm biến trong 10 phút khi đang có sự cố nhẹ gần C.',
        incidents: [makeIncident({ capacityReduction: 0.45, startS: 150, durationS: 800 })],
        sensorFaults: [{ node: 'B', startS: 200, durationS: 600, mode: 'missing' }],
      };
  }
}

export const SCENARIO_IDS: ScenarioId[] = ['incident', 'rush', 'sensor', 'normal'];
