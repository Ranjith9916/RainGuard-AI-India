/**
 * Provider interfaces for the multi-source data adapters.
 *
 * Each external data source (weather, rainfall, satellite, radar, NWP) is
 * abstracted behind an interface so the pipeline can swap implementations
 * (live API vs stub vs cached) without touching consumer code.
 *
 * All interfaces share these conventions:
 *   - Methods are async and return typed payloads (or throw on hard failure).
 *   - Each call accepts an optional `signal` so callers can cancel mid-flight.
 *   - Methods accept explicit lat/lon — no implicit "current city".
 */

import type {
  CurrentWeather,
  ForecastBlock,
  HourlyEntry,
  WeatherResponse,
} from "@/lib/weather/types";

/* -------------------------------------------------------------------------- */
/*  Common payload types                                                     */
/* -------------------------------------------------------------------------- */

export interface LatLon {
  latitude: number;
  longitude: number;
}

export interface RainfallReading {
  /** ISO timestamp of the reading */
  time: string;
  /** Rainfall depth (mm) */
  rainfallMm: number;
  /** Aggregation window (minutes) — default 60 */
  durationMinutes: number;
  /** Source tag for downstream persistence */
  source: string;
  isDevData?: boolean;
}

export interface SatelliteRainfallReading extends RainfallReading {
  /** Satellite / sensor name e.g. "GPM-IMERG-Late" */
  sensor: string;
  /** Satellite pass time (ISO) */
  passTime?: string;
}

export interface RadarReflectivity {
  time: string;
  /** Composite reflectivity in dBZ at the lat/lon */
  reflectivityDbz: number;
  /** Estimated rainfall rate (mm/h) derived from Z-R relationship */
  rainfallRateMmPerH: number;
  source: string;
  isDevData?: boolean;
}

export interface NwpForecastPoint {
  /** Forecast valid time (ISO) */
  validTime: string;
  temperatureC?: number;
  precipitationMm?: number;
  windSpeedMs?: number;
  humidityPercent?: number;
  /** Model name e.g. "GEM-Global", "GFS", "ICON" */
  model: string;
  /** Forecast lead time in hours */
  leadHours: number;
  source: string;
  isDevData?: boolean;
}

export interface ProviderInfo {
  name: string;
  version: string;
  type: "weather" | "rainfall" | "satellite" | "radar" | "nwp";
  /** True when the provider returns synthetic dev data */
  isDevData: boolean;
}

export interface FetchContext {
  signal?: AbortSignal;
  /** Override the cache TTL (seconds) */
  cacheTtl?: number;
  /** Force a fresh fetch (bypass cache) */
  noCache?: boolean;
}

/* -------------------------------------------------------------------------- */
/*  Provider interfaces                                                      */
/* -------------------------------------------------------------------------- */

export interface WeatherDataProvider {
  readonly info: ProviderInfo;
  /** Fetch current + hourly + daily forecast for a point */
  fetchWeather(opts: LatLon & FetchContext): Promise<WeatherResponse>;
  /** Fetch only the current observation */
  fetchCurrent(opts: LatLon & FetchContext): Promise<CurrentWeather>;
  /** Fetch the hourly series */
  fetchHourly(opts: LatLon & FetchContext): Promise<HourlyEntry[]>;
  /** Fetch the daily forecast */
  fetchForecast(opts: LatLon & FetchContext): Promise<ForecastBlock>;
}

export interface RainfallProvider {
  readonly info: ProviderInfo;
  /** Fetch rainfall aggregated into the requested window (minutes) */
  fetchRainfall(
    opts: LatLon & { durationMinutes?: number } & FetchContext,
  ): Promise<RainfallReading[]>;
  /** Fetch the most recent 1-hour rainfall total */
  fetchLatest1h(opts: LatLon & FetchContext): Promise<RainfallReading | null>;
}

export interface SatelliteProvider {
  readonly info: ProviderInfo;
  /** Fetch satellite-derived rainfall (e.g. GPM IMERG) */
  fetchRainfall(
    opts: LatLon & { durationMinutes?: number } & FetchContext,
  ): Promise<SatelliteRainfallReading[]>;
  /** Fetch the latest satellite pass time (ISO) */
  fetchLatestPassTime(opts: LatLon & FetchContext): Promise<string | null>;
}

export interface RadarProvider {
  readonly info: ProviderInfo;
  /** Fetch composite radar reflectivity at a point */
  fetchReflectivity(
    opts: LatLon & FetchContext,
  ): Promise<RadarReflectivity | null>;
}

export interface NWPProvider {
  readonly info: ProviderInfo;
  /** Fetch a NWP forecast time-series for a point */
  fetchForecast(
    opts: LatLon & { leadHours?: number } & FetchContext,
  ): Promise<NwpForecastPoint[]>;
}
