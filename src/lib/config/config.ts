/**
 * RainGuard-AI / Flood-AI System — Central Configuration
 *
 * This module is the single source of truth for all configurable knobs in the
 * system: data-provider credentials, rainfall/risk/alert thresholds, forecast
 * horizons, ML model registry, cache TTLs and system metadata.
 *
 * Secrets are read from `process.env` lazily so they can be rotated without
 * rebuilding the bundle. Everything that flows through the pipeline — the
 * providers that get instantiated, the alert levels that get emitted, the
 * cache durations that get honoured — ultimately reads from this module.
 */

import { logger } from "@/lib/config/logger";

/* -------------------------------------------------------------------------- */
/*  Environment helpers                                                       */
/* -------------------------------------------------------------------------- */

function env(key: string, fallback = ""): string {
  const v = process.env[key];
  if (!v || v.length === 0) return fallback;
  return v;
}

function envNumber(key: string, fallback: number): number {
  const v = process.env[key];
  if (v == null || v.trim() === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(key: string, fallback: boolean): boolean {
  const v = (process.env[key] ?? "").toLowerCase();
  if (v === "") return fallback;
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/* -------------------------------------------------------------------------- */
/*  Data providers                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Multi-source data providers. Each provider has a `type` discriminator and
 * provider-specific credentials. Providers that are flagged `enabled: false`
 * are skipped by the adapter registry.
 */
export const PROVIDERS = {
  weather: {
    type: "openweathermap" as const,
    apiKey: env("OPENWEATHERMAP_API_KEY"),
    baseUrl: "https://api.openweathermap.org/data/2.5",
    geoUrl: "https://api.openweathermap.org/geo/1.0",
    enabled: envBool("OPENWEATHERMAP_ENABLED", true),
  },
  satellite: {
    type: "gpmImerg" as const,
    earthdataUser: env("EARTHDATA_USER"),
    earthdataPass: env("EARTHDATA_PASS"),
    imergUrl: "https://gpm1.gesdisc.eosdis.nasa.gov",
    fallbackToOpenMeteo: envBool("IMERG_FALLBACK_OPEN_METEO", true),
    enabled: envBool("IMERG_ENABLED", true),
  },
  radar: {
    type: "open-meteo" as const,
    baseUrl: "https://api.open-meteo.com/v1",
    enabled: envBool("RADAR_ENABLED", true),
  },
  nwp: {
    type: "open-meteo" as const,
    baseUrl: "https://api.open-meteo.com/v1",
    model: env("NWP_MODEL", "gem_global"),
    enabled: envBool("NWP_ENABLED", true),
  },
} as const;

/* -------------------------------------------------------------------------- */
/*  Rainfall thresholds (mm)                                                  */
/*  Values based on IMD classification.                                       */
/* -------------------------------------------------------------------------- */

export const RAINFALL_THRESHOLDS = {
  /** ≥ 25 mm in one hour */
  heavy1h: 25,
  /** ≥ 64.5 mm in 24 hours (2.5 inches) */
  heavy24h: 64.5,
  /** ≥ 115.6 mm in 24 hours (4.5 inches) */
  veryHeavy24h: 115.6,
  /** ≥ 204.5 mm in 24 hours (8 inches) */
  extremelyHeavy24h: 204.5,
} as const;

/* -------------------------------------------------------------------------- */
/*  Inundation risk thresholds                                                */
/* -------------------------------------------------------------------------- */

export const RISK_THRESHOLDS = {
  /** Subtle ponding begins */
  lowDepthM: 0.05,
  /** Road / underpass inundation likely */
  moderateDepthM: 0.2,
  /** Significant flooding; ground-floor entry */
  highDepthM: 0.5,
  /** Life-threatening; first-floor inundation */
  criticalDepthM: 1.0,
  /** Max depth we will report (clamps absurd outputs) */
  maxDepthM: 5.0,
} as const;

/* -------------------------------------------------------------------------- */
/*  Alert thresholds                                                          */
/* -------------------------------------------------------------------------- */

export const ALERT_THRESHOLDS = {
  /** Lower-bound heavy-rain probability to issue at least an INFO */
  infoProbability: 0.2,
  watchProbability: 0.4,
  advisoryProbability: 0.55,
  warningProbability: 0.7,
  severeWarningProbability: 0.85,
  emergencyProbability: 0.95,
  /** Dedup window in hours — same city+level can't fire twice inside this */
  dedupHours: 1,
  /** Maximum active alerts retained in memory ring buffer */
  maxRetained: 500,
} as const;

/* -------------------------------------------------------------------------- */
/*  Forecast horizons (minutes)                                              */
/* -------------------------------------------------------------------------- */

export const FORECAST_HORIZONS = {
  nowcast: 60,
  short: 180,
  medium: 360,
  extended: 720,
  daily: 1440,
} as const;

/* -------------------------------------------------------------------------- */
/*  Rainfall aggregation windows                                              */
/* -------------------------------------------------------------------------- */

export const RAINFALL_AGGREGATIONS = {
  windows: [1, 3, 6, 12, 24] as const,
  defaultWindow: 24,
} as const;

/* -------------------------------------------------------------------------- */
/*  ML model registry                                                         */
/* -------------------------------------------------------------------------- */

export interface ModelRegistryEntry {
  name: string;
  version: string;
  type: "baseline" | "ml" | "onnx";
  artifactPath?: string;
  isBaseline: boolean;
  isTrainedOnLabels: boolean;
  description: string;
}

export const ML_MODELS = {
  heavyRain: {
    name: "heavy-rain-baseline",
    version: "0.1.0",
    type: "baseline" as const,
    isBaseline: true,
    isTrainedOnLabels: false,
    description:
      "Threshold-based heavy-rain classifier. Uses 1h/24h accumulated rainfall vs IMD thresholds.",
  },
  rainfallForecast: {
    name: "rainfall-forecast-baseline",
    version: "0.1.0",
    type: "baseline" as const,
    isBaseline: true,
    isTrainedOnLabels: false,
    description:
      "Persistence + linear extrapolation baseline. No learned weights.",
  },
  floodProbability: {
    name: "flood-probability-baseline",
    version: "0.1.0",
    type: "baseline" as const,
    isBaseline: true,
    isTrainedOnLabels: false,
    description:
      "Logistic-of-rainfall-and-CN baseline. Weights are hand-tuned, not learned.",
  },
  inundation: {
    name: "inundation-baseline",
    version: "0.1.0",
    type: "baseline" as const,
    isBaseline: true,
    isTrainedOnLabels: false,
    description:
      "NRCS Curve-Number runoff → uniform-depth-on-area approximation.",
  },
  sarFlood: {
    name: "etci-unet-sar",
    version: "0.1.0",
    type: "onnx" as const,
    artifactPath: "@/lib/flood-detection/models/etci_unet_sar.onnx",
    isBaseline: false,
    isTrainedOnLabels: true,
    description:
      "ETCI 2020 U-Net trained on Sentinel-1 SAR patches for flood segmentation. Threshold baseline is used when ONNX weights are unavailable.",
  },
  cloudburst: {
    name: "cloudburst-convlstm",
    version: "0.1.0",
    type: "ml" as const,
    isBaseline: true,
    isTrainedOnLabels: false,
    description:
      "Cloudburst early-warning pipeline. Simulated ConvLSTM/Transformer/PINN — physics-driven heuristics, not learned weights.",
  },
} as const;

/* -------------------------------------------------------------------------- */
/*  Cache TTLs (seconds)                                                      */
/* -------------------------------------------------------------------------- */

export const CACHE_TTL = {
  weather: {
    current: 300, // 5 min
    hourly: 600, // 10 min
    forecast: 1800, // 30 min
  },
  rainfall: {
    hourly: 600,
    daily: 3600,
  },
  satellite: {
    imerg: 900, // 15 min — IMERG latency is ~3 hours but cache benefits
  },
  radar: {
    reflectivity: 300,
  },
  nwp: {
    forecast: 1800,
  },
  alerts: {
    active: 60,
    history: 3600,
  },
  default: 300,
} as const;

/* -------------------------------------------------------------------------- */
/*  System metadata                                                           */
/* -------------------------------------------------------------------------- */

export const SYSTEM = {
  name: "RainGuard-AI",
  description:
    "Flood early-warning platform for India — multi-source weather ingestion, NRCS runoff modelling, ML baselines, alerting.",
  version: "0.1.0",
  environment: env("NODE_ENV", "development"),
  isDevData: false,
  timezone: "Asia/Kolkata",
  /** Force live APIs even when dev fixtures are present */
  forceLiveApis: envBool("FORCE_LIVE_APIS", false),
  /** Default centre of the map viewport (India) */
  defaultViewport: {
    latitude: 22.5937,
    longitude: 78.9629,
    zoom: 4.2,
  },
} as const;

/* -------------------------------------------------------------------------- */
/*  Boot self-check                                                           */
/* -------------------------------------------------------------------------- */

export function logConfigSummary(): void {
  const providerStatus = Object.entries(PROVIDERS).map(([k, p]) => {
    const enabled = "enabled" in p ? (p as { enabled: boolean }).enabled : true;
    return `${k}=${enabled ? "on" : "off"}`;
  });
  logger.info("config.boot", {
    system: SYSTEM.name,
    version: SYSTEM.version,
    env: SYSTEM.environment,
    isDevData: SYSTEM.isDevData,
    providers: providerStatus.join(","),
    weatherProvider: env("WEATHER_PROVIDER", "openweathermap"),
  });
}

export default {
  PROVIDERS,
  RAINFALL_THRESHOLDS,
  RISK_THRESHOLDS,
  ALERT_THRESHOLDS,
  FORECAST_HORIZONS,
  RAINFALL_AGGREGATIONS,
  ML_MODELS,
  CACHE_TTL,
  SYSTEM,
};
