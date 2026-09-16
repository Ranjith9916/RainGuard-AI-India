/**
 * GET /api/predictions/inundation?horizon=
 *
 * Returns the inundation-depth prediction (NRCS Curve-Number baseline)
 * for every city. For each city the response includes:
 *   - depthM  — predicted runoff depth in metres
 *   - level   — LOW / MODERATE / HIGH / CRITICAL
 *   - directive — public-facing one-liner
 *   - actions  — recommended actions list
 *
 * Query params:
 *   - horizon (optional, minutes, default = FORECAST_HORIZONS.medium = 360)
 */

import { NextResponse } from "next/server";
import { CITIES as INDIAN_CITIES } from "@/lib/weather/cities";
import { fetchWeather } from "@/lib/weather/unified-fetch";
import { buildFeatureSet } from "@/lib/features/feature-engineering";
import { predictInundation } from "@/lib/ml/baselines";
import { FORECAST_HORIZONS, RISK_THRESHOLDS } from "@/lib/config/config";
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
        const prediction = predictInundation(features);

        return {
          cityId: city.id,
          cityName: city.name,
          state: city.state,
          population: city.population,
          ok: true,
          durationMs: Date.now() - t0,
          prediction,
          rainfall24hMm: features.rainfall.rain24h,
          source: weather.source,
          fetchedAt: weather.fetchedAt,
        };
      } catch (err) {
        logger.warn("api.predictions.inundation.city-error", {
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
  const criticalCount = results.filter(
    (r) =>
      r.ok &&
      "prediction" in r &&
      (r.prediction as { level?: string }).level === "CRITICAL",
  ).length;

  return NextResponse.json({
    ok: true,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startMs,
    horizonMinutes,
    thresholds: RISK_THRESHOLDS,
    citiesProcessed: results.length,
    citiesSucceeded: succeeded,
    citiesFailed: results.length - succeeded,
    criticalInundationCities: criticalCount,
    model: {
      name: "inundation-baseline",
      version: "0.1.0",
      type: "baseline",
      isBaseline: true,
      description:
        "NRCS Curve-Number runoff → uniform-depth-on-area approximation.",
    },
    results,
  });
}
