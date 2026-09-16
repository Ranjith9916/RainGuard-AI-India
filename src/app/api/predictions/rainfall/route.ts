/**
 * GET /api/predictions/rainfall?horizon=
 *
 * Returns the rainfall-forecast baseline for every city, computed against
 * the requested horizon.
 *
 * Query params:
 *   - horizon (optional, minutes, default = FORECAST_HORIZONS.medium = 360)
 */

import { NextResponse } from "next/server";
import { CITIES as INDIAN_CITIES } from "@/lib/weather/cities";
import { fetchWeather } from "@/lib/weather/unified-fetch";
import { buildFeatureSet } from "@/lib/features/feature-engineering";
import { forecastRainfall } from "@/lib/ml/baselines";
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
        const forecast = forecastRainfall(features.rainfall, horizonMinutes);

        return {
          cityId: city.id,
          cityName: city.name,
          state: city.state,
          ok: true,
          durationMs: Date.now() - t0,
          forecast,
          rainfallFeatures: features.rainfall,
          source: weather.source,
          fetchedAt: weather.fetchedAt,
        };
      } catch (err) {
        logger.warn("api.predictions.rainfall.city-error", {
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

  return NextResponse.json({
    ok: true,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startMs,
    horizonMinutes,
    citiesProcessed: results.length,
    citiesSucceeded: succeeded,
    citiesFailed: results.length - succeeded,
    model: {
      name: "rainfall-forecast-baseline",
      version: "0.1.0",
      type: "baseline",
      isBaseline: true,
      description:
        "Persistence + linear extrapolation baseline. Confidence is capped at 0.45.",
    },
    results,
  });
}
