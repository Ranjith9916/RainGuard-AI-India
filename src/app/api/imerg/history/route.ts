/**
 * GET /api/imerg/history?cityId=&days=
 *
 * Returns IMERG-tagged rainfall records persisted to the RainfallRecord
 * table for a city. Falls back to a live fetch when no DB rows exist or
 * when `days` is larger than the available history.
 *
 * Query params:
 *   - cityId (required) — one of the 16 canonical city ids
 *   - days (optional, default = 7) — lookback window in days (max 90)
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { CITIES as INDIAN_CITIES, getCityById } from "@/lib/weather/cities";
import { providerRegistry } from "@/lib/adapters/registry";
import { logger } from "@/lib/config/logger";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const cityId = (url.searchParams.get("cityId") ?? "").trim().toLowerCase();
  const daysParam = Number(url.searchParams.get("days") ?? "7");
  const days =
    Number.isFinite(daysParam) && daysParam > 0
      ? Math.min(Math.floor(daysParam), 90)
      : 7;

  if (!cityId) {
    return NextResponse.json(
      {
        error: "Missing 'cityId' query parameter",
        example: "/api/imerg/history?cityId=mumbai&days=7",
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

  const since = new Date(Date.now() - days * 86400 * 1000);

  // Pull persisted IMERG rows. We tag IMERG rows with `source` starting
  // with "gpm-imerg" — the Open-Meteo fallback uses
  // "gpm-imerg-fallback-open-meteo" / "gpm-imerg-proxy-open-meteo".
  let dbRecords: Awaited<ReturnType<typeof db.rainfallRecord.findMany>> = [];
  try {
    dbRecords = await db.rainfallRecord.findMany({
      where: {
        latitude: city.latitude,
        longitude: city.longitude,
        observationTime: { gte: since },
        source: { startsWith: "gpm-imerg" },
      },
      orderBy: { observationTime: "desc" },
      take: 5000,
    });
  } catch (err) {
    logger.warn("api.imerg.history.db-fetch-failed", {
      cityId,
      error: (err as Error).message,
    });
  }

  // If the DB has nothing for this window, live-fetch from the satellite
  // provider so the dashboard always returns *something*.
  let liveRecords: Array<{
    time: string;
    rainfallMm: number;
    durationMinutes: number;
    source: string;
    sensor: string;
    passTime?: string;
  }> = [];

  if (dbRecords.length === 0) {
    const satellite = providerRegistry.getSatelliteProvider();
    if (satellite) {
      try {
        const readings = await satellite.fetchRainfall({
          latitude: city.latitude,
          longitude: city.longitude,
          durationMinutes: Math.min(days * 24 * 60, 24 * 60),
          signal: AbortSignal.timeout(15000),
        });
        liveRecords = readings.map((r) => ({
          time: r.time,
          rainfallMm: r.rainfallMm,
          durationMinutes: r.durationMinutes,
          source: r.source,
          sensor: r.sensor,
          passTime: r.passTime,
        }));

        // Persist the live records so the next call hits the DB.
        try {
          await db.rainfallRecord.createMany({
            data: liveRecords.map((r) => ({
              stationId: null,
              latitude: city.latitude,
              longitude: city.longitude,
              observationTime: new Date(r.time),
              rainfallMm: r.rainfallMm,
              durationMinutes: r.durationMinutes,
              source: r.source,
            })),
          });
        } catch (err) {
          logger.warn("api.imerg.history.persist-failed", {
            cityId,
            error: (err as Error).message,
          });
        }
      } catch (err) {
        logger.warn("api.imerg.history.live-fetch-failed", {
          cityId,
          error: (err as Error).message,
        });
      }
    }
  }

  const all = [
    ...dbRecords.map((r) => ({
      time: r.observationTime,
      rainfallMm: r.rainfallMm,
      durationMinutes: r.durationMinutes,
      source: r.source,
      sensor: "db-record",
    })),
    ...liveRecords,
  ].sort(
    (a, b) => new Date(b.time).getTime() - new Date(a.time).getTime(),
  );

  const totalMm = all.reduce((a, r) => a + r.rainfallMm, 0);
  const maxMm = all.reduce((a, r) => Math.max(a, r.rainfallMm), 0);
  const wetCount = all.filter((r) => r.rainfallMm > 0.1).length;

  return NextResponse.json({
    ok: true,
    cityId,
    cityName: city.name,
    days,
    since,
    count: all.length,
    summary: {
      totalMm: Number(totalMm.toFixed(2)),
      maxMm: Number(maxMm.toFixed(2)),
      wetReadings: wetCount,
      wetFraction:
        all.length > 0 ? Number((wetCount / all.length).toFixed(3)) : 0,
    },
    records: all,
  });
}
