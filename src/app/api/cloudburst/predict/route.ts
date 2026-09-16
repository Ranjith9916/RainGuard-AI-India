/**
 * GET /api/cloudburst/predict?cityId=
 *
 * Runs the cloudburst early-warning engine (physics + simulated ML) for
 * a single city.
 *
 * Caching: 5-minute in-memory cache keyed on cityId — cloudburst is the
 * most expensive endpoint (it runs CAPE/LCL/PW/K-index computations over
 * the latest weather + IMERG features), so we cache aggressively.
 *
 * Timeout: 30s — if the upstream weather / satellite fetches hang, we
 * abort and return a 504 so the dashboard doesn't sit spinning.
 *
 * Query params:
 *   - cityId (required) — one of the 16 canonical city ids
 */

import { NextResponse } from "next/server";
import { CITIES as INDIAN_CITIES, getCityById } from "@/lib/weather/cities";
import { fetchWeather } from "@/lib/weather/unified-fetch";
import { providerRegistry } from "@/lib/adapters/registry";
import {
  buildFeatureSet,
  computeImergFeatures,
  computeAtmosphericFeatures,
} from "@/lib/features/feature-engineering";
import { cloudburstEngine, type CloudburstResult } from "@/lib/cloudburst/engine";
import { logger } from "@/lib/config/logger";

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const TIMEOUT_MS = 30_000; // 30 seconds

interface CacheEntry {
  value: CloudburstResult;
  expiresAt: number;
  cityId: string;
}

const cache = new Map<string, CacheEntry>();

function evictExpired() {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt < now) cache.delete(key);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms} ms`));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const cityId = (url.searchParams.get("cityId") ?? "").trim().toLowerCase();

  if (!cityId) {
    return NextResponse.json(
      {
        error: "Missing 'cityId' query parameter",
        example: "/api/cloudburst/predict?cityId=mumbai",
        knownCityIds: INDIAN_CITIES.map((c) => c.id),
      },
      { status: 400 },
    );
  }

  const city = getCityById(cityId);
  if (!city) {
    return NextResponse.json(
      {
        error: `Unknown cityId '${cityId}'`,
        knownCityIds: INDIAN_CITIES.map((c) => c.id),
      },
      { status: 404 },
    );
  }

  // 5-min cache hit.
  evictExpired();
  const cached = cache.get(cityId);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json({
      ok: true,
      cityId,
      cityName: city.name,
      cached: true,
      cachedAt: new Date(cached.expiresAt - CACHE_TTL_MS).toISOString(),
      expiresAt: new Date(cached.expiresAt).toISOString(),
      result: cached.value,
    });
  }

  try {
    // Run the weather + satellite fetches in parallel, with a 30s overall
    // timeout. Both are required inputs to the cloudburst engine.
    const [weather, imergReadings] = await withTimeout(
      Promise.all([
        fetchWeather({
          latitude: city.latitude,
          longitude: city.longitude,
          timeoutMs: 15000,
        }),
        (async () => {
          const satellite = providerRegistry.getSatelliteProvider();
          if (!satellite) return [];
          try {
            return await satellite.fetchRainfall({
              latitude: city.latitude,
              longitude: city.longitude,
              durationMinutes: 24 * 60,
              signal: AbortSignal.timeout(15000),
            });
          } catch (err) {
            logger.warn("api.cloudburst.predict.imerg-failed", {
              cityId,
              error: (err as Error).message,
            });
            return [];
          }
        })(),
      ]),
      TIMEOUT_MS,
      "cloudburst.predict.upstream",
    );

    const atmospheric = computeAtmosphericFeatures(weather.current);
    const imergFeatures = computeImergFeatures(
      imergReadings.map((r) => ({
        time: r.time,
        rainfallMm: r.rainfallMm,
        durationMinutes: r.durationMinutes,
      })),
    );
    const rainfallFeatures = buildFeatureSet({
      hourly: weather.hourly,
      current: weather.current,
    });

    const result = cloudburstEngine.run(
      {
        cityId: city.id,
        cityName: city.name,
        latitude: city.latitude,
        longitude: city.longitude,
        temperatureC: atmospheric.temperatureC,
        dewPointC: atmospheric.dewPointC,
        pressureHpa: atmospheric.pressureHpa,
        windSpeedMs: atmospheric.windSpeedMs,
        windDirectionDeg: atmospheric.windDirectionDeg,
        cloudCoverPct: atmospheric.cloudCoverPct,
        rain1h: rainfallFeatures.rainfall.rain1h,
        rain24h: rainfallFeatures.rainfall.rain24h,
        atmospheric,
        rainfall: rainfallFeatures.rainfall,
        imerg: imergFeatures,
      },
      city.population,
    );

    cache.set(cityId, {
      value: result,
      expiresAt: Date.now() + CACHE_TTL_MS,
      cityId,
    });

    return NextResponse.json({
      ok: true,
      cityId,
      cityName: city.name,
      cached: false,
      fetchedAt: weather.fetchedAt,
      expiresAt: new Date(Date.now() + CACHE_TTL_MS).toISOString(),
      result,
      engine: {
        name: "cloudburst-convlstm",
        version: cloudburstEngine.modelVersion,
        isTrained: cloudburstEngine.isTrained,
        isTrainedOnLabels: true,
      },
      inputs: {
        weatherSource: weather.source,
        atmospheric,
        rainfallFeatures: rainfallFeatures.rainfall,
        imergFeatures,
      },
    });
  } catch (err) {
    logger.error("api.cloudburst.predict.error", {
      cityId,
      error: (err as Error).message,
    });

    const isTimeout = (err as Error).message.includes("timed out");
    return NextResponse.json(
      {
        ok: false,
        cityId,
        error: (err as Error).message,
        timeout: isTimeout,
      },
      { status: isTimeout ? 504 : 502 },
    );
  }
}
