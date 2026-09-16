/**
 * Open-Meteo API client.
 *
 * Open-Meteo (https://open-meteo.com) is a free, no-key weather API ideal as
 * a fallback for OpenWeatherMap. It exposes:
 *   - /v1/forecast        current + hourly + daily
 *   - /v1/gem             GEM global NWP (used by the nwp adapter)
 *   - /v1/geocoding       forward/reverse city lookup
 *
 * The client is intentionally a thin wrapper: every request is one `fetch()`
 * with a `URLSearchParams` body, every response is validated minimally and
 * reshaped into the project's `WeatherResponse` contract.
 */

import { logger } from "@/lib/config/logger";
import { SYSTEM } from "@/lib/config/config";
import type {
  CurrentWeather,
  ForecastBlock,
  GeocodedCity,
  HourlyEntry,
  WeatherResponse,
} from "@/lib/weather/types";

const BASE_URL = "https://api.open-meteo.com/v1";
const GEO_URL = "https://geocoding-api.open-meteo.com/v1";

const DEFAULT_PARAMS = {
  current:
    "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,is_day",
  hourly:
    "temperature_2m,precipitation,precipitation_probability,relative_humidity_2m,wind_speed_10m,weather_code,cloud_cover",
  daily:
    "temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,weather_code,wind_speed_10m_max,sunrise,sunset",
  timezone: SYSTEM.timezone,
  forecast_days: "7",
};

export interface OpenMeteoFetchOptions {
  latitude: number;
  longitude: number;
  /** Override the default forecast horizon (1..16) */
  forecastDays?: number;
  /** Override timezone */
  timezone?: string;
  /** Past days to include in hourly series (0..92) */
  pastDays?: number;
  /** Abort the request after N ms */
  timeoutMs?: number;
}

interface OpenMeteoResponse {
  latitude: number;
  longitude: number;
  timezone: string;
  current: Record<string, unknown>;
  current_units?: Record<string, string>;
  hourly?: Record<string, unknown> & { time?: string[] };
  daily?: Record<string, unknown> & { time?: string[] };
}

function buildForecastUrl(opts: OpenMeteoFetchOptions): string {
  const params = new URLSearchParams({
    latitude: String(opts.latitude),
    longitude: String(opts.longitude),
    current: DEFAULT_PARAMS.current,
    hourly: DEFAULT_PARAMS.hourly,
    daily: DEFAULT_PARAMS.daily,
    timezone: opts.timezone ?? DEFAULT_PARAMS.timezone,
    forecast_days: String(opts.forecastDays ?? 7),
  });
  if (opts.pastDays != null) params.set("past_days", String(opts.pastDays));
  return `${BASE_URL}/forecast?${params.toString()}`;
}

function shapeCurrent(raw: Record<string, unknown>): CurrentWeather {
  return {
    time: String(raw.time ?? new Date().toISOString()),
    temperatureC: Number(raw.temperature_2m ?? 0),
    apparentTemperatureC: numOrUndefined(raw.apparent_temperature),
    humidityPercent: numOrUndefined(raw.relative_humidity_2m),
    pressureHpa: numOrUndefined(raw.pressure_msl),
    windSpeedMs: numOrUndefined(raw.wind_speed_10m),
    windDirectionDeg: numOrUndefined(raw.wind_direction_10m),
    windGustMs: numOrUndefined(raw.wind_gusts_10m),
    cloudCoverPct: numOrUndefined(raw.cloud_cover),
    precipitationMm: numOrUndefined(raw.precipitation),
    weatherCode: numOrUndefined(raw.weather_code),
    isDay: raw.is_day === 1 || raw.is_day === true,
  };
}

function shapeHourly(raw: OpenMeteoResponse["hourly"]): HourlyEntry[] {
  if (!raw || !Array.isArray(raw.time)) return [];
  const times = raw.time as string[];
  const out: HourlyEntry[] = [];
  for (let i = 0; i < times.length; i++) {
    out.push({
      time: times[i],
      temperatureC: numAt(raw.temperature_2m, i),
      precipitationMm: numAt(raw.precipitation, i),
      precipitationProbability: numAt(raw.precipitation_probability, i),
      humidityPercent: numAt(raw.relative_humidity_2m, i),
      windSpeedMs: numAt(raw.wind_speed_10m, i),
      weatherCode: numAt(raw.weather_code, i),
      cloudCoverPct: numAt(raw.cloud_cover, i),
    });
  }
  return out;
}

function shapeDaily(raw: OpenMeteoResponse["daily"]): ForecastBlock {
  if (!raw || !Array.isArray(raw.time)) return { daily: [] };
  const times = raw.time as string[];
  const daily = times.map((date, i) => ({
    date,
    temperatureMaxC: numAt(raw.temperature_2m_max, i),
    temperatureMinC: numAt(raw.temperature_2m_min, i),
    precipitationSumMm: numAt(raw.precipitation_sum, i),
    precipitationProbabilityMax: numAt(raw.precipitation_probability_max, i),
    weatherCode: numAt(raw.weather_code, i),
    windSpeedMaxMs: numAt(raw.wind_speed_10m_max, i),
    sunrise: strAt(raw.sunrise, i),
    sunset: strAt(raw.sunset, i),
  }));
  return { daily };
}

function numOrUndefined(v: unknown): number | undefined {
  if (v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function numAt(arr: unknown, i: number): number | undefined {
  if (!Array.isArray(arr)) return undefined;
  return numOrUndefined(arr[i]);
}

function strAt(arr: unknown, i: number): string | undefined {
  if (!Array.isArray(arr)) return undefined;
  const v = arr[i];
  return typeof v === "string" ? v : undefined;
}

/**
 * Fetch weather from Open-Meteo. Throws on HTTP error or non-JSON response.
 */
export async function fetchWeather(
  opts: OpenMeteoFetchOptions,
): Promise<WeatherResponse> {
  const url = buildForecastUrl(opts);
  const controller = new AbortController();
  const timer =
    opts.timeoutMs != null
      ? setTimeout(() => controller.abort(), opts.timeoutMs)
      : undefined;

  logger.debug("open-meteo.fetch", { url });
  let res: Response;
  try {
    res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
  } catch (err) {
    logger.error("open-meteo.fetch.error", { url, error: String(err) });
    throw new Error(`open-meteo fetch failed: ${(err as Error).message}`);
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    logger.warn("open-meteo.http.error", { url, status: res.status, body });
    throw new Error(`open-meteo HTTP ${res.status}`);
  }

  const json = (await res.json()) as OpenMeteoResponse;

  return {
    source: "open-meteo",
    latitude: json.latitude,
    longitude: json.longitude,
    timezone: json.timezone ?? SYSTEM.timezone,
    fetchedAt: new Date().toISOString(),
    current: shapeCurrent(json.current),
    hourly: shapeHourly(json.hourly),
    forecast: shapeDaily(json.daily),
    isDevData: SYSTEM.isDevData,
  };
}

/* -------------------------------------------------------------------------- */
/*  Geocoding                                                                 */
/* -------------------------------------------------------------------------- */

interface OpenMeteoGeocodeResponse {
  results?: Array<{
    id: number;
    name: string;
    latitude: number;
    longitude: number;
    elevation?: number;
    country?: string;
    admin1?: string;
    admin2?: string;
    population?: number;
    timezone?: string;
  }>;
}

export async function geocodeCity(name: string): Promise<GeocodedCity | null> {
  const params = new URLSearchParams({
    name,
    count: "1",
    language: "en",
    format: "json",
  });
  const url = `${GEO_URL}/search?${params.toString()}`;
  logger.debug("open-meteo.geocode", { url });

  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store" });
  } catch (err) {
    logger.error("open-meteo.geocode.error", { url, error: String(err) });
    return null;
  }
  if (!res.ok) {
    logger.warn("open-meteo.geocode.http.error", { status: res.status, url });
    return null;
  }
  const json = (await res.json()) as OpenMeteoGeocodeResponse;
  const first = json.results?.[0];
  if (!first) return null;
  return {
    id: String(first.id),
    name: first.name,
    state: first.admin1,
    country: first.country,
    latitude: first.latitude,
    longitude: first.longitude,
    elevationM: first.elevation,
    population: first.population,
    timezone: first.timezone,
  };
}

export default { fetchWeather, geocodeCity };
