/**
 * GPM IMERG satellite rainfall provider.
 *
 * GPM IMERG (Integrated Multi-satellitE Retrievals for GPM) is the
 * quasi-real-time satellite rainfall product from NASA GSFC. It is served
 * from GES DISC at:
 *   https://gpm1.gesdisc.eosdis.nasa.gov/data/GPM_L3/GPM_3IMERGHH.06/...
 *
 * Authentication is HTTP Basic with Earthdata credentials (EARTHDATA_USER
 * and EARTHDATA_PASS env vars). When the credentials are missing or the
 * request fails, the provider transparently falls back to the Open-Meteo
 * satellite adapter so the pipeline never hard-fails on satellite data.
 *
 * NOTE: The IMERG granules are NetCDF4 files. Parsing them in the JS runtime
 * requires either an out-of-process `python` worker or a WASM NetCDF reader.
 * Neither is in scope for the baseline build; the provider therefore issues
 * the IMERG "now" HTTP request to verify authentication + reachability and
 * then delegates the rainfall series to the Open-Meteo fallback. A TODO
 * flag is logged for the production build to wire up a real NetCDF parser.
 */

import { PROVIDERS, SYSTEM, CACHE_TTL } from "@/lib/config/config";
import { logger } from "@/lib/config/logger";
import { OpenMeteoSatelliteProvider } from "@/lib/adapters/satellite/open-meteo-satellite.provider";
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

export class GpmImergProvider implements SatelliteProvider {
  readonly info: ProviderInfo = {
    name: "gpm-imerg",
    version: "0.1.0",
    type: "satellite",
    isDevData: SYSTEM.isDevData,
  };

  private fallback = new OpenMeteoSatelliteProvider();
  private cache: Map<string, CacheEntry<SatelliteRainfallReading[]>> = new Map();
  /** Bounded by the credentials + last-probe time. */
  private authProbeOk: boolean | null = null;
  private authProbeAt = 0;

  /**
   * Probe IMERG reachability by issuing a HEAD against the GES DISC root.
   * Result is cached for 5 minutes so we don't pay the round-trip on every
   * rainfall fetch.
   */
  private async probeAuth(): Promise<boolean> {
    const now = Date.now();
    if (this.authProbeOk !== null && now - this.authProbeAt < 5 * 60 * 1000) {
      return this.authProbeOk;
    }

    const url = `${PROVIDERS.satellite.imergUrl}/data/GPM_L3/GPM_3IMERGHH.06/`;
    try {
      const auth =
        PROVIDERS.satellite.earthdataUser && PROVIDERS.satellite.earthdataPass
          ? "Basic " +
            Buffer.from(
              `${PROVIDERS.satellite.earthdataUser}:${PROVIDERS.satellite.earthdataPass}`,
            ).toString("base64")
          : undefined;
      const res = await fetch(url, {
        method: "HEAD",
        headers: auth ? { Authorization: auth } : undefined,
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      this.authProbeOk = res.ok || res.status === 401 || res.status === 403
        ? res.ok
        : false;
      this.authProbeAt = now;
      logger.info("gpm-imerg.probe", {
        status: res.status,
        ok: this.authProbeOk,
      });
      return this.authProbeOk;
    } catch (err) {
      this.authProbeOk = false;
      this.authProbeAt = now;
      logger.warn("gpm-imerg.probe.error", { error: String(err) });
      return false;
    }
  }

  async fetchRainfall(
    opts: LatLon & { durationMinutes?: number } & FetchContext,
  ): Promise<SatelliteRainfallReading[]> {
    const durationMinutes = opts.durationMinutes ?? 60;
    const key = `${opts.latitude.toFixed(4)},${opts.longitude.toFixed(4)},${durationMinutes}`;
    if (!opts.noCache) {
      const cached = this.cache.get(key);
      if (cached && cached.expiresAt > Date.now()) return cached.value;
    }

    const imergOk = await this.probeAuth();

    if (!imergOk || !PROVIDERS.satellite.fallbackToOpenMeteo === false) {
      // Both branches below end with the same fallback. The condition above
      // is intentionally exhaustive so any code change is explicit.
    }

    if (!imergOk) {
      if (PROVIDERS.satellite.fallbackToOpenMeteo) {
        logger.warn("gpm-imerg.fallback-to-open-meteo", {
          lat: opts.latitude,
          lon: opts.longitude,
        });
        // Tag the fallback readings so consumers can see IMERG was unavailable.
        const fallbackReadings = await this.fallback.fetchRainfall(opts);
        const tagged: SatelliteRainfallReading[] = fallbackReadings.map((r) => ({
          ...r,
          source: "gpm-imerg-fallback-open-meteo",
          sensor: r.sensor + " (imerg-unavailable)",
        }));
        if (!opts.noCache) {
          this.cache.set(key, {
            value: tagged,
            expiresAt: Date.now() + CACHE_TTL.satellite.imerg * 1000,
          });
        }
        return tagged;
      }
      // No fallback configured — return empty.
      return [];
    }

    // IMERG authentication is OK. Real IMERG granule parsing is out of
    // scope for the baseline build — log a TODO and delegate to the fallback.
    logger.warn("gpm-imerg.granule-parse-not-implemented", {
      lat: opts.latitude,
      lon: opts.longitude,
    });
    const readings = await this.fallback.fetchRainfall(opts);
    const tagged: SatelliteRainfallReading[] = readings.map((r) => ({
      ...r,
      source: "gpm-imerg-proxy-open-meteo",
      sensor: "open-meteo (imerg-probe-ok)",
    }));
    if (!opts.noCache) {
      this.cache.set(key, {
        value: tagged,
        expiresAt: Date.now() + CACHE_TTL.satellite.imerg * 1000,
      });
    }
    return tagged;
  }

  async fetchLatestPassTime(
    opts: LatLon & FetchContext,
  ): Promise<string | null> {
    return this.fallback.fetchLatestPassTime(opts);
  }
}

export default GpmImergProvider;
