/**
 * Alert engine.
 *
 * Maps a `FullPredictionResult` (plus city metadata) into an `AlertEvent`
 * with one of six severity levels. Alerts are deduplicated by
 * (cityId, level, hourBucket) so the same condition doesn't spam the
 * notification surface every refresh cycle.
 *
 * Levels (low → high):
 *   INFO              — minor / informational
 *   WATCH             — conditions favourable, monitor
 *   ADVISORY          — likely impact, prepare
 *   WARNING           — impact expected, act now
 *   SEVERE_WARNING    — significant impact, urgent action
 *   EMERGENCY         — life-threatening, immediate evacuation
 */

import { ALERT_THRESHOLDS, RAINFALL_THRESHOLDS } from "@/lib/config/config";
import { logger } from "@/lib/config/logger";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

export type AlertLevel =
  | "INFO"
  | "WATCH"
  | "ADVISORY"
  | "WARNING"
  | "SEVERE_WARNING"
  | "EMERGENCY";

export const ALERT_LEVELS: AlertLevel[] = [
  "INFO",
  "WATCH",
  "ADVISORY",
  "WARNING",
  "SEVERE_WARNING",
  "EMERGENCY",
];

const LEVEL_RANK: Record<AlertLevel, number> = {
  INFO: 0,
  WATCH: 1,
  ADVISORY: 2,
  WARNING: 3,
  SEVERE_WARNING: 4,
  EMERGENCY: 5,
};

export interface AlertInput {
  cityId: string;
  cityName: string;
  state?: string;
  latitude: number;
  longitude: number;
  /** Heavy-rain probability 0..1 */
  heavyRainProbability: number;
  /** Flood probability 0..1 */
  floodProbability: number;
  /** Predicted inundation depth (m) */
  inundationDepthM?: number;
  /** Predicted rainfall over the configured horizon (mm) */
  forecastRainfallMm?: number;
  /** Combined risk bucket */
  riskLevel: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  /** ISO timestamp of the underlying prediction */
  predictionTime: string;
  /** Optional source tag (e.g. "openweathermap") */
  source?: string;
  /** True if all upstream models were baselines */
  isBaseline?: boolean;
}

export interface AlertEvent {
  alertId: string;
  level: AlertLevel;
  title: string;
  reason: string;
  cityId: string;
  cityName: string;
  state?: string;
  latitude: number;
  longitude: number;
  /** Hour bucket for dedup (ISO hour) */
  hourBucket: string;
  expectedRainfallMm?: number;
  floodProbability?: number;
  heavyRainProbability?: number;
  expectedInundationM?: number;
  recommendedAction: string;
  triggeredAt: string;
  source?: string;
  isBaseline?: boolean;
}

/* -------------------------------------------------------------------------- */
/*  Level classification                                                      */
/* -------------------------------------------------------------------------- */

function classifyLevel(input: AlertInput): AlertLevel {
  const { heavyRainProbability, floodProbability, inundationDepthM, riskLevel } = input;
  const t = ALERT_THRESHOLDS;

  // Critical inundation overrides everything else.
  if ((inundationDepthM ?? 0) >= 1.0) return "EMERGENCY";
  if ((inundationDepthM ?? 0) >= 0.5) {
    if (floodProbability >= t.severeWarningProbability) return "EMERGENCY";
    return "SEVERE_WARNING";
  }

  // Flood probability ladder.
  if (floodProbability >= t.emergencyProbability) return "EMERGENCY";
  if (floodProbability >= t.severeWarningProbability) return "SEVERE_WARNING";
  if (floodProbability >= t.warningProbability) return "WARNING";
  if (floodProbability >= t.advisoryProbability) return "ADVISORY";
  if (floodProbability >= t.watchProbability) return "WATCH";

  // Heavy-rain probability ladder (lower precedence than flood).
  if (heavyRainProbability >= t.severeWarningProbability) return "WARNING";
  if (heavyRainProbability >= t.advisoryProbability) return "ADVISORY";
  if (heavyRainProbability >= t.infoProbability) return "INFO";

  // Risk-level fallback.
  if (riskLevel === "CRITICAL") return "SEVERE_WARNING";
  if (riskLevel === "HIGH") return "WARNING";
  if (riskLevel === "MODERATE") return "ADVISORY";
  return "INFO";
}

/* -------------------------------------------------------------------------- */
/*  Title / reason / action templates                                        */
/* -------------------------------------------------------------------------- */

function titleFor(level: AlertLevel, cityName: string): string {
  switch (level) {
    case "INFO":
      return `Rainfall watch update — ${cityName}`;
    case "WATCH":
      return `Heavy rain watch — ${cityName}`;
    case "ADVISORY":
      return `Flood advisory — ${cityName}`;
    case "WARNING":
      return `Flood warning — ${cityName}`;
    case "SEVERE_WARNING":
      return `Severe flood warning — ${cityName}`;
    case "EMERGENCY":
      return `FLOOD EMERGENCY — ${cityName}`;
  }
}

function reasonFor(input: AlertInput, level: AlertLevel): string {
  const parts: string[] = [];
  if (input.heavyRainProbability >= 0.5) {
    parts.push(
      `Heavy-rain probability ${(input.heavyRainProbability * 100).toFixed(0)}%`,
    );
  }
  if (input.floodProbability >= 0.4) {
    parts.push(
      `Flood probability ${(input.floodProbability * 100).toFixed(0)}%`,
    );
  }
  if (input.inundationDepthM != null && input.inundationDepthM > 0) {
    parts.push(`Predicted inundation ${(input.inundationDepthM * 100).toFixed(0)} cm`);
  }
  if (input.forecastRainfallMm != null && input.forecastRainfallMm > 0) {
    parts.push(`Forecast rainfall ${input.forecastRainfallMm.toFixed(0)} mm`);
  }
  if (parts.length === 0) {
    parts.push(`Risk level ${input.riskLevel}`);
  }
  parts.push(`alert level ${level}`);
  return parts.join("; ");
}

function actionFor(level: AlertLevel): string {
  switch (level) {
    case "INFO":
      return "Continue routine monitoring. Brief district staff of developing conditions.";
    case "WATCH":
      return "Activate district-level monitoring. Pre-position drainage crews. Notify ward officers.";
    case "ADVISORY":
      return "Issue public advisory. Begin clearing stormwater drains. Standby pumps in low-lying wards.";
    case "WARNING":
      return "Activate flood response. Restrict traffic in vulnerable underpasses. Open relief shelters on standby.";
    case "SEVERE_WARNING":
      return "Issue mandatory preparedness order. Open relief shelters. Coordinate with NDRF/SDRF. Move critical-care patients.";
    case "EMERGENCY":
      return "Issue mandatory evacuation order for flood-prone wards. Activate mass notification. Suspend public transport in affected zones.";
  }
}

/* -------------------------------------------------------------------------- */
/*  Dedup                                                                     */
/* -------------------------------------------------------------------------- */

function hourBucket(isoTime: string): string {
  // Truncate to the hour for dedup. Format: YYYY-MM-DDTHH
  return isoTime.slice(0, 13);
}

function dedupKey(cityId: string, level: AlertLevel, hour: string): string {
  return `${cityId}|${level}|${hour}`;
}

/**
 * Bounded in-memory store of recently emitted alert keys. Used by
 * `evaluateAlert()` to suppress duplicates within the dedup window.
 *
 * Persistence across process restarts is not required for correctness —
 * the DB layer (`Alert` model) has its own uniqueness check via
 * (cityId, level, triggeredAt). The in-memory store just reduces DB writes.
 */
class AlertDeduper {
  private seen: Map<string, number> = new Map();
  private maxRetained: number;

  constructor(maxRetained: number = ALERT_THRESHOLDS.maxRetained) {
    this.maxRetained = maxRetained;
  }

  /** Returns true if the alert should be emitted (i.e. NOT a duplicate). */
  checkAndAdd(input: AlertInput, level: AlertLevel): boolean {
    const hour = hourBucket(input.predictionTime);
    const key = dedupKey(input.cityId, level, hour);
    if (this.seen.has(key)) {
      logger.debug("alert.dedup.suppressed", { key });
      return false;
    }
    this.seen.set(key, Date.now());
    if (this.seen.size > this.maxRetained) {
      // Evict the oldest entry.
      const oldest = this.seen.keys().next().value;
      if (oldest) this.seen.delete(oldest);
    }
    return true;
  }

  /** Test-only: clear the dedup store. */
  reset(): void {
    this.seen.clear();
  }
}

export const alertDeduper = new AlertDeduper();

/* -------------------------------------------------------------------------- */
/*  Public API                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Evaluate an alert input. Returns `null` when:
 *   - the derived level is INFO AND no heavy-rain threshold is crossed, OR
 *   - the alert was suppressed by the dedup window.
 */
export function evaluateAlert(input: AlertInput): AlertEvent | null {
  const level = classifyLevel(input);

  // Skip purely informational alerts when there's no actionable rainfall.
  if (
    level === "INFO" &&
    input.heavyRainProbability < ALERT_THRESHOLDS.infoProbability &&
    input.forecastRainfallMm != null &&
    input.forecastRainfallMm < RAINFALL_THRESHOLDS.heavy1h
  ) {
    return null;
  }

  if (!alertDeduper.checkAndAdd(input, level)) return null;

  const triggeredAt = new Date().toISOString();
  return {
    alertId: `${input.cityId}-${level}-${hourBucket(input.predictionTime)}`,
    level,
    title: titleFor(level, input.cityName),
    reason: reasonFor(input, level),
    cityId: input.cityId,
    cityName: input.cityName,
    state: input.state,
    latitude: input.latitude,
    longitude: input.longitude,
    hourBucket: hourBucket(input.predictionTime),
    expectedRainfallMm: input.forecastRainfallMm,
    floodProbability: input.floodProbability,
    heavyRainProbability: input.heavyRainProbability,
    expectedInundationM: input.inundationDepthM,
    recommendedAction: actionFor(level),
    triggeredAt,
    source: input.source,
    isBaseline: input.isBaseline,
  };
}

/** Returns true if `a` is strictly more severe than `b`. */
export function isMoreSevere(a: AlertLevel, b: AlertLevel): boolean {
  return LEVEL_RANK[a] > LEVEL_RANK[b];
}

export default { evaluateAlert, alertDeduper, isMoreSevere, ALERT_LEVELS };
