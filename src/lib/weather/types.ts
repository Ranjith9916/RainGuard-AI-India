/**
 * Shared weather / map / city payload types.
 *
 * These types are intentionally permissive (most fields are optional) because
 * they cross the boundary between live APIs, dev fixtures and persisted DB
 * rows — any of which may omit fields. Consumers MUST defensively read fields.
 */

/* -------------------------------------------------------------------------- */
/*  WMO weather code → human label mapping                                    */
/* -------------------------------------------------------------------------- */

export const WMO_CODE_LABELS: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  56: "Light freezing drizzle",
  57: "Dense freezing drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Slight snow fall",
  73: "Moderate snow fall",
  75: "Heavy snow fall",
  77: "Snow grains",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Slight snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};

export function wmoLabel(code: number | null | undefined): string | null {
  if (code == null) return null;
  return WMO_CODE_LABELS[code] ?? null;
}

/* -------------------------------------------------------------------------- */
/*  Current / hourly / forecast records                                       */
/* -------------------------------------------------------------------------- */

export interface CurrentWeather {
  time: string;
  temperatureC: number;
  apparentTemperatureC?: number;
  humidityPercent?: number;
  pressureHpa?: number;
  windSpeedMs?: number;
  windDirectionDeg?: number;
  windGustMs?: number;
  cloudCoverPct?: number;
  precipitationMm?: number;
  weatherCode?: number;
  isDay?: boolean;
  visibilityM?: number;
}

export interface HourlyEntry {
  time: string;
  temperatureC?: number;
  precipitationMm?: number;
  precipitationProbability?: number;
  humidityPercent?: number;
  windSpeedMs?: number;
  weatherCode?: number;
  cloudCoverPct?: number;
}

export interface DailyForecastEntry {
  date: string;
  temperatureMaxC?: number;
  temperatureMinC?: number;
  precipitationSumMm?: number;
  precipitationProbabilityMax?: number;
  weatherCode?: number;
  windSpeedMaxMs?: number;
  sunrise?: string;
  sunset?: string;
}

export interface ForecastBlock {
  daily: DailyForecastEntry[];
}

export interface HourlyBlock {
  hourly: HourlyEntry[];
}

/* -------------------------------------------------------------------------- */
/*  Unified WeatherResponse — the contract every provider must return         */
/* -------------------------------------------------------------------------- */

export interface WeatherResponse {
  source: "openweathermap" | "open-meteo" | "gpm-imerg" | "manual";
  latitude: number;
  longitude: number;
  timezone: string;
  fetchedAt: string;
  current: CurrentWeather;
  hourly: HourlyEntry[];
  forecast?: ForecastBlock;
  isDevData?: boolean;
}

/* -------------------------------------------------------------------------- */
/*  Geocoding result                                                          */
/* -------------------------------------------------------------------------- */

export interface GeocodedCity {
  id?: string;
  name: string;
  state?: string;
  country?: string;
  latitude: number;
  longitude: number;
  elevationM?: number;
  population?: number;
  timezone?: string;
}

/* -------------------------------------------------------------------------- */
/*  Map-related types                                                         */
/* -------------------------------------------------------------------------- */

export type RiskLevel = "LOW" | "MODERATE" | "HIGH" | "CRITICAL";

export interface MapDataPoint {
  id: string;
  cityId?: string;
  name: string;
  state?: string;
  latitude: number;
  longitude: number;
  /** Current temperature °C */
  temperatureC?: number;
  /** Current accumulated precipitation mm (1h) */
  rainfallMm?: number;
  /** Heavy-rain probability 0..1 */
  heavyRainProbability?: number;
  /** Flood probability 0..1 */
  floodProbability?: number;
  /** Predicted inundation depth (m) */
  inundationDepthM?: number;
  /** Risk bucket */
  riskLevel?: RiskLevel;
  /** WMO weather code */
  weatherCode?: number;
  /** Source provider tag */
  source?: string;
  /** Latest observation ISO time */
  observedAt?: string;
  isDevData?: boolean;
}

export interface ViewportTarget {
  /** Target latitude to centre on */
  latitude: number;
  /** Target longitude to centre on */
  longitude: number;
  /** Optional zoom level override */
  zoom?: number;
  /** Optional cityId to highlight */
  cityId?: string;
  /** Optional bearing (deg, 0 = north) */
  bearing?: number;
  /** Optional pitch (deg) */
  pitch?: number;
}

/** Full payload emitted by the weather pipeline for a single city. */
export interface CityWeatherPayload {
  cityId: string;
  cityName: string;
  state?: string;
  latitude: number;
  longitude: number;
  population?: number;
  fetchedAt: string;
  current: CurrentWeather;
  hourly: HourlyEntry[];
  forecast?: ForecastBlock;
  /** Derived heavy-rain probability 0..1 */
  heavyRainProbability?: number;
  /** Derived rainfall forecast (mm) for the configured horizon */
  forecastRainfallMm?: number;
  /** Derived flood probability 0..1 */
  floodProbability?: number;
  /** Derived inundation depth (m) */
  inundationDepthM?: number;
  /** Risk bucket */
  riskLevel?: RiskLevel;
  /** Directive string suitable for display */
  directive?: string;
  /** Recommended actions */
  actions?: string[];
  /** Source provider tag */
  source?: string;
  isDevData?: boolean;
}
