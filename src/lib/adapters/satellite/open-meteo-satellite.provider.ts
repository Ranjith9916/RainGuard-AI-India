/**
 * Open-Meteo satellite provider.
 *
 * Open-Meteo doesn't actually expose satellite imagery, but its hourly
 * precipitation series is a reasonable proxy for satellite-derived rainfall
 * (e.g. GPM IMERG) when the IMERG backend is not configured. This adapter
 * reshapes that data into the `SatelliteRainfallReading` shape.
 *
 * The real GPM IMERG provider lives in `gpm-imerg.provider.ts`; this file
 * exists as a fallback when no Earthdata credentials are configured.
 */

import { SYSTEM, CACHE_TTL } from "@/lib/config/config";
import { logger } from "@/lib/config/logger";
import { fetchWeather as openMeteoFetch } from "@/lib/weather/open-meteo";
import type {
  FetchContext,
  LatLon,
  ProviderInfo,
  SatelliteProvider,
  SatelliteRainfallReading,
} from "@/lib/adapters/interfaces";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class OpenMeteoSatelliteProvider implements SatelliteProvider {
  readonly info: ProviderInfo = {
    name: "open-meteo-satellite",
    version: "0.1.0",
    type: "satellite",
    isDevData: SYSTEM.isDevData,
  };

  private cache: Map<string, CacheEntry<SatelliteRainfallReading[]>> = new Map();

  async fetchRainfall(
    opts: LatLon & { durationMinutes?: number } & FetchContext,
  ): Promise<SatelliteRainfallReading[]> {
    const durationMinutes = opts.durationMinutes ?? 60;
    const key = `${opts.latitude.toFixed(4)},${opts.longitude.toFixed(4)},${durationMinutes}`;
    if (!opts.noCache) {
      const cached = this.cache.get(key);
      if (cached && cached.expiresAt > Date.now()) return cached.value;
    }

    const response = await openMeteoFetch({
      latitude: opts.latitude,
      longitude: opts.longitude,
      timeoutMs: 15000,
    });

    const readings: SatelliteRainfallReading[] = response.hourly.map((h) => ({
      time: h.time,
      rainfallMm: Number((h.precipitationMm ?? 0).toFixed(2)),
      durationMinutes,
      source: "open-meteo-proxy",
      sensor: "open-meteo-hourly",
      passTime: response.fetchedAt,
      isDevData: SYSTEM.isDevData,
    }));

    if (!opts.noCache) {
      const ttl = opts.cacheTtl ?? CACHE_TTL.satellite.imerg;
      this.cache.set(key, {
        value: readings,
        expiresAt: Date.now() + ttl * 1000,
      });
    }

    logger.debug("open-meteo-satellite.fetched", {
      lat: opts.latitude,
      lon: opts.longitude,
      count: readings.length,
    });
    return readings;
  }

  async fetchLatestPassTime(
    opts: LatLon & FetchContext,
  ): Promise<string | null> {
    const list = await this.fetchRainfall(opts);
    if (list.length === 0) return null;
    return list[list.length - 1]?.passTime ?? null;
  }
}

/**
 * Stub for the real GPM IMERG provider. Kept here as documentation of the
 * fallback contract — the actual implementation lives in
 * `gpm-imerg.provider.ts`.
 */
export class GpmImergProviderStub implements SatelliteProvider {
  readonly info: ProviderInfo = {
    name: "gpm-imerg-stub",
    version: "0.1.0",
    type: "satellite",
    isDevData: true,
  };

  async fetchRainfall(
    opts: LatLon & { durationMinutes?: number } & FetchContext,
  ): Promise<SatelliteRainfallReading[]> {
    logger.warn("gpm-imerg-stub.called", {
      lat: opts.latitude,
      lon: opts.longitude,
    });
    return [];
  }

  async fetchLatestPassTime(): Promise<string | null> {
    return null;
  }
}

export default OpenMeteoSatelliteProvider;
