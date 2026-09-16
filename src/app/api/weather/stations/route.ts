/**
 * GET /api/weather/stations
 *
 * Returns the list of WeatherStation rows that have been synced from the
 * configured providers. Each station includes the latest observation and
 * rainfall reading so the dashboard can render the station table without
 * N+1 client-side requests.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { CITIES as INDIAN_CITIES } from "@/lib/weather/cities";
import { logger } from "@/lib/config/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  // Materialise the 16 canonical stations from the city registry so the
  // response is non-empty even on a fresh DB. Each city gets a deterministic
  // stationCode derived from its rounded coordinates.
  const canonicalStations = INDIAN_CITIES.map((city) => ({
    stationCode: `om-${city.latitude.toFixed(3)}-${city.longitude.toFixed(3)}`,
    name: `${city.name} (${city.state})`,
    latitude: city.latitude,
    longitude: city.longitude,
    elevationM: city.elevationM ?? null,
    source: "open-meteo",
  }));

  try {
    // Upsert each canonical station so the DB reflects the city registry.
    for (const s of canonicalStations) {
      try {
        await db.weatherStation.upsert({
          where: { stationCode: s.stationCode },
          create: s,
          update: {
            name: s.name,
            latitude: s.latitude,
            longitude: s.longitude,
            elevationM: s.elevationM,
            source: s.source,
          },
        });
      } catch (err) {
        logger.warn("api.weather.stations.upsert-failed", {
          stationCode: s.stationCode,
          error: (err as Error).message,
        });
      }
    }

    const stations = await db.weatherStation.findMany({
      orderBy: { name: "asc" },
      include: {
        observations: {
          orderBy: { observationTime: "desc" },
          take: 1,
        },
        rainfallData: {
          orderBy: { observationTime: "desc" },
          take: 1,
        },
      },
    });

    return NextResponse.json({
      ok: true,
      count: stations.length,
      canonicalCityCount: canonicalStations.length,
      stations: stations.map((s) => ({
        id: s.id,
        stationCode: s.stationCode,
        name: s.name,
        latitude: s.latitude,
        longitude: s.longitude,
        elevationM: s.elevationM,
        source: s.source,
        isDevData: s.isDevData,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        latestObservation: s.observations[0] ?? null,
        latestRainfall: s.rainfallData[0] ?? null,
      })),
    });
  } catch (err) {
    logger.error("api.weather.stations.error", {
      error: (err as Error).message,
    });
    return NextResponse.json(
      {
        ok: false,
        error: (err as Error).message,
        canonicalStations,
      },
      { status: 500 },
    );
  }
}
