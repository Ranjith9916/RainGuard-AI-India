/**
 * Open-Meteo rainfall provider.
 *
 * Reuses the Open-Meteo hourly series and exposes the rainfall column as a
 * sequence of `RainfallReading` records. This is the lowest-fidelity
 * rainfall source — satellite (GPM IMERG) is preferred when configured.
 */

import { SYSTEM, CACHE_TTL, RAINFALL_AGGREGATIONS } from "@/lib/config/config";
import { logger } from "@/lib/config/logger";
import { fetchWeather as openMeteoFetch } from "@/lib/weather/open-meteo";
import type {
  FetchContext,
  LatLon,
  ProviderInfo,
  RainfallProvider,
  RainfallReading,
} from "@/lib/adapters/interfaces";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class OpenMeteoRainfallProvider implements RainfallProvider {
  readonly info: ProviderInfo = {
    name: "open-meteo-rainfall",
    version: "0.1.0",
    type: "rainfall",
    isDevData: SYSTEM.isDevData,
  };

  private cache: Map<string, CacheEntry<RainfallReading[]>> = new Map();

  private cacheKey(opts: LatLon & { durationMinutes?: number }): string {
    return `${opts.latitude.toFixed(4)},${opts.longitude.toFixed(4)},${opts.durationMinutes ?? 60}`;
  }

  async fetchRainfall(
    opts: LatLon & { durationMinutes?: number } & FetchContext,
  ): Promise<RainfallReading[]> {
    const durationMinutes = opts.durationMinutes ?? 60;
    const key = this.cacheKey({ ...opts, durationMinutes });
    if (!opts.noCache) {
      const cached = this.cache.get(key);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.value;
      }
    }

    const response = await openMeteoFetch({
      latitude: opts.latitude,
      longitude: opts.longitude,
      pastDays: Math.max(1, Math.ceil((durationMinutes * 24) / 1440)),
      timeoutMs: 15000,
    });

    // Aggregate hourly precipitation into the requested window. If the
    // window is 60 min we just take each hourly bucket; for larger windows
    // we sum the buckets that fall within the window.
    const readings: RainfallReading[] = [];
    const hourly = response.hourly;
    const buckets = Math.max(1, Math.round(durationMinutes / 60));

    for (let i = 0; i < hourly.length; i += buckets) {
      const slice = hourly.slice(i, i + buckets);
      const sum = slice.reduce(
        (acc, h) => acc + (h.precipitationMm ?? 0),
        0,
      );
      const time = slice[0]?.time ?? new Date().toISOString();
      readings.push({
        time,
        rainfallMm: Number(sum.toFixed(2)),
        durationMinutes,
        source: "open-meteo",
        isDevData: SYSTEM.isDevData,
      });
      if (readings.length >= RAINFALL_AGGREGATIONS.windows.length * 2) break;
    }

    if (!opts.noCache) {
      const ttl = opts.cacheTtl ?? CACHE_TTL.rainfall.hourly;
      this.cache.set(key, {
        value: readings,
        expiresAt: Date.now() + ttl * 1000,
      });
    }
    logger.debug("open-meteo-rainfall.fetched", {
      lat: opts.latitude,
      lon: opts.longitude,
      count: readings.length,
    });
    return readings;
  }

  async fetchLatest1h(
    opts: LatLon & FetchContext,
  ): Promise<RainfallReading | null> {
    const list = await this.fetchRainfall({ ...opts, durationMinutes: 60 });
    if (list.length === 0) return null;
    return list[list.length - 1] ?? null;
  }
}

export default OpenMeteoRainfallProvider;
