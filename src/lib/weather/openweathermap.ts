/**
 * OpenWeatherMap provider.
 *
 * OpenWeatherMap (https://openweathermap.org/api) is the primary weather
 * provider when an API key is configured. It exposes:
 *   - /data/2.5/weather      current conditions
 *   - /data/2.5/forecast     5-day / 3-hour forecast
 *   - /geo/1.0/direct        forward geocoding
 *
 * This module wraps those endpoints into the project's `WeatherResponse`
 * contract. Hourly series are synthesised from the 3-hour forecast buckets
 * (each bucket is replicated across its 3 hourly slots for compatibility with
 * downstream 1-hour feature windows).
 */

import { logger } from "@/lib/config/logger";
import { PROVIDERS, SYSTEM } from "@/lib/config/config";
import type {
  CurrentWeather,
  ForecastBlock,
  GeocodedCity,
  HourlyEntry,
  WeatherResponse,
} from "@/lib/weather/types";

const API_KEY = PROVIDERS.weather.apiKey;
const BASE_URL = PROVIDERS.weather.baseUrl;
const GEO_URL = PROVIDERS.weather.geoUrl;

/* -------------------------------------------------------------------------- */
/*  OpenWeatherMap raw response types                                         */
/* -------------------------------------------------------------------------- */

interface OwmCurrentResponse {
  coord: { lat: number; lon: number };
  dt: number;
  timezone: number;
  name: string;
  main: {
    temp: number;
    feels_like?: number;
    humidity?: number;
    pressure?: number;
  };
  wind?: { speed?: number; deg?: number; gust?: number };
  clouds?: { all?: number };
  visibility?: number;
  weather?: Array<{ id: number; main: string; description: string }>;
  rain?: { "1h"?: number; "3h"?: number };
}

interface OwmForecastResponse {
  cod: string;
  cnt: number;
  city: { id: number; name: string; coord: { lat: number; lon: number } };
  list: Array<{
    dt: number;
    main: {
      temp: number;
      humidity?: number;
      pressure?: number;
    };
    wind?: { speed?: number; deg?: number };
    clouds?: { all?: number };
    weather?: Array<{ id: number }>;
    pop?: number;
    rain?: { "3h"?: number };
  }>;
}

interface OwmGeocodeResponse {
  results?: Array<{
    name: string;
    lat: number;
    lon: number;
    country?: string;
    state?: string;
  }>;
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Map OpenWeatherMap condition codes to WMO codes for downstream consumers
 * that already know how to handle WMO codes. The mapping is lossy — only the
 * most common codes are covered.
 */
function owmCodeToWmo(owmId: number | undefined): number | undefined {
  if (owmId == null) return undefined;
  if (owmId === 800) return 0;
  if (owmId === 801) return 1;
  if (owmId === 802) return 2;
  if (owmId === 803) return 3;
  if (owmId === 804) return 3;
  if (owmId >= 701 && owmId <= 781) return 45;
  if (owmId >= 200 && owmId <= 232) return 95;
  if (owmId >= 300 && owmId <= 321) return 51;
  if (owmId === 500) return 61;
  if (owmId === 501) return 63;
  if (owmId === 502 || owmId === 503 || owmId === 504) return 65;
  if (owmId === 511) return 66;
  if (owmId >= 520 && owmId <= 531) return 81;
  if (owmId >= 600 && owmId <= 622) return 71;
  return undefined;
}

function unixToIso(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString();
}

function shapeCurrent(raw: OwmCurrentResponse): CurrentWeather {
  const w = raw.weather?.[0];
  return {
    time: unixToIso(raw.dt),
    temperatureC: raw.main.temp,
    apparentTemperatureC: raw.main.feels_like,
    humidityPercent: raw.main.humidity,
    pressureHpa: raw.main.pressure,
    windSpeedMs: raw.wind?.speed,
    windDirectionDeg: raw.wind?.deg,
    windGustMs: raw.wind?.gust,
    cloudCoverPct: raw.clouds?.all,
    precipitationMm: raw.rain?.["1h"] ?? raw.rain?.["3h"],
    weatherCode: owmCodeToWmo(w?.id),
    visibilityM: raw.visibility,
  };
}

/**
 * Convert the 3-hour forecast buckets to a 1-hour series by replicating each
 * bucket across its 3 hours. Rainfall is split evenly across the 3 hours.
 */
function shapeHourlyFromForecast(list: OwmForecastResponse["list"]): HourlyEntry[] {
  const out: HourlyEntry[] = [];
  for (const bucket of list) {
    const startUnix = bucket.dt;
    const perHourRain = bucket.rain?.["3h"] != null ? bucket.rain["3h"] / 3 : undefined;
    for (let h = 0; h < 3; h++) {
      out.push({
        time: unixToIso(startUnix + h * 3600),
        temperatureC: bucket.main.temp,
        precipitationMm: perHourRain,
        precipitationProbability: bucket.pop,
        humidityPercent: bucket.main.humidity,
        windSpeedMs: bucket.wind?.speed,
        weatherCode: owmCodeToWmo(bucket.weather?.[0]?.id),
        cloudCoverPct: bucket.clouds?.all,
      });
    }
  }
  return out;
}

function shapeDailyFromForecast(list: OwmForecastResponse["list"]): ForecastBlock {
  const byDay = new Map<string, typeof list>();
  for (const entry of list) {
    const day = unixToIso(entry.dt).slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(entry);
  }
  const daily = Array.from(byDay.entries()).map(([date, entries]) => {
    const temps = entries.map((e) => e.main.temp);
    const rainSum = entries.reduce((acc, e) => acc + (e.rain?.["3h"] ?? 0), 0);
    const popMax = entries.reduce((acc, e) => Math.max(acc, e.pop ?? 0), 0);
    const windMax = entries.reduce(
      (acc, e) => Math.max(acc, e.wind?.speed ?? 0),
      0,
    );
    return {
      date,
      temperatureMaxC: Math.max(...temps),
      temperatureMinC: Math.min(...temps),
      precipitationSumMm: Number(rainSum.toFixed(2)),
      precipitationProbabilityMax: popMax,
      weatherCode: owmCodeToWmo(entries[0]?.weather?.[0]?.id),
      windSpeedMaxMs: windMax,
    };
  });
  return { daily };
}

/* -------------------------------------------------------------------------- */
/*  Public API                                                                */
/* -------------------------------------------------------------------------- */

export interface OpenWeatherMapFetchOptions {
  latitude: number;
  longitude: number;
  /** Override the API key (default reads from PROVIDERS) */
  apiKey?: string;
  /** Override base URL */
  baseUrl?: string;
  /** Abort after N ms */
  timeoutMs?: number;
  /** Units: "metric" | "imperial" | "standard" */
  units?: "metric" | "imperial" | "standard";
}

function ensureApiKey(): string {
  if (!API_KEY || API_KEY.length === 0) {
    throw new Error(
      "OpenWeatherMap API key is not configured (set OPENWEATHERMAP_API_KEY).",
    );
  }
  return API_KEY;
}

export async function fetchWeather(
  opts: OpenWeatherMapFetchOptions,
): Promise<WeatherResponse> {
  const key = opts.apiKey ?? ensureApiKey();
  const base = opts.baseUrl ?? BASE_URL;
  const units = opts.units ?? "metric";
  const controller = new AbortController();
  const timer =
    opts.timeoutMs != null
      ? setTimeout(() => controller.abort(), opts.timeoutMs)
      : undefined;

  const currentUrl = `${base}/weather?lat=${opts.latitude}&lon=${opts.longitude}&units=${units}&appid=${key}`;
  const forecastUrl = `${base}/forecast?lat=${opts.latitude}&lon=${opts.longitude}&units=${units}&appid=${key}`;

  logger.debug("openweathermap.fetch", { currentUrl, forecastUrl });

  try {
    const [currentRes, forecastRes] = await Promise.all([
      fetch(currentUrl, { signal: controller.signal, cache: "no-store" }),
      fetch(forecastUrl, { signal: controller.signal, cache: "no-store" }),
    ]);

    if (!currentRes.ok || !forecastRes.ok) {
      const status = currentRes.status || forecastRes.status;
      const body = await currentRes.text().catch(() => "");
      throw new Error(`openweathermap HTTP ${status}: ${body.slice(0, 200)}`);
    }

    const currentJson = (await currentRes.json()) as OwmCurrentResponse;
    const forecastJson = (await forecastRes.json()) as OwmForecastResponse;

    return {
      source: "openweathermap",
      latitude: opts.latitude,
      longitude: opts.longitude,
      timezone: SYSTEM.timezone,
      fetchedAt: new Date().toISOString(),
      current: shapeCurrent(currentJson),
      hourly: shapeHourlyFromForecast(forecastJson.list),
      forecast: shapeDailyFromForecast(forecastJson.list),
      isDevData: SYSTEM.isDevData,
    };
  } catch (err) {
    logger.error("openweathermap.fetch.error", {
      error: String(err),
      lat: opts.latitude,
      lon: opts.longitude,
    });
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/* -------------------------------------------------------------------------- */
/*  Geocoding                                                                 */
/* -------------------------------------------------------------------------- */

export async function geocodeCity(name: string): Promise<GeocodedCity | null> {
  const key = ensureApiKey();
  const params = new URLSearchParams({
    q: name,
    limit: "1",
    appid: key,
  });
  const url = `${GEO_URL}/direct?${params.toString()}`;
  logger.debug("openweathermap.geocode", { url });

  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store" });
  } catch (err) {
    logger.error("openweathermap.geocode.error", { url, error: String(err) });
    return null;
  }
  if (!res.ok) {
    logger.warn("openweathermap.geocode.http.error", { status: res.status });
    return null;
  }
  const json = (await res.json()) as OwmGeocodeResponse;
  const first = json.results?.[0];
  if (!first) return null;
  return {
    name: first.name,
    country: first.country,
    state: first.state,
    latitude: first.lat,
    longitude: first.lon,
  };
}

export default { fetchWeather, geocodeCity };
