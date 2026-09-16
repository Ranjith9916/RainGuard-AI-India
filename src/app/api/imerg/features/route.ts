/**
 * GET /api/imerg/features?lat=&lon=&horizon=
 *
 * Returns the IMERG-derived feature block (latestHalfHourMm, imerg1h,
 * imerg3h, imerg6h, imerg24h, meanRate, wetFraction, isHeavy) used by
 * the flood-probability baseline as the `imerg` term in the logistic.
 *
 * The features are computed against the satellite rainfall series
 * returned by the active satellite provider (GPM IMERG or the Open-Meteo
 * fallback).
 *
 * Query params:
 *   - lat (required) — latitude in decimal degrees
 *   - lon (required) — longitude in decimal degrees
 *   - horizon (optional, minutes, default = 1440) — lookback window.
 *     The feature block uses up to 48 half-hourly readings (24h) —
 *     longer horizons just give more context for the wetFraction calc.
 */

import { NextResponse } from "next/server";
import { providerRegistry } from "@/lib/adapters/registry";
import { computeImergFeatures } from "@/lib/features/feature-engineering";
import { logger } from "@/lib/config/logger";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get("lat") ?? "");
  const lon = Number(url.searchParams.get("lon") ?? "");
  const horizonParam = Number(url.searchParams.get("horizon") ?? "1440");
  const horizonMinutes =
    Number.isFinite(horizonParam) && horizonParam > 0
      ? Math.min(Math.floor(horizonParam), 24 * 60)
      : 1440;

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json(
      {
        error: "Missing or invalid 'lat' / 'lon' query parameters",
        example: "/api/imerg/features?lat=19.076&lon=72.8777&horizon=1440",
      },
      { status: 400 },
    );
  }

  const satellite = providerRegistry.getSatelliteProvider();
  if (!satellite) {
    return NextResponse.json(
      {
        ok: false,
        error: "satellite provider is disabled in the registry",
        lat,
        lon,
      },
      { status: 503 },
    );
  }

  try {
    const readings = await satellite.fetchRainfall({
      latitude: lat,
      longitude: lon,
      durationMinutes: horizonMinutes,
      signal: AbortSignal.timeout(15000),
    });

    // Map SatelliteRainfallReading → ImergReadingLike for the feature calc.
    const features = computeImergFeatures(
      readings.map((r) => ({
        time: r.time,
        rainfallMm: r.rainfallMm,
        durationMinutes: r.durationMinutes,
      })),
    );

    return NextResponse.json({
      ok: true,
      lat,
      lon,
      horizonMinutes,
      provider: satellite.info,
      readingCount: readings.length,
      features,
      // Echo the raw readings so callers can recompute features with a
      // different aggregation window client-side if needed.
      readings: readings.map((r) => ({
        time: r.time,
        rainfallMm: r.rainfallMm,
        durationMinutes: r.durationMinutes,
        source: r.source,
        sensor: r.sensor,
      })),
    });
  } catch (err) {
    logger.error("api.imerg.features.error", {
      lat,
      lon,
      error: (err as Error).message,
    });
    return NextResponse.json(
      {
        ok: false,
        lat,
        lon,
        error: (err as Error).message,
        features: null,
      },
      { status: 502 },
    );
  }
}
