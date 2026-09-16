/**
 * GET /api/imerg/rainfall?lat=&lon=&horizon=
 *
 * Returns the satellite-derived rainfall series (GPM IMERG, with
 * transparent fallback to Open-Meteo hourly precipitation) for a point.
 *
 * Each reading is tagged with its source so consumers can distinguish
 * real IMERG granule data from the Open-Meteo fallback.
 *
 * Query params:
 *   - lat (required) — latitude in decimal degrees
 *   - lon (required) — longitude in decimal degrees
 *   - horizon (optional, minutes, default = 60) — lookback window for
 *     the rainfall series.
 */

import { NextResponse } from "next/server";
import { providerRegistry } from "@/lib/adapters/registry";
import { logger } from "@/lib/config/logger";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get("lat") ?? "");
  const lon = Number(url.searchParams.get("lon") ?? "");
  const horizonParam = Number(url.searchParams.get("horizon") ?? "60");
  const horizonMinutes =
    Number.isFinite(horizonParam) && horizonParam > 0
      ? Math.min(Math.floor(horizonParam), 24 * 60)
      : 60;

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json(
      {
        error: "Missing or invalid 'lat' / 'lon' query parameters",
        example: "/api/imerg/rainfall?lat=19.076&lon=72.8777&horizon=180",
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
        horizonMinutes,
        readings: [],
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

    // Aggregate into a few summary stats for the dashboard sparkline.
    const total = readings.reduce((a, r) => a + (r.rainfallMm ?? 0), 0);
    const max = readings.reduce(
      (a, r) => Math.max(a, r.rainfallMm ?? 0),
      0,
    );
    const wetCount = readings.filter((r) => (r.rainfallMm ?? 0) > 0.1).length;

    return NextResponse.json({
      ok: true,
      lat,
      lon,
      horizonMinutes,
      provider: satellite.info,
      count: readings.length,
      summary: {
        totalMm: Number(total.toFixed(2)),
        maxMm: Number(max.toFixed(2)),
        wetReadings: wetCount,
        wetFraction:
          readings.length > 0
            ? Number((wetCount / readings.length).toFixed(3))
            : 0,
      },
      readings: readings.map((r) => ({
        time: r.time,
        rainfallMm: r.rainfallMm,
        durationMinutes: r.durationMinutes,
        source: r.source,
        sensor: r.sensor,
        passTime: r.passTime,
        isDevData: r.isDevData,
      })),
    });
  } catch (err) {
    logger.error("api.imerg.rainfall.error", {
      lat,
      lon,
      error: (err as Error).message,
    });
    return NextResponse.json(
      {
        ok: false,
        lat,
        lon,
        horizonMinutes,
        error: (err as Error).message,
        readings: [],
      },
      { status: 502 },
    );
  }
}
