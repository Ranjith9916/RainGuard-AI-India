/**
 * Alert pipeline.
 *
 * Orchestrates the end-to-end prediction run for the configured city
 * network:
 *   1. Fetch weather for every city (in parallel, bounded concurrency)
 *   2. Build feature sets from the weather response
 *   3. Run the baseline ML predictions
 *   4. Evaluate the alert engine per-city
 *
 * Returns a structured `PipelineRunResult` that callers can persist to the
 * `PipelineRun` and `Alert` tables.
 */

import { logger } from "@/lib/config/logger";
import { CITIES, type City } from "@/lib/weather/cities";
import { fetchWeather } from "@/lib/weather/unified-fetch";
import {
  buildFeatureSet,
  type FeatureSet,
} from "@/lib/features/feature-engineering";
import {
  runFullPrediction,
  type FullPredictionResult,
} from "@/lib/ml/baselines";
import { evaluateAlert, type AlertEvent } from "@/lib/alerts/engine";
import type { CityWeatherPayload } from "@/lib/weather/types";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

export interface CityPipelineResult {
  city: City;
  features?: FeatureSet;
  prediction?: FullPredictionResult;
  alert: AlertEvent | null;
  payload?: CityWeatherPayload;
  error?: string;
  durationMs: number;
}

export interface PipelineRunResult {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  citiesProcessed: number;
  citiesSucceeded: number;
  citiesFailed: number;
  alertsEmitted: number;
  results: CityPipelineResult[];
}

/* -------------------------------------------------------------------------- */
/*  Concurrency                                                              */
/* -------------------------------------------------------------------------- */

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return results;
}

/* -------------------------------------------------------------------------- */
/*  Per-city runner                                                          */
/* -------------------------------------------------------------------------- */

async function processCity(city: City): Promise<CityPipelineResult> {
  const start = Date.now();
  try {
    const weather = await fetchWeather({
      latitude: city.latitude,
      longitude: city.longitude,
      timeoutMs: 15000,
    });

    const features = buildFeatureSet({
      hourly: weather.hourly,
      current: weather.current,
    });

    const prediction = runFullPrediction(features);

    const alertInput = {
      cityId: city.id,
      cityName: city.name,
      state: city.state,
      latitude: city.latitude,
      longitude: city.longitude,
      heavyRainProbability: prediction.heavyRain.probability,
      floodProbability: prediction.floodProbability.probability,
      inundationDepthM: prediction.inundation.depthM,
      forecastRainfallMm: prediction.rainfallForecast.forecastRainfallMm,
      riskLevel: prediction.combinedRiskLevel,
      predictionTime: prediction.computedAt,
      source: weather.source,
      isBaseline: prediction.allBaselines,
    };
    const alert = evaluateAlert(alertInput);

    const payload: CityWeatherPayload = {
      cityId: city.id,
      cityName: city.name,
      state: city.state,
      latitude: city.latitude,
      longitude: city.longitude,
      population: city.population,
      fetchedAt: weather.fetchedAt,
      current: weather.current,
      hourly: weather.hourly,
      forecast: weather.forecast,
      heavyRainProbability: prediction.heavyRain.probability,
      forecastRainfallMm: prediction.rainfallForecast.forecastRainfallMm,
      floodProbability: prediction.floodProbability.probability,
      inundationDepthM: prediction.inundation.depthM,
      riskLevel: prediction.combinedRiskLevel,
      directive: prediction.inundation.directive,
      actions: prediction.inundation.actions,
      source: weather.source,
      isDevData: weather.isDevData,
    };

    return {
      city,
      features,
      prediction,
      alert,
      payload,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    logger.warn("pipeline.city.error", {
      cityId: city.id,
      error: String(err),
    });
    return {
      city,
      error: (err as Error).message,
      alert: null,
      durationMs: Date.now() - start,
    };
  }
}

/* -------------------------------------------------------------------------- */
/*  Public pipeline                                                          */
/* -------------------------------------------------------------------------- */

export interface RunPipelineOptions {
  /** Override the city list (default = all 16). */
  cities?: City[];
  /** Max concurrent city fetches (default 8). */
  concurrency?: number;
}

export async function runPredictionPipeline(
  options: RunPipelineOptions = {},
): Promise<PipelineRunResult> {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const cities = options.cities ?? CITIES;
  const concurrency = options.concurrency ?? 8;

  logger.info("pipeline.start", {
    cityCount: cities.length,
    concurrency,
  });

  const results = await mapWithConcurrency(
    cities,
    concurrency,
    processCity,
  );

  const succeeded = results.filter((r) => !r.error).length;
  const failed = results.length - succeeded;
  const alertsEmitted = results.filter((r) => r.alert != null).length;

  const result: PipelineRunResult = {
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startMs,
    citiesProcessed: results.length,
    citiesSucceeded: succeeded,
    citiesFailed: failed,
    alertsEmitted,
    results,
  };

  logger.info("pipeline.complete", {
    durationMs: result.durationMs,
    succeeded,
    failed,
    alertsEmitted,
  });

  return result;
}

export default { runPredictionPipeline };
