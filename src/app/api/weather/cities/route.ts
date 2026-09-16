/**
 * GET /api/weather/cities?horizon=N
 *
 * Fetches weather for all 16 Indian cities in bounded batches and runs
 * the alert pipeline against each. Persists each alert emitted to the DB
 * (de-duped upstream by the AlertDeduper on city+level+hour).
 *
 * Query params:
 *   - horizon (minutes, optional, default = FORECAST_HORIZONS.medium = 360)
 *
 * This is the heaviest endpoint — every refresh fans out 16 weather API
 * calls. Callers should poll at most once per 5 minutes and respect the
 * upstream provider rate limits.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { CITIES as INDIAN_CITIES } from "@/lib/weather/cities";
import { fetchWeather } from "@/lib/weather/unified-fetch";
import {
  buildFeatureSet,
  computeAtmosphericFeatures,
} from "@/lib/features/feature-engineering";
import {
  forecastRainfall,
  predictFloodProbability,
  predictHeavyRain,
  predictInundation,
  runFullPrediction,
} from "@/lib/ml/baselines";
import { evaluateAlert } from "@/lib/alerts/engine";
import { FORECAST_HORIZONS } from "@/lib/config/config";
import { logger } from "@/lib/config/logger";
import type { CityWeatherPayload } from "@/lib/weather/types";

export const dynamic = "force-dynamic";

const CONCURRENCY = 8;

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = new Array(Math.min(limit, items.length))
    .fill(0)
    .map(async () => {
      while (true) {
        const i = cursor++;
        if (i >= items.length) return;
        results[i] = await fn(items[i]!);
      }
    });
  await Promise.all(workers);
  return results;
}

export async function GET(request: Request) {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  const url = new URL(request.url);
  const horizonParam = Number(url.searchParams.get("horizon") ?? "");
  const horizonMinutes =
    Number.isFinite(horizonParam) && horizonParam > 0
      ? horizonParam
      : FORECAST_HORIZONS.medium;

  logger.info("api.weather.cities.start", { horizonMinutes });

  const results = await mapWithConcurrency(
    INDIAN_CITIES,
    CONCURRENCY,
    async (city) => {
      const t0 = Date.now();
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

        // Re-derive predictions using the requested horizon so the response
        // is internally consistent with the `?horizon=` query.
        const heavyRain = predictHeavyRain(features.rainfall);
        const rainfallForecast = forecastRainfall(
          features.rainfall,
          horizonMinutes,
        );
        const floodProbability = predictFloodProbability(features);
        const inundation = predictInundation(features);
        const full = runFullPrediction(features);

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
          heavyRainProbability: heavyRain.probability,
          forecastRainfallMm: rainfallForecast.forecastRainfallMm,
          floodProbability: floodProbability.probability,
          inundationDepthM: inundation.depthM,
          riskLevel: full.combinedRiskLevel,
          directive: inundation.directive,
          actions: inundation.actions,
          source: weather.source,
          isDevData: weather.isDevData,
        };

        // Evaluate + persist the alert (de-duped upstream).
        const alert = evaluateAlert({
          cityId: city.id,
          cityName: city.name,
          state: city.state,
          latitude: city.latitude,
          longitude: city.longitude,
          heavyRainProbability: heavyRain.probability,
          floodProbability: floodProbability.probability,
          inundationDepthM: inundation.depthM,
          forecastRainfallMm: rainfallForecast.forecastRainfallMm,
          riskLevel: full.combinedRiskLevel,
          predictionTime: full.computedAt,
          source: weather.source,
          isBaseline: full.allBaselines,
        });

        if (alert) {
          try {
            await db.alert.upsert({
              where: { alertId: alert.alertId },
              create: {
                alertId: alert.alertId,
                level: alert.level,
                status: "active",
                title: alert.title,
                cityId: alert.cityId,
                latitude: alert.latitude,
                longitude: alert.longitude,
                locationName: alert.cityName,
                reason: alert.reason,
                expectedRainfallMm: alert.expectedRainfallMm ?? null,
                floodProbability: alert.floodProbability ?? null,
                expectedInundationM: alert.expectedInundationM ?? null,
                recommendedAction: alert.recommendedAction,
                triggeredAt: new Date(alert.triggeredAt),
              },
              update: {
                level: alert.level,
                reason: alert.reason,
                floodProbability: alert.floodProbability ?? null,
                expectedRainfallMm: alert.expectedRainfallMm ?? null,
              },
            });
          } catch (err) {
            logger.warn("api.weather.cities.alert-persist-failed", {
              alertId: alert.alertId,
              error: (err as Error).message,
            });
          }
        }

        // Touch the atmospheric features so the import isn't tree-shaken —
        // downstream consumers (cloudburst endpoint) recompute them, but
        // keeping the import explicit makes the contract obvious.
        void computeAtmosphericFeatures;

        return {
          cityId: city.id,
          cityName: city.name,
          state: city.state,
          ok: true,
          durationMs: Date.now() - t0,
          payload,
          alert,
        };
      } catch (err) {
        return {
          cityId: city.id,
          cityName: city.name,
          state: city.state,
          ok: false,
          durationMs: Date.now() - t0,
          error: (err as Error).message,
        };
      }
    },
  );

  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.length - succeeded;
  const alertsEmitted = results.filter(
    (r) => r.ok && r.alert != null,
  ).length;

  return NextResponse.json({
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startMs,
    horizonMinutes,
    citiesProcessed: results.length,
    citiesSucceeded: succeeded,
    citiesFailed: failed,
    alertsEmitted,
    results,
  });
}
