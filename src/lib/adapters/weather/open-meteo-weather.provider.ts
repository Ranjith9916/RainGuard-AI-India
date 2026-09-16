/**
 * Open-Meteo weather data provider.
 *
 * Adapts the Open-Meteo client (lib/weather/open-meteo.ts) into the project's
 * `WeatherDataProvider` interface so the rest of the pipeline doesn't need
 * to know which provider backs it.
 */

import { SYSTEM, CACHE_TTL } from "@/lib/config/config";
import { logger } from "@/lib/config/logger";
import { fetchWeather as openMeteoFetch } from "@/lib/weather/open-meteo";
import type {
  FetchContext,
  LatLon,
  ProviderInfo,
  WeatherDataProvider,
} from "@/lib/adapters/interfaces";
import type {
  CurrentWeather,
  ForecastBlock,
  HourlyEntry,
  WeatherResponse,
} from "@/lib/weather/types";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class OpenMeteoWeatherProvider implements WeatherDataProvider {
  readonly info: ProviderInfo = {
    name: "open-meteo-weather",
    version: "0.1.0",
    type: "weather",
    isDevData: SYSTEM.isDevData,
  };

  private cache: Map<string, CacheEntry<WeatherResponse>> = new Map();

  private cacheKey(opts: LatLon): string {
    return `${opts.latitude.toFixed(4)},${opts.longitude.toFixed(4)}`;
  }

  private readCache(key: string): WeatherResponse | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this.cache.delete(key);
      return null;
    }
    return entry.value;
  }

  private writeCache(key: string, value: WeatherResponse, ttlSeconds: number): void {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  async fetchWeather(
    opts: LatLon & FetchContext,
  ): Promise<WeatherResponse> {
    const key = this.cacheKey(opts);
    if (!opts.noCache) {
      const cached = this.readCache(key);
      if (cached) {
        logger.debug("open-meteo-weather.cache.hit", { key });
        return cached;
      }
    }

    const ttl = opts.cacheTtl ?? CACHE_TTL.weather.forecast;
    const response = await openMeteoFetch({
      latitude: opts.latitude,
      longitude: opts.longitude,
      timeoutMs: 15000,
    });
    if (!opts.noCache) this.writeCache(key, response, ttl);
    return response;
  }

  async fetchCurrent(opts: LatLon & FetchContext): Promise<CurrentWeather> {
    const full = await this.fetchWeather(opts);
    return full.current;
  }

  async fetchHourly(opts: LatLon & FetchContext): Promise<HourlyEntry[]> {
    const full = await this.fetchWeather(opts);
    return full.hourly;
  }

  async fetchForecast(opts: LatLon & FetchContext): Promise<ForecastBlock> {
    const full = await this.fetchWeather(opts);
    return full.forecast ?? { daily: [] };
  }
}

export default OpenMeteoWeatherProvider;
