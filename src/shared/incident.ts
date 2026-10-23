/**
 * Structured incident schema shared by the server (Gemini output validation)
 * and the client (confirmation panel → simulation state change).
 */
import type { Incident, LinkId, NodeId, ScenarioConfig, SensorFault } from '../engine/types';

export const INCIDENT_TYPES = ['road_blockage', 'capacity_drop', 'demand_surge', 'sensor_failure', 'unknown'] as const;
export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export const NODES = ['A', 'B', 'C'] as const;
export const MAIN_LINKS = ['in-A', 'A-B', 'B-C', 'C-out'] as const;
export const NUMERIC_FIELDS = ['capacityReduction', 'demandChange', 'durationSeconds'] as const;

export type ParsedIncidentType = (typeof INCIDENT_TYPES)[number];
export type Severity = (typeof SEVERITIES)[number];

export interface ParsedIncident {
  incidentType: ParsedIncidentType;
  affectedNode: NodeId | null;
  affectedLink: LinkId | null;
  severity: Severity | null;
  /** fraction 0..0.95 of capacity removed — null when not stated */
  capacityReduction: number | null;
  /** fractional demand change, e.g. 0.3 = +30% — null when not stated */
  demandChange: number | null;
  durationSeconds: number | null;
  summary: string;
  missingInformation: string[];
}

export interface ValidationResult {
  ok: boolean;
  value: ParsedIncident | null;
  errors: string[];
  /** fields that were removed because they were not supported by the operator's text */
  removedUnsupported: string[];
}

/** JSON schema (OpenAPI subset) handed to Gemini as responseSchema. */
export const GEMINI_INCIDENT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    incidentType: { type: 'STRING', enum: [...INCIDENT_TYPES] },
    affectedNode: { type: 'STRING', enum: [...NODES], nullable: true },
    affectedLink: { type: 'STRING', enum: [...MAIN_LINKS], nullable: true },
    severity: { type: 'STRING', enum: [...SEVERITIES], nullable: true },
    capacityReduction: { type: 'NUMBER', nullable: true, description: 'Fraction 0..0.95. ONLY if the text states a number/percentage; otherwise null.' },
    demandChange: { type: 'NUMBER', nullable: true, description: 'Fractional demand change. ONLY if stated numerically; otherwise null.' },
    durationSeconds: { type: 'NUMBER', nullable: true, description: 'ONLY if a duration is stated; otherwise null.' },
    summary: { type: 'STRING', description: 'One-sentence Vietnamese summary.' },
    missingInformation: { type: 'ARRAY', items: { type: 'STRING', enum: [...NUMERIC_FIELDS, 'affectedLink', 'severity'] } },
  },
  required: ['incidentType', 'affectedNode', 'affectedLink', 'severity', 'capacityReduction', 'demandChange', 'durationSeconds', 'summary', 'missingInformation'],
  propertyOrdering: ['incidentType', 'affectedNode', 'affectedLink', 'severity', 'capacityReduction', 'demandChange', 'durationSeconds', 'summary', 'missingInformation'],
} as const;

/** Numbers that literally appear in the operator text ("50%", "15 phút", "một nửa" → 50). */
export function numbersInText(text: string): number[] {
  const nums = (text.match(/\d+(?:[.,]\d+)?/g) ?? []).map((s) => Number(s.replace(',', '.')));
  if (/(một\s+)?nửa/i.test(text)) nums.push(50);
  return nums;
}

function supported(field: (typeof NUMERIC_FIELDS)[number], value: number, text: string): boolean {
  // Require units: a road number, node ordinal or duration cannot justify a percentage.
  const close = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  if (field === 'durationSeconds') {
    const durations = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*(giây|phút|giờ|seconds?|secs?|minutes?|mins?|hours?|hrs?|s\b|h\b)/gi)];
    return durations.some(([, n, unit]) => {
      const factor = /^(phút|min)/i.test(unit) ? 60 : /^(giờ|h)/i.test(unit) ? 3600 : 1;
      return close(Number(n.replace(',', '.')) * factor, value);
    });
  }
  const percentages = [...text.matchAll(/([+-]?\d+(?:[.,]\d+)?)\s*(?:%|percent\b|phần trăm)/gi)].map((m) => Number(m[1].replace(',', '.')) / 100);
  if (/(một\s+)?nửa|\bhalf\b/i.test(text)) percentages.push(0.5);
  return percentages.some((n) => close(n, value));
}

/**
 * Server-side validation of Gemini's structured output.
 * - rejects unknown enums / wrong types,
 * - clamps fractions to safe ranges,
 * - strips any numeric parameter that is not grounded in the operator's text
 *   (Gemini must not invent numbers) and marks it as missing.
 */
export function validateParsedIncident(raw: unknown, operatorText: string): ValidationResult {
  const errors: string[] = [];
  const removedUnsupported: string[] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, value: null, errors: ['Kết quả không phải là đối tượng JSON'], removedUnsupported };
  }
  const r = raw as Record<string, unknown>;
  const enumOrNull = <T extends string>(key: string, allowed: readonly T[], nullable = true): T | null => {
    const v = r[key];
    if (v === null || v === undefined) {
      if (!nullable) errors.push(`Thiếu trường ${key}`);
      return null;
    }
    if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
      errors.push(`Giá trị không hợp lệ cho ${key}: ${JSON.stringify(v)}`);
      return null;
    }
    return v as T;
  };
  const incidentType = enumOrNull('incidentType', INCIDENT_TYPES, false) ?? 'unknown';
  const affectedNode = enumOrNull('affectedNode', NODES);
  const affectedLink = enumOrNull('affectedLink', MAIN_LINKS) as LinkId | null;
  const severity = enumOrNull('severity', SEVERITIES);
  const summary = typeof r.summary === 'string' ? r.summary.slice(0, 400) : '';
  if (!summary) errors.push('Thiếu tóm tắt (summary)');

  const missing = new Set<string>(
    Array.isArray(r.missingInformation) ? r.missingInformation.filter((x): x is string => typeof x === 'string' && [...NUMERIC_FIELDS, 'affectedLink', 'severity'].includes(x)) : [],
  );
  const num = (key: (typeof NUMERIC_FIELDS)[number], min: number, max: number): number | null => {
    const v = r[key];
    if (v === null || v === undefined) {
      missing.add(key);
      return null;
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      errors.push(`${key} phải là số hoặc null`);
      missing.add(key);
      return null;
    }
    // accept "50" meaning 50% for fractional fields
    let val = v;
    if (key !== 'durationSeconds' && val > 1 && val <= 100) val = val / 100;
    if (!supported(key, val, operatorText)) {
      removedUnsupported.push(key);
      missing.add(key);
      return null;
    }
    return Math.max(min, Math.min(max, val));
  };
  const capacityReduction = num('capacityReduction', 0, 0.95);
  const demandChange = num('demandChange', -0.9, 3);
  const durationSeconds = num('durationSeconds', 0, 6 * 3600);
  if (affectedLink === null && affectedNode === null) missing.add('affectedLink');
  // only report missing fields relevant to the incident type
  if (incidentType === 'demand_surge') missing.delete('capacityReduction');
  if (incidentType === 'road_blockage' || incidentType === 'capacity_drop') missing.delete('demandChange');
  if (incidentType === 'sensor_failure') {
    missing.delete('capacityReduction');
    missing.delete('demandChange');
  }
  if (capacityReduction !== null) missing.delete('capacityReduction');
  if (demandChange !== null) missing.delete('demandChange');
  if (durationSeconds !== null) missing.delete('durationSeconds');

  const value: ParsedIncident = {
    incidentType,
    affectedNode,
    affectedLink,
    severity,
    capacityReduction,
    demandChange,
    durationSeconds,
    summary,
    missingInformation: [...missing],
  };
  return { ok: errors.length === 0, value, errors, removedUnsupported };
}

/** Operator-confirmed parameters (after filling missing values with labelled assumptions). */
export interface ConfirmedIncident {
  incidentType: Exclude<ParsedIncidentType, 'unknown'>;
  affectedNode: NodeId;
  affectedLink: LinkId;
  capacityReduction: number;
  demandChange: number;
  durationSeconds: number;
  startS: number;
  summary: string;
  /** which values are operator assumptions rather than stated facts */
  assumptions: string[];
  source: 'gemini' | 'manual' | 'preset';
}

export const NODE_TO_LINK: Record<NodeId, LinkId> = { A: 'in-A', B: 'A-B', C: 'B-C' };
export const LINK_TO_NODE: Partial<Record<LinkId, NodeId>> = { 'in-A': 'A', 'A-B': 'B', 'B-C': 'C', 'C-out': 'C' };

/** Translate a confirmed incident into a real simulation scenario state change. */
export function applyIncidentToScenario(base: ScenarioConfig, inc: ConfirmedIncident): ScenarioConfig {
  const incidents: Incident[] = [];
  const sensorFaults: SensorFault[] = [];
  if (inc.incidentType === 'sensor_failure') {
    sensorFaults.push({ node: inc.affectedNode, startS: inc.startS, durationS: inc.durationSeconds, mode: 'missing' });
    // a sensor fault is only interesting while traffic is non-trivial: keep a mild bottleneck if stated
    if (inc.capacityReduction > 0) {
      incidents.push({ id: 'inc-1', type: 'capacity_drop', linkId: inc.affectedLink, positionFrac: 0.85, capacityReduction: inc.capacityReduction, demandIncrease: 0, startS: inc.startS, durationS: inc.durationSeconds, description: inc.summary });
    }
  } else if (inc.incidentType === 'demand_surge') {
    incidents.push({ id: 'inc-1', type: 'demand_surge', linkId: 'in-A', positionFrac: 0, capacityReduction: 0, demandIncrease: inc.demandChange, startS: inc.startS, durationS: inc.durationSeconds, description: inc.summary });
  } else {
    incidents.push({ id: 'inc-1', type: inc.incidentType, linkId: inc.affectedLink, positionFrac: 0.85, capacityReduction: inc.capacityReduction, demandIncrease: 0, startS: inc.startS, durationS: inc.durationSeconds, description: inc.summary });
  }
  return {
    ...base,
    id: 'custom',
    name: inc.summary || base.name,
    description: inc.summary,
    durationS: Math.max(base.durationS, inc.startS + inc.durationSeconds + 300),
    incidents,
    sensorFaults,
  };
}
