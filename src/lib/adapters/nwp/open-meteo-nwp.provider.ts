/**
 * Open-Meteo NWP provider.
 *
 * Open-Meteo proxies a number of NWP models (GFS, ECMWF, GEM, ICON, MET Norway)
 * through the same `/forecast` endpoint with a `models` query parameter. We
 * default to GEM-Global (Canadian) which has good tropical coverage including
 * the Indian Ocean and Bay of Bengal.
 *
 * The provider reshapes the hourly series into `NwpForecastPoint` records
 * with explicit lead-time so downstream consumers can compare models.
 */

import { PROVIDERS, SYSTEM, CACHE_TTL } from "@/lib/config/config";
import { logger } from "@/lib/config/logger";
import type {
  FetchContext,
  LatLon,
  NWPProvider,
  NwpForecastPoint,
  ProviderInfo,
} from "@/lib/adapters/interfaces";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

interface OpenMeteoNwpResponse {
  latitude: number;
  longitude: number;
  timezone: string;
  hourly?: {
    time?: string[];
    temperature_2m?: number[];
    precipitation?: number[];
    wind_speed_10m?: number[];
    relative_humidity_2m?: number[];
  };
}

export class OpenMeteoNwpProvider implements NWPProvider {
  readonly info: ProviderInfo = {
    name: "open-meteo-nwp",
    version: "0.1.0",
    type: "nwp",
    isDevData: SYSTEM.isDevData,
  };

  private cache: Map<string, CacheEntry<NwpForecastPoint[]>> = new Map();

  async fetchForecast(
    opts: LatLon & { leadHours?: number } & FetchContext,
  ): Promise<NwpForecastPoint[]> {
    const leadHours = opts.leadHours ?? 72;
    const key = `${opts.latitude.toFixed(4)},${opts.longitude.toFixed(4)},${leadHours}`;
    if (!opts.noCache) {
      const cached = this.cache.get(key);
      if (cached && cached.expiresAt > Date.now()) return cached.value;
    }

    const params = new URLSearchParams({
      latitude: String(opts.latitude),
      longitude: String(opts.longitude),
      hourly: "temperature_2m,precipitation,wind_speed_10m,relative_humidity_2m",
      models: PROVIDERS.nwp.model,
      forecast_days: String(Math.ceil(leadHours / 24)),
      timezone: SYSTEM.timezone,
    });
    const url = `${PROVIDERS.nwp.baseUrl}/forecast?${params.toString()}`;
    logger.debug("open-meteo-nwp.fetch", { url, model: PROVIDERS.nwp.model });

    let res: Response;
    try {
      res = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });
    } catch (err) {
      logger.error("open-meteo-nwp.fetch.error", { url, error: String(err) });
      throw new Error(`open-meteo NWP fetch failed: ${(err as Error).message}`);
    }
    if (!res.ok) {
      throw new Error(`open-meteo NWP HTTP ${res.status}`);
    }

    const json = (await res.json()) as OpenMeteoNwpResponse;
    const hourly = json.hourly;
    if (!hourly || !Array.isArray(hourly.time)) return [];

    const now = Date.now();
    const points: NwpForecastPoint[] = [];
    for (let i = 0; i < hourly.time.length; i++) {
      const time = hourly.time[i]!;
      const validUnix = new Date(time).getTime();
      const leadHoursAtPoint = Math.max(
        0,
        Math.round((validUnix - now) / 3600000),
      );
      if (leadHoursAtPoint > leadHours) continue;
      points.push({
        validTime: time,
        temperatureC: hourly.temperature_2m?.[i],
        precipitationMm: hourly.precipitation?.[i],
        windSpeedMs: hourly.wind_speed_10m?.[i],
        humidityPercent: hourly.relative_humidity_2m?.[i],
        model: PROVIDERS.nwp.model,
        leadHours: leadHoursAtPoint,
        source: "open-meteo-nwp",
        isDevData: SYSTEM.isDevData,
      });
    }

    if (!opts.noCache) {
      const ttl = opts.cacheTtl ?? CACHE_TTL.nwp.forecast;
      this.cache.set(key, {
        value: points,
        expiresAt: Date.now() + ttl * 1000,
      });
    }
    logger.debug("open-meteo-nwp.fetched", {
      lat: opts.latitude,
      lon: opts.longitude,
      count: points.length,
    });
    return points;
  }
}

export default OpenMeteoNwpProvider;
