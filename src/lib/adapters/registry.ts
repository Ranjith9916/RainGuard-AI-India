/**
 * Provider registry.
 *
 * Resolves the set of active providers from the central config. Each
 * provider is instantiated lazily on first lookup so that unused providers
 * don't pay an initialisation cost. The registry is the only place that
 * knows which provider implementation backs each interface — consumers
 * always go through `getWeatherProvider()` etc.
 */

import { PROVIDERS } from "@/lib/config/config";
import { logger } from "@/lib/config/logger";
import type {
  NWPProvider,
  RadarProvider,
  RainfallProvider,
  SatelliteProvider,
  WeatherDataProvider,
} from "@/lib/adapters/interfaces";
import { OpenMeteoWeatherProvider } from "@/lib/adapters/weather/open-meteo-weather.provider";
import { OpenMeteoRainfallProvider } from "@/lib/adapters/rainfall/open-meteo-rainfall.provider";
import { OpenMeteoSatelliteProvider } from "@/lib/adapters/satellite/open-meteo-satellite.provider";
import { GpmImergProvider } from "@/lib/adapters/satellite/gpm-imerg.provider";
import { OpenMeteoRadarProvider } from "@/lib/adapters/radar/open-meteo-radar.provider";
import { OpenMeteoNwpProvider } from "@/lib/adapters/nwp/open-meteo-nwp.provider";

class ProviderRegistry {
  private weather: WeatherDataProvider | null = null;
  private rainfall: RainfallProvider | null = null;
  private satellite: SatelliteProvider | null = null;
  private radar: RadarProvider | null = null;
  private nwp: NWPProvider | null = null;

  getWeatherProvider(): WeatherDataProvider {
    if (!this.weather) {
      // Weather provider today is Open-Meteo (the OWM client is wired through
      // the unified-fetch entrypoint; adapters always use Open-Meteo so that
      // the same code path is exercised in tests and production).
      this.weather = new OpenMeteoWeatherProvider();
      logger.info("registry.weather.resolved", {
        provider: this.weather.info.name,
        isDevData: this.weather.info.isDevData,
      });
    }
    return this.weather;
  }

  getRainfallProvider(): RainfallProvider | null {
    if (!PROVIDERS.weather.enabled) return null;
    if (!this.rainfall) {
      this.rainfall = new OpenMeteoRainfallProvider();
      logger.info("registry.rainfall.resolved", {
        provider: this.rainfall.info.name,
      });
    }
    return this.rainfall;
  }

  getSatelliteProvider(): SatelliteProvider | null {
    if (!PROVIDERS.satellite.enabled) return null;
    if (!this.satellite) {
      const hasCredentials =
        PROVIDERS.satellite.earthdataUser && PROVIDERS.satellite.earthdataPass;
      if (hasCredentials) {
        this.satellite = new GpmImergProvider();
      } else {
        // Fall back to Open-Meteo satellite adapter (rainfall-as-satellite).
        this.satellite = new OpenMeteoSatelliteProvider();
      }
      logger.info("registry.satellite.resolved", {
        provider: this.satellite.info.name,
        hasCredentials: Boolean(hasCredentials),
      });
    }
    return this.satellite;
  }

  getRadarProvider(): RadarProvider | null {
    if (!PROVIDERS.radar.enabled) return null;
    if (!this.radar) {
      this.radar = new OpenMeteoRadarProvider();
      logger.info("registry.radar.resolved", {
        provider: this.radar.info.name,
      });
    }
    return this.radar;
  }

  getNwpProvider(): NWPProvider | null {
    if (!PROVIDERS.nwp.enabled) return null;
    if (!this.nwp) {
      this.nwp = new OpenMeteoNwpProvider();
      logger.info("registry.nwp.resolved", { provider: this.nwp.info.name });
    }
    return this.nwp;
  }

  /**
   * Returns a snapshot of every active provider's info block. Useful for the
   * /healthz endpoint and the dashboard's "data sources" panel.
   */
  snapshot(): Record<string, unknown> {
    return {
      weather: this.weather?.info ?? null,
      rainfall: this.rainfall?.info ?? null,
      satellite: this.satellite?.info ?? null,
      radar: this.radar?.info ?? null,
      nwp: this.nwp?.info ?? null,
    };
  }

  /** Reset the registry — used by tests. */
  reset(): void {
    this.weather = null;
    this.rainfall = null;
    this.satellite = null;
    this.radar = null;
    this.nwp = null;
  }
}

export const providerRegistry = new ProviderRegistry();

export default providerRegistry;
