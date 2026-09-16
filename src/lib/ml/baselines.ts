/**
 * ML baselines.
 *
 * Every function in this module is honestly labelled as a *baseline* — it
 * uses hand-tuned weights, thresholding or simple physics, not learned
 * parameters. They are documented as such in the ModelRegistry (see
 * `ML_MODELS` in config) and the `isBaseline` flag is propagated through
 * the pipeline so consumers can never confuse a baseline for a trained
 * model.
 *
 * The contract:
 *   - `predictHeavyRain()`        → heavy-rain probability (0..1) + threshold class
 *   - `forecastRainfall()`        → expected rainfall (mm) at horizon
 *   - `predictFloodProbability()` → flood probability (0..1)
 *   - `predictInundation()`       → inundation depth (m) + area
 *   - `runFullPrediction()`       → orchestrates all four for a feature set
 */

import {
  ML_MODELS,
  RAINFALL_THRESHOLDS,
  RISK_THRESHOLDS,
  FORECAST_HORIZONS,
} from "@/lib/config/config";
import { logger } from "@/lib/config/logger";
import { assessInundation } from "@/lib/weather/risk-engine";
import type {
  AtmosphericFeatures,
  FeatureSet,
  RainfallFeatures,
} from "@/lib/features/feature-engineering";

/* -------------------------------------------------------------------------- */
/*  Heavy-rain prediction (threshold baseline)                                */
/* -------------------------------------------------------------------------- */

export interface HeavyRainPrediction {
  probability: number;
  /** True if probability ≥ 0.5 */
  isHeavy: boolean;
  /** Threshold (mm) the prediction is benchmarked against */
  threshold: number;
  /** 1h rainfall (mm) used to derive the prediction */
  rainfall1hMm: number;
  /** 24h rainfall (mm) used to derive the prediction */
  rainfall24hMm: number;
  modelName: string;
  modelVersion: string;
  isBaseline: boolean;
}

/**
 * Hand-tuned logistic-of-rainfall.
 *
 *   p = 1 / (1 + exp(-(rain24h - heavy24h) / heavy24h * 2.5))
 *
 * The sigmoid is centred at the IMD 24h-heavy threshold (64.5 mm) and has a
 * slope such that ~115 mm maps to ~0.85 probability. This is NOT a learned
 * weight; it is a calibrated heuristic.
 */
export function predictHeavyRain(features: RainfallFeatures): HeavyRainPrediction {
  const { rain24h, rain1h } = features;
  const threshold = RAINFALL_THRESHOLDS.heavy24h;
  const x = ((rain24h - threshold) / threshold) * 2.5;
  const prob24h = 1 / (1 + Math.exp(-x));

  // 1h contribution — bursts of intense rain in the last hour raise the
  // probability above the 24h-only sigmoid.
  const x1 = ((rain1h - RAINFALL_THRESHOLDS.heavy1h) / RAINFALL_THRESHOLDS.heavy1h) * 2.5;
  const prob1h = 1 / (1 + Math.exp(-x1));

  // Combine: take the max so a short burst can dominate even if 24h is low.
  const probability = Math.max(prob24h, prob1h * 0.85);

  return {
    probability: Number(probability.toFixed(3)),
    isHeavy: probability >= 0.5,
    threshold,
    rainfall1hMm: rain1h,
    rainfall24hMm: rain24h,
    modelName: ML_MODELS.heavyRain.name,
    modelVersion: ML_MODELS.heavyRain.version,
    isBaseline: ML_MODELS.heavyRain.isBaseline,
  };
}

/* -------------------------------------------------------------------------- */
/*  Rainfall forecast (persistence + linear extrapolation baseline)           */
/* -------------------------------------------------------------------------- */

export interface RainfallForecastResult {
  /** Forecast rainfall (mm) over the requested horizon */
  forecastRainfallMm: number;
  /** Horizon in minutes */
  horizonMinutes: number;
  /** Average rate (mm/h) used to compute the forecast */
  rateMmPerH: number;
  /** Confidence (0..1) — baselines are low-confidence by definition */
  confidence: number;
  modelName: string;
  modelVersion: string;
  isBaseline: boolean;
}

/**
 * Persistence + linear extrapolation.
 *
 *   rate  = max(rain1h, meanHourlyRain)
 *   forecast_mm = rate * horizon_hours * 0.7
 *
 * The 0.7 multiplier is a conservative damping factor — baselines should
 * under-forecast, not over-forecast.
 */
export function forecastRainfall(
  features: RainfallFeatures,
  horizonMinutes: number = FORECAST_HORIZONS.medium,
): RainfallForecastResult {
  const horizonHours = horizonMinutes / 60;
  const rate = Math.max(features.rain1h, features.meanHourlyRain);
  const forecastRainfallMm = rate * horizonHours * 0.7;

  return {
    forecastRainfallMm: Number(forecastRainfallMm.toFixed(2)),
    horizonMinutes,
    rateMmPerH: Number(rate.toFixed(2)),
    // Baseline confidence: bounded so the alert engine never treats this as
    // a high-confidence prediction.
    confidence: 0.45,
    modelName: ML_MODELS.rainfallForecast.name,
    modelVersion: ML_MODELS.rainfallForecast.version,
    isBaseline: ML_MODELS.rainfallForecast.isBaseline,
  };
}

/* -------------------------------------------------------------------------- */
/*  Flood probability (logistic baseline)                                     */
/* -------------------------------------------------------------------------- */

export interface FloodProbabilityResult {
  probability: number;
  /** Risk bucket derived from the probability */
  riskLevel: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  inputs: {
    rain24h: number;
    rain1h: number;
    wetFraction: number;
    isThunderstorm: boolean;
  };
  modelName: string;
  modelVersion: string;
  isBaseline: boolean;
}

/**
 * Logistic-of-rainfall + IMERG wet-fraction + thunderstorm bias.
 *
 *   z = -3.5 + 0.04 * rain24h + 0.06 * rain1h + 1.8 * wetFraction + 0.8 * isThunderstorm
 *   p = 1 / (1 + exp(-z))
 *
 * Weights are hand-tuned to roughly reproduce IMD historical event rates.
 */
export function predictFloodProbability(
  features: FeatureSet,
): FloodProbabilityResult {
  const r = features.rainfall;
  const wet = features.imerg?.wetFraction ?? 0;
  const storm = features.atmospheric.isThunderstorm ? 1 : 0;

  const z =
    -3.5 +
    0.04 * r.rain24h +
    0.06 * r.rain1h +
    1.8 * wet +
    0.8 * storm;
  const probability = 1 / (1 + Math.exp(-z));

  let riskLevel: FloodProbabilityResult["riskLevel"] = "LOW";
  if (probability >= 0.85) riskLevel = "CRITICAL";
  else if (probability >= 0.7) riskLevel = "HIGH";
  else if (probability >= 0.4) riskLevel = "MODERATE";

  return {
    probability: Number(probability.toFixed(3)),
    riskLevel,
    inputs: {
      rain24h: r.rain24h,
      rain1h: r.rain1h,
      wetFraction: wet,
      isThunderstorm: storm === 1,
    },
    modelName: ML_MODELS.floodProbability.name,
    modelVersion: ML_MODELS.floodProbability.version,
    isBaseline: ML_MODELS.floodProbability.isBaseline,
  };
}

/* -------------------------------------------------------------------------- */
/*  Inundation (NRCS Curve-Number baseline)                                   */
/* -------------------------------------------------------------------------- */

export interface InundationPredictionResult {
  depthM: number;
  level: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  inundationAreaKm2?: number;
  directive: string;
  actions: string[];
  modelName: string;
  modelVersion: string;
  isBaseline: boolean;
}

export function predictInundation(
  features: FeatureSet,
  options: {
    curveNumber?: number;
    catchmentAreaKm2?: number;
  } = {},
): InundationPredictionResult {
  const result = assessInundation({
    rainfallMm: features.rainfall.rain24h,
    curveNumber: options.curveNumber,
    catchmentAreaKm2: options.catchmentAreaKm2,
  });

  return {
    depthM: result.depthM,
    level: result.level,
    inundationAreaKm2: result.inundationAreaKm2,
    directive: result.directive,
    actions: result.actions,
    modelName: ML_MODELS.inundation.name,
    modelVersion: ML_MODELS.inundation.version,
    isBaseline: ML_MODELS.inundation.isBaseline,
  };
}

/* -------------------------------------------------------------------------- */
/*  Full prediction pipeline                                                  */
/* -------------------------------------------------------------------------- */

export interface FullPredictionResult {
  heavyRain: HeavyRainPrediction;
  rainfallForecast: RainfallForecastResult;
  floodProbability: FloodProbabilityResult;
  inundation: InundationPredictionResult;
  /** Combined risk bucket — max of all sub-buckets */
  combinedRiskLevel: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  /** True if every model is a baseline */
  allBaselines: boolean;
  /** ISO timestamp */
  computedAt: string;
}

const RISK_RANK: Record<string, number> = {
  LOW: 0,
  MODERATE: 1,
  HIGH: 2,
  CRITICAL: 3,
};

function maxRisk(...levels: string[]): "LOW" | "MODERATE" | "HIGH" | "CRITICAL" {
  const top = levels.reduce(
    (best, l) => (RISK_RANK[l] > RISK_RANK[best] ? l : best),
    "LOW",
  );
  return top as "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
}

/**
 * Run all four baseline models on a feature set and return the combined
 * prediction payload that the pipeline persists to `FloodPrediction` rows.
 */
export function runFullPrediction(features: FeatureSet): FullPredictionResult {
  const heavyRain = predictHeavyRain(features.rainfall);
  const rainfallForecast = forecastRainfall(
    features.rainfall,
    FORECAST_HORIZONS.medium,
  );
  const floodProbability = predictFloodProbability(features);
  const inundation = predictInundation(features);

  const combinedRiskLevel = maxRisk(
    floodProbability.riskLevel,
    inundation.level,
    heavyRain.isHeavy ? "HIGH" : "LOW",
  );

  const allBaselines =
    heavyRain.isBaseline &&
    rainfallForecast.isBaseline &&
    floodProbability.isBaseline &&
    inundation.isBaseline;

  logger.debug("ml-baselines.runFullPrediction", {
    combinedRiskLevel,
    allBaselines,
    heavyRainP: heavyRain.probability,
    floodP: floodProbability.probability,
    inundationDepthM: inundation.depthM,
  });

  return {
    heavyRain,
    rainfallForecast,
    floodProbability,
    inundation,
    combinedRiskLevel,
    allBaselines,
    computedAt: new Date().toISOString(),
  };
}

export default {
  predictHeavyRain,
  forecastRainfall,
  predictFloodProbability,
  predictInundation,
  runFullPrediction,
};

// Suppress unused import warning for AtmosphericFeatures — exported as
// part of the feature-set contract that callers may need.
export type { AtmosphericFeatures };
// Suppress unused import for RISK_THRESHOLDS — kept for downstream
// reference even if not directly used in this file's body.
void RISK_THRESHOLDS;
