/**
 * GET /api/weather/forecast?lat=&lon=&horizon=
 *
 * Fetches a single-location weather forecast (current + hourly + daily)
 * via the unified weather fetcher. Optionally persists a WeatherObservation
 * row so subsequent `/api/weather/observations` calls have data to return.
 *
 * Query params:
 *   - lat (required)   latitude in decimal degrees
 *   - lon (required)   longitude in decimal degrees
 *   - horizon (optional, minutes) — informational; the forecast horizon
 *     reported by the provider is fixed (7 days for Open-Meteo, 5 days
 *     for OpenWeatherMap).
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fetchWeather } from "@/lib/weather/unified-fetch";
import { FORECAST_HORIZONS, SYSTEM } from "@/lib/config/config";
import { logger } from "@/lib/config/logger";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get("lat") ?? "");
  const lon = Number(url.searchParams.get("lon") ?? "");
  const horizonParam = Number(url.searchParams.get("horizon") ?? "");
  const horizonMinutes =
    Number.isFinite(horizonParam) && horizonParam > 0
      ? horizonParam
      : FORECAST_HORIZONS.medium;

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json(
      {
        error: "Missing or invalid 'lat' / 'lon' query parameters",
        example: "/api/weather/forecast?lat=13.0827&lon=80.2707&horizon=360",
      },
      { status: 400 },
    );
  }

  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return NextResponse.json(
      { error: "lat/lon out of valid range" },
      { status: 400 },
    );
  }

  try {
    const weather = await fetchWeather({
      latitude: lat,
      longitude: lon,
      timeoutMs: 15000,
    });

    // Persist a WeatherObservation row tagged to a synthetic station code
    // so the observations endpoint can read it back. We upsert the station
    // row keyed on the rounded lat/lon — every distinct ~1 km cell gets one
    // station row.
    try {
      const stationCode = `om-${lat.toFixed(3)}-${lon.toFixed(3)}`;
      const station = await db.weatherStation.upsert({
        where: { stationCode },
        create: {
          stationCode,
          name: `Open-Meteo cell (${lat.toFixed(3)}, ${lon.toFixed(3)})`,
          latitude: lat,
          longitude: lon,
          source: weather.source,
        },
        update: {},
      });

      await db.weatherObservation.create({
        data: {
          stationId: station.id,
          observationTime: new Date(weather.current.time),
          temperatureC: weather.current.temperatureC ?? null,
          humidityPercent: weather.current.humidityPercent ?? null,
          pressureHpa: weather.current.pressureHpa ?? null,
          windSpeedMs: weather.current.windSpeedMs ?? null,
          windDirectionDeg: weather.current.windDirectionDeg ?? null,
          rainfallMm: weather.current.precipitationMm ?? null,
          weatherCode: weather.current.weatherCode ?? null,
          cloudCoverPct: weather.current.cloudCoverPct ?? null,
          source: weather.source,
        },
      });
    } catch (err) {
      logger.warn("api.weather.forecast.persist-failed", {
        error: (err as Error).message,
      });
    }

    return NextResponse.json({
      ok: true,
      requestedAt: new Date().toISOString(),
      horizonMinutes,
      system: {
        timezone: SYSTEM.timezone,
        isDevData: SYSTEM.isDevData,
      },
      weather,
    });
  } catch (err) {
    logger.error("api.weather.forecast.error", {
      lat,
      lon,
      error: (err as Error).message,
    });
    return NextResponse.json(
      {
        ok: false,
        error: (err as Error).message,
        lat,
        lon,
        horizonMinutes,
      },
      { status: 502 },
    );
  }
}
