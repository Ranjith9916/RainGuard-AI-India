/**
 * Unified weather fetcher.
 *
 * Selects the weather provider based on the `WEATHER_PROVIDER` env var:
 *   - "openweathermap" (default when an API key is set)
 *   - "open-meteo"     (no key required, slightly lower fidelity)
 *
 * Falls back to Open-Meteo if OpenWeatherMap is selected but no API key is
 * configured, and falls back to OpenWeatherMap if Open-Meteo returns a hard
 * network error (and a key is configured).
 */

import { logger } from "@/lib/config/logger";
import { PROVIDERS } from "@/lib/config/config";
import * as openMeteo from "@/lib/weather/open-meteo";
import * as openWeatherMap from "@/lib/weather/openweathermap";
import type { GeocodedCity, WeatherResponse } from "@/lib/weather/types";

export type WeatherProviderName = "openweathermap" | "open-meteo";

function configuredProvider(): WeatherProviderName {
  const explicit = (process.env.WEATHER_PROVIDER ?? "").toLowerCase();
  if (explicit === "open-meteo") return "open-meteo";
  if (explicit === "openweathermap") return "openweathermap";
  // Auto-pick: prefer OpenWeatherMap if a key is configured.
  if (PROVIDERS.weather.apiKey && PROVIDERS.weather.apiKey.length > 0) {
    return "openweathermap";
  }
  return "open-meteo";
}

export interface UnifiedFetchOptions {
  latitude: number;
  longitude: number;
  /** Override provider for this single call */
  provider?: WeatherProviderName;
  /** Timeout in ms */
  timeoutMs?: number;
}

export async function fetchWeather(
  opts: UnifiedFetchOptions,
): Promise<WeatherResponse> {
  const provider = opts.provider ?? configuredProvider();
  logger.debug("unified-fetch.route", { provider, lat: opts.latitude, lon: opts.longitude });

  if (provider === "openweathermap") {
    try {
      return await openWeatherMap.fetchWeather({
        latitude: opts.latitude,
        longitude: opts.longitude,
        timeoutMs: opts.timeoutMs,
      });
    } catch (err) {
      // Fall back to Open-Meteo if OWM is unavailable.
      logger.warn("unified-fetch.owm-fallback", { error: String(err) });
      if (PROVIDERS.weather.apiKey) {
        // Only log "fallback to open-meteo" if we were actually trying OWM
        // and we have a key (i.e. the failure wasn't a missing key).
      }
      return openMeteo.fetchWeather({
        latitude: opts.latitude,
        longitude: opts.longitude,
        timeoutMs: opts.timeoutMs,
      });
    }
  }

  // Open-Meteo path (with optional OWM fallback).
  try {
    return await openMeteo.fetchWeather({
      latitude: opts.latitude,
      longitude: opts.longitude,
      timeoutMs: opts.timeoutMs,
    });
  } catch (err) {
    if (PROVIDERS.weather.apiKey && PROVIDERS.weather.apiKey.length > 0) {
      logger.warn("unified-fetch.open-meteo-fallback", { error: String(err) });
      return openWeatherMap.fetchWeather({
        latitude: opts.latitude,
        longitude: opts.longitude,
        timeoutMs: opts.timeoutMs,
      });
    }
    throw err;
  }
}

/**
 * Geocode a city name. Routes to the active provider's geocoder; falls back
 * to Open-Meteo if OpenWeatherMap is unavailable or has no key.
 */
export async function geocodeCity(name: string): Promise<GeocodedCity | null> {
  const provider = configuredProvider();
  if (provider === "openweathermap" && PROVIDERS.weather.apiKey) {
    const result = await openWeatherMap.geocodeCity(name);
    if (result) return result;
    logger.warn("unified-fetch.geocode.owm-empty", { name });
  }
  return openMeteo.geocodeCity(name);
}

/** Returns the currently selected provider name (for telemetry / display). */
export function activeProviderName(): WeatherProviderName {
  return configuredProvider();
}

export default { fetchWeather, geocodeCity, activeProviderName };
