/**
 * GET /api/weather/search?q=
 *
 * Forward-geocodes a free-text place name to a lat/lon. Uses the unified
 * `geocodeCity()` entrypoint which routes to the configured provider and
 * transparently falls back between OpenWeatherMap and Open-Meteo.
 *
 * The route also intersects the result against the static 16-city registry
 * so that callers get a `cityId` back when the query matches a known
 * Indian city — the dashboard uses this to deep-link to the city view.
 *
 * Query params:
 *   - q (required) — place name, e.g. "Chennai", "Mumbai, IN"
 */

import { NextResponse } from "next/server";
import { geocodeCity } from "@/lib/weather/unified-fetch";
import {
  CITIES as INDIAN_CITIES,
  findCityByName,
} from "@/lib/weather/cities";
import { logger } from "@/lib/config/logger";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();

  if (!q) {
    return NextResponse.json(
      {
        error: "Missing 'q' query parameter",
        example: "/api/weather/search?q=Chennai",
      },
      { status: 400 },
    );
  }

  // First try the local 16-city registry — it's free, instant and gives
  // us the canonical cityId / risk note for downstream UI panels.
  const localMatch = findCityByName(q);
  if (localMatch) {
    return NextResponse.json({
      ok: true,
      query: q,
      source: "local-registry",
      result: {
        id: localMatch.id,
        name: localMatch.name,
        state: localMatch.state,
        country: "India",
        latitude: localMatch.latitude,
        longitude: localMatch.longitude,
        elevationM: localMatch.elevationM,
        population: localMatch.population,
        riskNote: localMatch.riskNote,
      },
    });
  }

  try {
    const result = await geocodeCity(q);
    if (!result) {
      return NextResponse.json(
        {
          ok: false,
          query: q,
          error: "no geocoding result",
        },
        { status: 404 },
      );
    }

    // India filter: only return results that explicitly resolve to India.
    // The Open-Meteo geocoder includes country_code; OWM returns country.
    const countryRaw = (result.country ?? "").toLowerCase();
    const isIndia =
      countryRaw.includes("india") || countryRaw === "in" || countryRaw === "";

    if (!isIndia) {
      return NextResponse.json(
        {
          ok: false,
          query: q,
          error: "result is outside India — filtered",
          raw: result,
        },
        { status: 404 },
      );
    }

    return NextResponse.json({
      ok: true,
      query: q,
      source: "geocoder",
      result: {
        ...result,
        // Surface the canonical cityId if the geocoded coords happen to be
        // within ~10 km of a registry city — lets the UI deep-link.
        cityId:
          INDIAN_CITIES.find((c) => {
            const dLat = c.latitude - result.latitude;
            const dLon = c.longitude - result.longitude;
            // ~0.1 degree ≈ 11 km
            return Math.abs(dLat) < 0.1 && Math.abs(dLon) < 0.1;
          })?.id ?? null,
      },
    });
  } catch (err) {
    logger.error("api.weather.search.error", { q, error: (err as Error).message });
    return NextResponse.json(
      { ok: false, query: q, error: (err as Error).message },
      { status: 502 },
    );
  }
}
