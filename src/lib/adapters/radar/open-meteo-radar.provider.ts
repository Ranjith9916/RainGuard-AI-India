/**
 * Open-Meteo radar provider.
 *
 * Open-Meteo doesn't expose live radar reflectivity, but we can synthesise a
 * reflectivity value from the hourly precipitation rate using the standard
 * Marshall-Palmer Z-R relationship inverted:
 *
 *   Z = a · R^b            (a=200, b=1.6 for convective; tropical uses a=300, b=1.4)
 *   R (mm/h) = (Z / a)^(1/b)
 *   dBZ = 10 · log10(Z)
 *
 * This is the same identity used by radar processors worldwide to derive
 * rain rate from reflectivity — we just run it in reverse so consumers that
 * expect a `RadarReflectivity` payload still work without a real radar
 * ingest path.
 */

import { SYSTEM, CACHE_TTL } from "@/lib/config/config";
import { logger } from "@/lib/config/logger";
import { fetchWeather as openMeteoFetch } from "@/lib/weather/open-meteo";
import type {
  FetchContext,
  LatLon,
  ProviderInfo,
  RadarProvider,
  RadarReflectivity,
} from "@/lib/adapters/interfaces";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const ZR_A = 200;
const ZR_B = 1.6;

function rainRateToDbz(rainRateMmPerH: number): number {
  if (rainRateMmPerH <= 0) return 0;
  const z = ZR_A * Math.pow(rainRateMmPerH, ZR_B);
  return Number((10 * Math.log10(z)).toFixed(1));
}

export class OpenMeteoRadarProvider implements RadarProvider {
  readonly info: ProviderInfo = {
    name: "open-meteo-radar",
    version: "0.1.0",
    type: "radar",
    isDevData: SYSTEM.isDevData,
  };

  private cache: Map<string, CacheEntry<RadarReflectivity | null>> = new Map();

  async fetchReflectivity(
    opts: LatLon & FetchContext,
  ): Promise<RadarReflectivity | null> {
    const key = `${opts.latitude.toFixed(4)},${opts.longitude.toFixed(4)}`;
    if (!opts.noCache) {
      const cached = this.cache.get(key);
      if (cached && cached.expiresAt > Date.now()) return cached.value;
    }

    const response = await openMeteoFetch({
      latitude: opts.latitude,
      longitude: opts.longitude,
      timeoutMs: 15000,
    });

    const latest = response.hourly[response.hourly.length - 1];
    if (!latest) return null;

    const rainRate = latest.precipitationMm ?? 0;
    const reflectivity = rainRateToDbz(rainRate);

    const reading: RadarReflectivity = {
      time: latest.time,
      reflectivityDbz: reflectivity,
      rainfallRateMmPerH: Number(rainRate.toFixed(2)),
      source: "open-meteo-synthetic",
      isDevData: SYSTEM.isDevData,
    };

    if (!opts.noCache) {
      const ttl = opts.cacheTtl ?? CACHE_TTL.radar.reflectivity;
      this.cache.set(key, {
        value: reading,
        expiresAt: Date.now() + ttl * 1000,
      });
    }

    logger.debug("open-meteo-radar.synthesised", {
      lat: opts.latitude,
      lon: opts.longitude,
      dbz: reflectivity,
      rateMmPerH: rainRate,
    });
    return reading;
  }
}

export default OpenMeteoRadarProvider;
