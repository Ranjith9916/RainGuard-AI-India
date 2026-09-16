/**
 * GET /api/weather/observations?cityId=
 *
 * Returns the most recent current-weather observation for a city.
 *
 * Looks up the WeatherStation row keyed on the canonical cityId (e.g.
 * "chennai"), then returns the latest WeatherObservation row for that
 * station. If no station exists yet for the city, the route transparently
 * fetches live weather from the unified provider and persists it before
 * returning — this makes the endpoint self-bootstrapping.
 *
 * Query params:
 *   - cityId (required) — one of the 16 canonical ids (see INDIAN_CITIES)
 */

import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { CITIES as INDIAN_CITIES, getCityById } from "@/lib/weather/cities";
import { fetchWeather } from "@/lib/weather/unified-fetch";
import { logger } from "@/lib/config/logger";

export const dynamic = "force-dynamic";

type StationRow = Prisma.WeatherStationGetPayload<object>;
type ObservationRow = Prisma.WeatherObservationGetPayload<object>;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const cityId = (url.searchParams.get("cityId") ?? "").trim().toLowerCase();

  if (!cityId) {
    return NextResponse.json(
      {
        error: "Missing 'cityId' query parameter",
        example: "/api/weather/observations?cityId=chennai",
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

  const stationCode = `om-${city.latitude.toFixed(3)}-${city.longitude.toFixed(3)}`;

  // Ensure the station row exists for this city.
  let station: StationRow | null = null;
  try {
    station = await db.weatherStation.upsert({
      where: { stationCode },
      create: {
        stationCode,
        name: `${city.name} (${city.state})`,
        latitude: city.latitude,
        longitude: city.longitude,
        elevationM: city.elevationM ?? null,
        source: "open-meteo",
      },
      update: {},
    });
  } catch (err) {
    logger.warn("api.weather.observations.station-upsert-failed", {
      cityId,
      error: (err as Error).message,
    });
  }

  // Pull the latest persisted observation if any.
  let observation: ObservationRow | null = null;
  if (station) {
    try {
      observation = await db.weatherObservation.findFirst({
        where: { stationId: station.id },
        orderBy: { observationTime: "desc" },
      });
    } catch (err) {
      logger.warn("api.weather.observations.query-failed", {
        cityId,
        error: (err as Error).message,
      });
    }
  }

  // If no observation is fresh (< 15 min), live-fetch + persist.
  const FRESH_MS = 15 * 60 * 1000;
  const isStale =
    !observation ||
    Date.now() - new Date(observation.observationTime).getTime() > FRESH_MS;

  if (isStale) {
    try {
      const weather = await fetchWeather({
        latitude: city.latitude,
        longitude: city.longitude,
        timeoutMs: 15000,
      });

      if (station) {
        observation = await db.weatherObservation.create({
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
      }

      return NextResponse.json({
        ok: true,
        cityId,
        cityName: city.name,
        station: station
          ? {
              id: station.id,
              stationCode: station.stationCode,
              name: station.name,
            }
          : null,
        observation: observation
          ? {
              id: observation.id,
              observationTime: observation.observationTime,
              temperatureC: observation.temperatureC,
              humidityPercent: observation.humidityPercent,
              pressureHpa: observation.pressureHpa,
              windSpeedMs: observation.windSpeedMs,
              windDirectionDeg: observation.windDirectionDeg,
              rainfallMm: observation.rainfallMm,
              weatherCode: observation.weatherCode,
              cloudCoverPct: observation.cloudCoverPct,
              source: observation.source,
            }
          : null,
        fetchedFromLiveApi: true,
      });
    } catch (err) {
      logger.error("api.weather.observations.live-fetch-failed", {
        cityId,
        error: (err as Error).message,
      });
      return NextResponse.json(
        {
          ok: false,
          cityId,
          error: (err as Error).message,
          staleObservation: observation,
        },
        { status: 502 },
      );
    }
  }

  return NextResponse.json({
    ok: true,
    cityId,
    cityName: city.name,
    station: station
      ? {
          id: station.id,
          stationCode: station.stationCode,
          name: station.name,
        }
      : null,
    observation: observation
      ? {
          id: observation.id,
          observationTime: observation.observationTime,
          temperatureC: observation.temperatureC,
          humidityPercent: observation.humidityPercent,
          pressureHpa: observation.pressureHpa,
          windSpeedMs: observation.windSpeedMs,
          windDirectionDeg: observation.windDirectionDeg,
          rainfallMm: observation.rainfallMm,
          weatherCode: observation.weatherCode,
          cloudCoverPct: observation.cloudCoverPct,
          source: observation.source,
        }
      : null,
    fetchedFromLiveApi: false,
  });
}
