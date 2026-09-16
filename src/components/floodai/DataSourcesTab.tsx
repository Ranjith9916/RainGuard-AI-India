"use client";

/**
 * DataSourcesTab.tsx
 *
 * Documentation view — 8 data sources powering the Flood-AI system.
 * Each card describes the source, its role, refresh policy and the
 * corresponding adapter module.
 */

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Cloud,
  Database,
  Globe,
  Layers,
  Radar,
  Satellite,
  ScrollText,
  Webhook,
} from "lucide-react";

interface DataSource {
  id: string;
  name: string;
  category: "weather" | "satellite" | "radar" | "nwp" | "model" | "physics" | "reference" | "persistence";
  description: string;
  endpoint?: string;
  adapterModule?: string;
  refreshPolicy: string;
  enabled: boolean;
  notes?: string;
}

const DATA_SOURCES: DataSource[] = [
  {
    id: "openweathermap",
    name: "OpenWeatherMap API",
    category: "weather",
    description:
      "Primary weather provider — current conditions, 5-day / 3-hour forecast, and forward geocoding. WMO condition codes are mapped from OWM weather codes.",
    endpoint: "https://api.openweathermap.org/data/2.5",
    adapterModule: "@/lib/weather/openweathermap.ts",
    refreshPolicy: "5 min current · 30 min forecast (TTL-cached)",
    enabled: true,
    notes:
      "Requires OPENWEATHERMAP_API_KEY. Falls back to Open-Meteo on failure.",
  },
  {
    id: "open-meteo",
    name: "Open-Meteo API",
    category: "weather",
    description:
      "Fallback weather provider + canonical source for radar reflectivity (Marshall-Palmer inversion) and NWP forecasts (GEM-Global default).",
    endpoint: "https://api.open-meteo.com/v1",
    adapterModule: "@/lib/weather/open-meteo.ts",
    refreshPolicy: "10 min hourly · 30 min forecast (TTL-cached)",
    enabled: true,
    notes: "No API key required. Used when OWM is disabled or unreachable.",
  },
  {
    id: "gpm-imerg",
    name: "NASA GPM IMERG",
    category: "satellite",
    description:
      "Half-hourly global satellite precipitation from the Global Precipitation Measurement mission. Used to validate ground-station rainfall and feed cloudburst early-warning.",
    endpoint: "https://gpm1.gesdisc.eosdis.nasa.gov",
    adapterModule: "@/lib/adapters/satellite/gpm-imerg.provider.ts",
    refreshPolicy: "15 min cache · ~3 hour latency",
    enabled: true,
    notes:
      "Requires EARTHDATA_USER / EARTHDATA_PASS. Falls back to Open-Meteo satellite proxy when credentials are missing.",
  },
  {
    id: "sentinel-1",
    name: "Copernicus Sentinel-1 SAR",
    category: "satellite",
    description:
      "Synthetic Aperture Radar imagery for flood-mask inference. The baseline build synthesises SAR patches deterministically from region lat/lon — production should wire up the Copernicus OData catalog.",
    endpoint: "https://scihub.copernicus.eu/dhus",
    adapterModule: "@/lib/adapters/sentinel1/sentinel1.provider.ts",
    refreshPolicy: "6-12 day revisit · on-demand",
    enabled: true,
    notes:
      "SAR patches are converted to RGB via dB→linear + square-root stretch (VV/VH composite) before inference.",
  },
  {
    id: "etci-unet",
    name: "ETCI 2020 U-Net",
    category: "model",
    description:
      "U-Net trained on Sentinel-1 SAR patches for binary flood segmentation. Weights are NOT bundled in the baseline build — the inferencer falls back to Otsu threshold detection.",
    adapterModule: "@/lib/adapters/flood-model/flood-inferencer.ts",
    refreshPolicy: "On-demand inference",
    enabled: false,
    notes:
      "Bundle src/lib/flood-detection/models/etci_unet_sar.onnx to enable. Threshold baseline is used in the meantime.",
  },
  {
    id: "nrcs-cn",
    name: "NRCS Curve-Number Runoff",
    category: "physics",
    description:
      "TR-55 Curve-Number runoff model — converts rainfall + land-cover CN into inundation depth. Used by the inundation baseline and cloudburst impact engine.",
    adapterModule: "@/lib/weather/risk-engine.ts",
    refreshPolicy: "Per prediction (no caching)",
    enabled: true,
    notes:
      "CN table covers urban, agricultural, forest and water land-covers. AMC I/II/III adjustments for antecedent moisture.",
  },
  {
    id: "imd-thresholds",
    name: "IMD Rainfall Thresholds",
    category: "reference",
    description:
      "India Meteorological Department classification: heavy 1h (25 mm), heavy 24h (64.5 mm), very heavy 24h (115.6 mm), extremely heavy 24h (204.5 mm).",
    adapterModule: "@/lib/config/config.ts → RAINFALL_THRESHOLDS",
    refreshPolicy: "Static reference",
    enabled: true,
    notes:
      "Used by the heavy-rain baseline classifier and as the alert-engine thresholds.",
  },
  {
    id: "sqlite-prisma",
    name: "SQLite + Prisma",
    category: "persistence",
    description:
      "Time-series persistence for pipeline runs, weather observations, rainfall records, flood predictions and alerts. SQLite in the baseline build; portable to Postgres via Prisma.",
    endpoint: "file:./db/custom.db",
    adapterModule: "@/lib/db.ts · prisma/schema.prisma",
    refreshPolicy: "Synchronous writes per pipeline run",
    enabled: true,
    notes:
      "Models: PipelineRun, WeatherStation, WeatherObservation, RainfallRecord, FloodPrediction, Alert, ModelRegistry, ModelMetric.",
  },
];

const CATEGORY_COLOR: Record<DataSource["category"], string> = {
  weather: "#3B82F6",
  satellite: "#A855F7",
  radar: "#06B6D4",
  nwp: "#10B981",
  model: "#F59E0B",
  physics: "#F97316",
  reference: "#64748B",
  persistence: "#22C55E",
};

const CATEGORY_ICON: Record<DataSource["category"], React.ReactNode> = {
  weather: <Cloud className="size-4" />,
  satellite: <Satellite className="size-4" />,
  radar: <Radar className="size-4" />,
  nwp: <Globe className="size-4" />,
  model: <Layers className="size-4" />,
  physics: <Webhook className="size-4" />,
  reference: <ScrollText className="size-4" />,
  persistence: <Database className="size-4" />,
};

export default function DataSourcesTab() {
  return (
    <div className="flex flex-col gap-4">
      <Card className="gap-3 p-4">
        <div className="flex items-center gap-2">
          <Database className="size-5 text-emerald-400" />
          <div>
            <div className="text-sm font-semibold">Data sources</div>
            <div className="text-xs text-muted-foreground">
              8 sources powering weather, satellite, radar, NWP, ML and
              persistence across the Flood-AI pipeline.
            </div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {DATA_SOURCES.map((src) => {
          const color = CATEGORY_COLOR[src.category];
          return (
            <Card
              key={src.id}
              className="gap-2 p-4"
              style={{ borderTop: `3px solid ${color}` }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span style={{ color }}>{CATEGORY_ICON[src.category]}</span>
                  <span className="text-sm font-semibold">{src.name}</span>
                </div>
                <Badge
                  variant="outline"
                  className="text-[10px]"
                  style={{ borderColor: color, color }}
                >
                  {src.category}
                </Badge>
              </div>

              <div className="text-xs text-muted-foreground">
                {src.description}
              </div>

              <div className="mt-1 grid grid-cols-1 gap-1 text-[10px]">
                {src.endpoint && (
                  <div className="flex items-start gap-1.5">
                    <span className="font-semibold uppercase text-muted-foreground">
                      Endpoint:
                    </span>
                    <span className="break-all font-mono text-foreground">
                      {src.endpoint}
                    </span>
                  </div>
                )}
                {src.adapterModule && (
                  <div className="flex items-start gap-1.5">
                    <span className="font-semibold uppercase text-muted-foreground">
                      Adapter:
                    </span>
                    <span className="break-all font-mono text-foreground">
                      {src.adapterModule}
                    </span>
                  </div>
                )}
                <div className="flex items-start gap-1.5">
                  <span className="font-semibold uppercase text-muted-foreground">
                    Refresh:
                  </span>
                  <span className="text-foreground">{src.refreshPolicy}</span>
                </div>
                <div className="flex items-start gap-1.5">
                  <span className="font-semibold uppercase text-muted-foreground">
                    Status:
                  </span>
                  <span
                    className={
                      src.enabled
                        ? "text-emerald-400"
                        : "text-amber-400"
                    }
                  >
                    {src.enabled ? "enabled" : "disabled / fallback"}
                  </span>
                </div>
              </div>

              {src.notes && (
                <div className="mt-1 rounded-md bg-muted/40 p-2 text-[10px] text-foreground">
                  {src.notes}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
