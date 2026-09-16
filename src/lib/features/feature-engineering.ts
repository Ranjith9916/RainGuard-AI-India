/**
 * Feature engineering.
 *
 * Converts raw weather / rainfall observations into the feature vectors used
 * by the ML baselines and the cloudburst engine. Every function here is
 * deterministic and side-effect-free — given the same inputs it always
 * produces the same features. That matters because:
 *
 *   1. The alert engine deduplicates on (cityId, level, hour) and features
 *      feed into the level — non-determinism would create spurious alerts.
 *   2. The ModelRegistry persists feature versions; reproducing a model
 *      run requires being able to reproduce the features.
 */

import { RAINFALL_THRESHOLDS, RAINFALL_AGGREGATIONS } from "@/lib/config/config";
import type { HourlyEntry, CurrentWeather } from "@/lib/weather/types";

/* -------------------------------------------------------------------------- */
/*  Rainfall features                                                         */
/* -------------------------------------------------------------------------- */

export interface RainfallFeatures {
  /** Rainfall in the last hour, mm */
  rain1h: number;
  /** Rainfall in the last 3 hours, mm */
  rain3h: number;
  /** Rainfall in the last 6 hours, mm */
  rain6h: number;
  /** Rainfall in the last 12 hours, mm */
  rain12h: number;
  /** Rainfall in the last 24 hours, mm */
  rain24h: number;
  /** 24h rainfall rate (mm/h) */
  rainRate24h: number;
  /** True if 1h rainfall crosses IMD heavy threshold */
  isHeavy1h: boolean;
  /** True if 24h rainfall crosses IMD heavy threshold */
  isHeavy24h: boolean;
  /** True if 24h rainfall crosses IMD very-heavy threshold */
  isVeryHeavy24h: boolean;
  /** True if 24h rainfall crosses IMD extremely-heavy threshold */
  isExtremelyHeavy24h: boolean;
  /** Most recent hour index where rainfall > 0 */
  lastRainHourOffset: number;
  /** Mean hourly precipitation (mm/h) over the available window */
  meanHourlyRain: number;
  /** Max hourly precipitation (mm/h) over the available window */
  maxHourlyRain: number;
}

/**
 * Compute rainfall features from an hourly series. The series is assumed to
 * be ordered oldest-first; the most recent entry is treated as "now".
 */
export function computeRainfallFeatures(
  hourly: HourlyEntry[],
): RainfallFeatures {
  const recent = hourly.slice(-24); // last 24 entries
  const reversed = [...recent].reverse();
  const sum = (n: number) =>
    reversed.slice(0, n).reduce((a, e) => a + (e.precipitationMm ?? 0), 0);

  const rain1h = sum(1);
  const rain3h = sum(3);
  const rain6h = sum(6);
  const rain12h = sum(12);
  const rain24h = sum(24);
  const rainRate24h = rain24h / 24;

  const vals = recent
    .map((h) => h.precipitationMm ?? 0)
    .filter((v) => Number.isFinite(v));
  const meanHourlyRain =
    vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  const maxHourlyRain = vals.length > 0 ? Math.max(...vals) : 0;

  let lastRainHourOffset = -1;
  for (let i = 0; i < reversed.length; i++) {
    if ((reversed[i].precipitationMm ?? 0) > 0) {
      lastRainHourOffset = i;
      break;
    }
  }

  return {
    rain1h: Number(rain1h.toFixed(2)),
    rain3h: Number(rain3h.toFixed(2)),
    rain6h: Number(rain6h.toFixed(2)),
    rain12h: Number(rain12h.toFixed(2)),
    rain24h: Number(rain24h.toFixed(2)),
    rainRate24h: Number(rainRate24h.toFixed(3)),
    isHeavy1h: rain1h >= RAINFALL_THRESHOLDS.heavy1h,
    isHeavy24h: rain24h >= RAINFALL_THRESHOLDS.heavy24h,
    isVeryHeavy24h: rain24h >= RAINFALL_THRESHOLDS.veryHeavy24h,
    isExtremelyHeavy24h: rain24h >= RAINFALL_THRESHOLDS.extremelyHeavy24h,
    lastRainHourOffset,
    meanHourlyRain: Number(meanHourlyRain.toFixed(3)),
    maxHourlyRain: Number(maxHourlyRain.toFixed(2)),
  };
}

/* -------------------------------------------------------------------------- */
/*  Atmospheric features                                                      */
/* -------------------------------------------------------------------------- */

export interface AtmosphericFeatures {
  temperatureC: number;
  humidityPercent: number;
  pressureHpa: number;
  windSpeedMs: number;
  windDirectionDeg: number;
  cloudCoverPct: number;
  /** Saturation vapour pressure at the temperature (hPa, Tetens formula) */
  saturationVapourPressure: number;
  /** Actual vapour pressure (hPa) */
  actualVapourPressure: number;
  /** Relative humidity × 100, clamped to 0..100 */
  relativeHumidityClamped: number;
  /** Dew point in °C (Magnus formula inverse) */
  dewPointC: number;
  /** Wind component along the prevailing monsoon direction (deg) */
  windComponent: number;
  /** Is the current weatherCode a thunderstorm class? */
  isThunderstorm: boolean;
}

const MONSOON_DIRECTION_DEG = 220; // SW monsoon typical bearing

export function computeAtmosphericFeatures(
  current: CurrentWeather,
  monsoonDirectionDeg: number = MONSOON_DIRECTION_DEG,
): AtmosphericFeatures {
  const temperatureC = current.temperatureC ?? 0;
  const humidityPercent = current.humidityPercent ?? 0;
  const pressureHpa = current.pressureHpa ?? 1013.25;
  const windSpeedMs = current.windSpeedMs ?? 0;
  const windDirectionDeg = current.windDirectionDeg ?? 0;
  const cloudCoverPct = current.cloudCoverPct ?? 0;

  // Tetens saturation vapour pressure (hPa).
  const svp = 6.1078 * Math.exp((17.27 * temperatureC) / (temperatureC + 237.3));
  const avp = (humidityPercent / 100) * svp;

  // Magnus inverse → dew point.
  const gamma = Math.log(avp / 6.1078);
  const dewPointC = (237.3 * gamma) / (17.27 - gamma);

  // Wind component along the monsoon direction (positive = blowing towards
  // the monsoon bearing, i.e. favourable for moisture inflow).
  const windRad = (windDirectionDeg * Math.PI) / 180;
  const monoRad = (monsoonDirectionDeg * Math.PI) / 180;
  const windComponent = windSpeedMs * Math.cos(windRad - monoRad);

  return {
    temperatureC,
    humidityPercent,
    pressureHpa,
    windSpeedMs,
    windDirectionDeg,
    cloudCoverPct,
    saturationVapourPressure: Number(svp.toFixed(2)),
    actualVapourPressure: Number(avp.toFixed(2)),
    relativeHumidityClamped: Math.max(0, Math.min(100, humidityPercent)),
    dewPointC: Number.isFinite(dewPointC) ? Number(dewPointC.toFixed(2)) : 0,
    windComponent: Number(windComponent.toFixed(2)),
    isThunderstorm: (current.weatherCode ?? 0) >= 95,
  };
}

/* -------------------------------------------------------------------------- */
/*  IMERG features                                                            */
/* -------------------------------------------------------------------------- */

export interface ImergFeatures {
  /** Latest IMERG half-hour rainfall (mm) */
  latestHalfHourMm: number;
  /** 1h rainfall from IMERG (mm) */
  imerg1h: number;
  /** 3h rainfall from IMERG (mm) */
  imerg3h: number;
  /** 6h rainfall from IMERG (mm) */
  imerg6h: number;
  /** 24h rainfall from IMERG (mm) */
  imerg24h: number;
  /** Mean IMERG rainfall rate over the window (mm/h) */
  meanRate: number;
  /** Fraction of half-hourly readings with rainfall > 0.1 mm */
  wetFraction: number;
  /** True if latest half-hour exceeds 25 mm/h equivalent (heavy) */
  isHeavy: boolean;
}

interface ImergReadingLike {
  time: string;
  rainfallMm: number;
  durationMinutes?: number;
}

/**
 * Compute IMERG-style features from a sequence of rainfall readings. The
 * readings are assumed to be half-hourly; the function still works for
 * hourly inputs but the `latestHalfHourMm` field will reflect the last
 * reading regardless of duration.
 */
export function computeImergFeatures(
  readings: ImergReadingLike[],
): ImergFeatures {
  if (readings.length === 0) {
    return {
      latestHalfHourMm: 0,
      imerg1h: 0,
      imerg3h: 0,
      imerg6h: 0,
      imerg24h: 0,
      meanRate: 0,
      wetFraction: 0,
      isHeavy: false,
    };
  }

  const reversed = [...readings].reverse();
  const latest = reversed[0]!;
  const latestHalfHourMm = latest.rainfallMm;
  // For half-hourly data: 1h = 2 latest, 3h = 6, 6h = 12, 24h = 48.
  const sumN = (n: number) =>
    reversed.slice(0, n).reduce((a, r) => a + (r.rainfallMm ?? 0), 0);
  const imerg1h = sumN(2);
  const imerg3h = sumN(6);
  const imerg6h = sumN(12);
  const imerg24h = sumN(48);

  const rates = readings.map((r) => r.rainfallMm ?? 0);
  const meanRate = rates.reduce((a, b) => a + b, 0) / rates.length;
  const wetCount = rates.filter((r) => r > 0.1).length;
  const wetFraction = wetCount / rates.length;

  return {
    latestHalfHourMm: Number(latestHalfHourMm.toFixed(2)),
    imerg1h: Number(imerg1h.toFixed(2)),
    imerg3h: Number(imerg3h.toFixed(2)),
    imerg6h: Number(imerg6h.toFixed(2)),
    imerg24h: Number(imerg24h.toFixed(2)),
    meanRate: Number(meanRate.toFixed(3)),
    wetFraction: Number(wetFraction.toFixed(3)),
    isHeavy: latestHalfHourMm >= RAINFALL_THRESHOLDS.heavy1h / 2,
  };
}

/* -------------------------------------------------------------------------- */
/*  Combined feature set                                                      */
/* -------------------------------------------------------------------------- */

export interface FeatureSet {
  rainfall: RainfallFeatures;
  atmospheric: AtmosphericFeatures;
  imerg?: ImergFeatures;
  /** ISO timestamp at which the features were computed */
  computedAt: string;
  /** Aggregation window used to compute rainfall features */
  rainfallWindowMinutes: number;
}

export interface BuildFeatureSetInput {
  hourly: HourlyEntry[];
  current: CurrentWeather;
  imerg?: ImergReadingLike[];
  /** Override the rainfall aggregation window (minutes). Defaults to 1440. */
  rainfallWindowMinutes?: number;
}

export function buildFeatureSet(input: BuildFeatureSetInput): FeatureSet {
  return {
    rainfall: computeRainfallFeatures(input.hourly),
    atmospheric: computeAtmosphericFeatures(input.current),
    imerg: input.imerg ? computeImergFeatures(input.imerg) : undefined,
    computedAt: new Date().toISOString(),
    rainfallWindowMinutes:
      input.rainfallWindowMinutes ?? RAINFALL_AGGREGATIONS.defaultWindow * 60,
  };
}

export default {
  computeRainfallFeatures,
  computeAtmosphericFeatures,
  computeImergFeatures,
  buildFeatureSet,
};
