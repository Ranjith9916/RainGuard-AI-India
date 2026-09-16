/**
 * GET /api/risk/current?horizon=
 *
 * Returns the full flood-prediction bundle for every city in the registry,
 * computed against the requested forecast horizon. Each per-city payload
 * contains the heavy-rain / rainfall-forecast / flood-probability /
 * inundation sub-predictions as well as the combined risk bucket.
 *
 * Query params:
 *   - horizon (optional, minutes, default = FORECAST_HORIZONS.medium = 360)
 *
 * This is a richer sibling of /api/weather/cities — it returns the
 * per-model prediction breakdown instead of just the alert-ready summary.
 */

import { NextResponse } from "next/server";
import { CITIES as INDIAN_CITIES } from "@/lib/weather/cities";
import { fetchWeather } from "@/lib/weather/unified-fetch";
import { buildFeatureSet } from "@/lib/features/feature-engineering";
import {
  forecastRainfall,
  predictFloodProbability,
  predictHeavyRain,
  predictInundation,
  runFullPrediction,
} from "@/lib/ml/baselines";
import { FORECAST_HORIZONS } from "@/lib/config/config";
import { logger } from "@/lib/config/logger";

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

        const heavyRain = predictHeavyRain(features.rainfall);
        const rainfallForecast = forecastRainfall(
          features.rainfall,
          horizonMinutes,
        );
        const floodProbability = predictFloodProbability(features);
        const inundation = predictInundation(features);
        const full = runFullPrediction(features);

        return {
          cityId: city.id,
          cityName: city.name,
          state: city.state,
          latitude: city.latitude,
          longitude: city.longitude,
          population: city.population,
          ok: true,
          durationMs: Date.now() - t0,
          fetchedAt: weather.fetchedAt,
          source: weather.source,
          horizonMinutes,
          features: {
            rainfall: features.rainfall,
            atmospheric: features.atmospheric,
            computedAt: features.computedAt,
          },
          heavyRain,
          rainfallForecast,
          floodProbability,
          inundation,
          combinedRiskLevel: full.combinedRiskLevel,
          allBaselines: full.allBaselines,
        };
      } catch (err) {
        logger.warn("api.risk.current.city-error", {
          cityId: city.id,
          error: (err as Error).message,
        });
        return {
          cityId: city.id,
          cityName: city.name,
          ok: false,
          durationMs: Date.now() - t0,
          error: (err as Error).message,
        };
      }
    },
  );

  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.length - succeeded;
  const maxRisk = results
    .filter((r) => r.ok)
    .map((r) =>
      "combinedRiskLevel" in r ? (r as { combinedRiskLevel: string }).combinedRiskLevel : "LOW",
    )
    .reduce<string>((acc, lvl) => {
      const order = ["LOW", "MODERATE", "HIGH", "CRITICAL"];
      return order.indexOf(lvl) > order.indexOf(acc) ? lvl : acc;
    }, "LOW");

  return NextResponse.json({
    ok: true,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startMs,
    horizonMinutes,
    citiesProcessed: results.length,
    citiesSucceeded: succeeded,
    citiesFailed: failed,
    networkMaxRisk: maxRisk,
    results,
  });
}
