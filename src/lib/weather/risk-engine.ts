/**
 * Inundation / flood-risk engine.
 *
 * Implements the NRCS (formerly SCS) Curve-Number runoff model to convert
 * accumulated rainfall into a runoff depth, then maps the depth to a risk
 * bucket and a public-facing directive.
 *
 * References:
 *   - USDA NRCS National Engineering Handbook, Part 630 (Curve Number method)
 *   - IMD rainfall classification (heavy / very-heavy / extremely-heavy)
 *
 * This is a baseline hydrology model — not a full 2D hydraulic solver. It is
 * intentionally conservative: real flood extents require high-resolution DEM
 * and surface roughness, which the system does not have at the city scale.
 */

import { RISK_THRESHOLDS, RAINFALL_THRESHOLDS } from "@/lib/config/config";
import type { RiskLevel } from "@/lib/weather/types";

/* -------------------------------------------------------------------------- */
/*  Curve-Number lookup                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Antecedent Moisture Condition (AMC) — a proxy for how wet the soil was
 * before this rain event. The NRCS uses three discrete classes (I, II, III).
 */
export type AntecedentMoisture = "I" | "II" | "III";

/**
 * Default Curve Number table by land-cover class. Values assume AMC II
 * (average condition). We adjust to AMC I/III in `adjustCurveNumber()`.
 *
 * Source: USDA NRCS TR-55 table 2-2 (urban / suburban / agricultural).
 */
export const CURVE_NUMBERS: Record<string, number> = {
  // Urban
  "urban-commercial": 92,
  "urban-industrial": 88,
  "urban-residential-1/8-acre": 85,
  "urban-residential-1/4-acre": 75,
  "urban-residential-1-acre": 68,
  "urban-paved": 98,
  "urban-gravel": 85,
  // Rural
  "agricultural-row-crop": 81,
  "agricultural-small-grain": 76,
  "agricultural-pasture": 74,
  "forest-poor": 65,
  "forest-good": 55,
  "meadow": 71,
  "brush": 66,
  // Hydrologic soil group defaults
  "soil-A": 30,
  "soil-B": 60,
  "soil-C": 75,
  "soil-D": 85,
  // Indian city default (mix of urban + sparse vegetation)
  "india-urban-default": 88,
};

/**
 * Curve-Number adjustment for AMC I (dry) / III (wet) using the standard
 * NRCS conversion equations.
 */
export function adjustCurveNumber(cn: number, amc: AntecedentMoisture): number {
  if (amc === "II") return cn;
  if (amc === "I") {
    return Math.round(
      (cn * (4.2 * cn)) / (10 - 0.058 * cn) / 100 + cn / 10 - 50,
    );
  }
  // AMC III
  return Math.round((cn * 23 * cn) / (10 + 0.13 * cn) / 100 + cn / 10 + 50);
}

/* -------------------------------------------------------------------------- */
/*  Runoff depth (NRCS Curve-Number equation)                                */
/* -------------------------------------------------------------------------- */

/**
 * NRCS runoff equation:
 *   Q = (P − 0.2·S)² / (P + 0.8·S)   for P > 0.2·S, else Q = 0
 * where:
 *   Q  = runoff depth (mm, after unit conversion)
 *   P  = rainfall (mm)
 *   S  = potential maximum retention = 25400/CN − 254   (mm)
 *
 * Returns runoff depth in metres (used as the inundation depth proxy).
 */
export function curveNumberRunoff(
  rainfallMm: number,
  curveNumber: number,
): number {
  if (rainfallMm <= 0) return 0;
  const s = 25400 / curveNumber - 254; // mm
  const ia = 0.2 * s; // initial abstraction (mm)
  if (rainfallMm <= ia) return 0;
  const qMm = (rainfallMm - ia) ** 2 / (rainfallMm + 0.8 * s);
  return clampM(qMm / 1000);
}

/* -------------------------------------------------------------------------- */
/*  Risk classification                                                       */
/* -------------------------------------------------------------------------- */

function classifyRisk(depthM: number): RiskLevel {
  if (depthM >= RISK_THRESHOLDS.criticalDepthM) return "CRITICAL";
  if (depthM >= RISK_THRESHOLDS.highDepthM) return "HIGH";
  if (depthM >= RISK_THRESHOLDS.moderateDepthM) return "MODERATE";
  return "LOW";
}

function directiveFor(level: RiskLevel): string {
  switch (level) {
    case "LOW":
      return "Conditions normal. Routine monitoring continues.";
    case "MODERATE":
      return "Ponding likely in low-lying areas. Standby for advisories.";
    case "HIGH":
      return "Significant inundation expected. Avoid underpasses and river banks.";
    case "CRITICAL":
      return "Life-threatening flooding expected. Move to higher ground immediately.";
  }
}

function actionsFor(level: RiskLevel): string[] {
  switch (level) {
    case "LOW":
      return ["Continue routine weather monitoring."];
    case "MODERATE":
      return [
        "Clear stormwater drains in vulnerable zones.",
        "Pre-position pumps in known ponding locations.",
        "Brief district emergency operations centre on standby basis.",
      ];
    case "HIGH":
      return [
        "Activate ward-level flood response teams.",
        "Restrict traffic through underpasses and causeways.",
        "Open temporary relief shelters in low-lying wards.",
        "Notify hospitals, schools and transport operators.",
      ];
    case "CRITICAL":
      return [
        "Issue mandatory evacuation for ground-floor dwellings in flood-prone wards.",
        "Open all relief shelters; activate mass-notification systems.",
        "Coordinate with NDRF / SDRF for swift-water rescue standby.",
        "Suspend public transport in affected zones.",
        "Move critical-care patients from ground floors.",
      ];
  }
}

/* -------------------------------------------------------------------------- */
/*  Public API                                                                */
/* -------------------------------------------------------------------------- */

export interface InundationInput {
  /** Rainfall depth over the analysis window, mm */
  rainfallMm: number;
  /** Curve Number for the catchment (NRCS). Defaults to India urban mix. */
  curveNumber?: number;
  /** Antecedent moisture condition. Defaults to II (average). */
  antecedentMoisture?: AntecedentMoisture;
  /** Catchment area in km² (used for inundation-area estimate). */
  catchmentAreaKm2?: number;
  /** Optional city identifier for telemetry. */
  cityId?: string;
}

export interface InundationResult {
  /** Estimated runoff / inundation depth in metres */
  depthM: number;
  /** Risk bucket */
  level: RiskLevel;
  /** Public-facing directive */
  directive: string;
  /** Recommended preparedness actions */
  actions: string[];
  /** Estimated inundation area in km² (if catchmentAreaKm2 provided) */
  inundationAreaKm2?: number;
  /** Inputs used (for reproducibility) */
  inputs: {
    rainfallMm: number;
    curveNumber: number;
    antecedentMoisture: AntecedentMoisture;
    catchmentAreaKm2?: number;
  };
  /** True if rainfall exceeds IMD heavy thresholds */
  exceedsHeavyThreshold: boolean;
}

function clampM(depthM: number): number {
  if (!Number.isFinite(depthM)) return 0;
  if (depthM < 0) return 0;
  if (depthM > RISK_THRESHOLDS.maxDepthM) return RISK_THRESHOLDS.maxDepthM;
  return depthM;
}

/**
 * Assess inundation depth, risk level, directive and recommended actions
 * for a single rainfall event.
 */
export function assessInundation(input: InundationInput): InundationResult {
  const baseCn = input.curveNumber ?? CURVE_NUMBERS["india-urban-default"];
  const cn = adjustCurveNumber(baseCn, input.antecedentMoisture ?? "II");
  const depthM = clampM(curveNumberRunoff(input.rainfallMm, cn));
  const level = classifyRisk(depthM);
  const exceedsHeavy = input.rainfallMm >= RAINFALL_THRESHOLDS.heavy1h;

  const result: InundationResult = {
    depthM,
    level,
    directive: directiveFor(level),
    actions: actionsFor(level),
    inputs: {
      rainfallMm: input.rainfallMm,
      curveNumber: cn,
      antecedentMoisture: input.antecedentMoisture ?? "II",
      catchmentAreaKm2: input.catchmentAreaKm2,
    },
    exceedsHeavyThreshold: exceedsHeavy,
  };

  if (input.catchmentAreaKm2 != null && input.catchmentAreaKm2 > 0) {
    // Rough inundation area: fraction of catchment with depth above the low
    // threshold. Linear proxy — not a real hydraulics solver.
    const fraction = Math.min(
      1,
      depthM / RISK_THRESHOLDS.highDepthM,
    );
    result.inundationAreaKm2 = Number((input.catchmentAreaKm2 * fraction).toFixed(2));
  }

  return result;
}

export default { assessInundation, curveNumberRunoff, adjustCurveNumber };
