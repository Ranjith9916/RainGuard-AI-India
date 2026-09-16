"use client";

/**
 * WeatherApp.tsx
 *
 * Main application shell — Google-Weather-style dashboard for the RainGuard-AI
 * / Flood-AI system.
 *
 * Layout:
 *   - Sticky header: brand + pill search + Refresh + last-updated time.
 *   - Sticky tab strip (9 tabs, horizontally scrollable via .rainguard-scrollbar).
 *   - Tab content (scrollable).
 *   - Sticky footer: DB health, active provider, model count, version.
 *
 * The Weather tab pulls /api/weather/cities (16-city bundle) + /api/system/status
 * and feeds the resulting CityWeatherPayload[] into the hero, hourly strip,
 * weather details grid, risk index, India map and the cities list.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { CITIES, getCityById } from "@/lib/weather/cities";
import type { CityWeatherPayload } from "@/lib/weather/types";

import WeatherHero from "@/components/weather/WeatherHero";
import HourlyForecast from "@/components/weather/HourlyForecast";
import CitiesForecast from "@/components/weather/CitiesForecast";
import WeatherDetails from "@/components/weather/WeatherDetails";
import RiskIndex from "@/components/weather/RiskIndex";
import dynamic from "next/dynamic";
const IndiaMap = dynamic(() => import("@/components/rainguard/IndiaMap"), { ssr: false });
import ImergTab from "@/components/weather/ImergTab";
import CloudburstTab from "@/components/weather/CloudburstTab";
import FloodDetectionTab from "@/components/weather/FloodDetectionTab";
import AlertsTab from "@/components/floodai/AlertsTab";
import RainfallTab from "@/components/floodai/RainfallTab";
import ModelsTab from "@/components/floodai/ModelsTab";
import PipelineTab from "@/components/floodai/PipelineTab";
import DataSourcesTab from "@/components/floodai/DataSourcesTab";

import {
  Activity,
  CloudSun,
  Database,
  Layers3,
  RefreshCw,
  Search,
  Siren,
} from "lucide-react";

const TABS = [
  { value: "weather", label: "Weather" },
  { value: "cloudburst", label: "Cloudburst" },
  { value: "flood", label: "Flood Detection" },
  { value: "imerg", label: "NASA IMERG" },
  { value: "alerts", label: "Alerts" },
  { value: "rainfall", label: "Rainfall" },
  { value: "models", label: "Models" },
  { value: "pipeline", label: "Pipeline" },
  { value: "sources", label: "Data Sources" },
] as const;

type TabValue = (typeof TABS)[number]["value"];

interface CitiesApiResponse {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  horizonMinutes: number;
  citiesProcessed: number;
  citiesSucceeded: number;
  citiesFailed: number;
  alertsEmitted: number;
  results: Array<
    | {
        cityId: string;
        cityName: string;
        state: string;
        ok: true;
        durationMs: number;
        payload: CityWeatherPayload;
        alert: unknown;
      }
    | {
        cityId: string;
        cityName: string;
        state: string;
        ok: false;
        durationMs: number;
        error: string;
      }
  >;
}

interface SystemStatusResponse {
  system: {
    name: string;
    version: string;
    environment: string;
    isDevData: boolean;
    timezone: string;
    startedAt: string;
  };
  db: { healthy: boolean; error: string | null; activeAlertCount: number };
  providers: {
    weather: { type: string; enabled: boolean; apiKeyConfigured: boolean; activeProvider: string };
    satellite: {
      type: string;
      enabled: boolean;
      earthdataConfigured: boolean;
      fallbackToOpenMeteo: boolean;
    };
  };
  models: { registeredCount: number };
}

export default function WeatherApp() {
  const [tab, setTab] = useState<TabValue>("weather");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CitiesApiResponse | null>(null);
  const [status, setStatus] = useState<SystemStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [selectedCityId, setSelectedCityId] = useState<string>("mumbai");
  const { toast } = useToast();

  const fetchCities = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/weather/cities?horizon=360", {
        cache: "no-store",
      });
      if (!r.ok) throw new Error(`weather/cities ${r.status}`);
      const j = (await r.json()) as CitiesApiResponse;
      setResults(j);
      setLastUpdated(new Date());
      toast({
        title: "Refresh complete",
        description: `${j.citiesSucceeded}/${j.citiesProcessed} cities · ${j.alertsEmitted} alerts emitted`,
      });
    } catch (err) {
      setError((err as Error).message);
      toast({
        title: "Refresh failed",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch("/api/system/status", { cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json()) as SystemStatusResponse;
      setStatus(j);
    } catch {
      // non-fatal
    }
  }, []);

  useEffect(() => {
    fetchCities();
    fetchStatus();
  }, [fetchCities, fetchStatus]);

  // Pull the per-city payloads out of the cities-API response.
  const cityPayloads: CityWeatherPayload[] = useMemo(() => {
    if (!results) return [];
    return results.results
      .filter((r) => r.ok)
      .map((r) => (r as { payload: CityWeatherPayload }).payload);
  }, [results]);

  // Search across cities — instant local registry match.
  function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim().toLowerCase();
    if (!q) return;
    // Try direct city name match first.
    const match = CITIES.find(
      (c) =>
        c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q),
    );
    if (match) {
      setSelectedCityId(match.id);
      setTab("weather");
      toast({
        title: "Selected city",
        description: `${match.name}, ${match.state}`,
      });
      return;
    }
    toast({
      title: "No match",
      description: `No city matched "${query}"`,
    });
  }

  // The payload currently focused in the Weather tab.
  const selectedPayload =
    cityPayloads.find((p) => p.cityId === selectedCityId) ?? cityPayloads[0] ?? null;

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-gradient-to-br from-sky-500 to-violet-600 p-1.5">
              <CloudSun className="size-5 text-white" />
            </div>
            <div>
              <div className="text-sm font-bold leading-tight">
                RainGuard-AI
              </div>
              <div className="text-[10px] text-muted-foreground leading-tight">
                Flood-AI Weather · India
              </div>
            </div>
          </div>

          {/* Pill search */}
          <form
            onSubmit={onSearchSubmit}
            className="relative ml-auto flex min-w-[200px] flex-1 items-center sm:max-w-md"
          >
            <Search className="pointer-events-none absolute left-3 size-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search city — e.g. Mumbai, chennai, BLR"
              className="rounded-full bg-muted/40 pl-9"
            />
          </form>

          <Button
            variant="default"
            size="sm"
            onClick={fetchCities}
            disabled={loading}
            className="rounded-full"
          >
            <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
            Refresh
          </Button>
        </div>

        {/* Tab strip */}
        <div className="mx-auto max-w-7xl px-4">
          <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
            <TabsList className="rainguard-scrollbar h-auto w-full gap-1 overflow-x-auto rounded-none bg-transparent p-0">
              {TABS.map((t) => (
                <TabsTrigger
                  key={t.value}
                  value={t.value}
                  className="rounded-md data-[state=active]:bg-primary/15 data-[state=active]:text-foreground"
                >
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </header>

      {/* Body */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-4">
        {error && (
          <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            Error: {error}
          </div>
        )}

        {tab === "weather" && (
          <WeatherTab
            loading={loading}
            cityPayloads={cityPayloads}
            selectedPayload={selectedPayload}
            selectedCityId={selectedCityId}
            onSelectCity={setSelectedCityId}
          />
        )}

        {tab === "cloudburst" && <CloudburstTab />}
        {tab === "flood" && <FloodDetectionTab />}
        {tab === "imerg" && <ImergTab />}
        {tab === "alerts" && <AlertsTab />}
        {tab === "rainfall" && <RainfallTab />}
        {tab === "models" && <ModelsTab />}
        {tab === "pipeline" && <PipelineTab />}
        {tab === "sources" && <DataSourcesTab />}
      </main>

      {/* Footer */}
      <footer className="sticky bottom-0 z-20 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-[10px] text-muted-foreground">
          <div className="flex items-center gap-1">
            <Database
              className={`size-3 ${status?.db.healthy ? "text-emerald-400" : "text-destructive"}`}
            />
            <span>
              DB:{" "}
              <span
                className={
                  status?.db.healthy ? "text-emerald-400" : "text-destructive"
                }
              >
                {status ? (status.db.healthy ? "healthy" : "degraded") : "—"}
              </span>
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Activity className="size-3" />
            <span>Provider: {status?.providers.weather.activeProvider ?? "—"}</span>
          </div>
          <div className="flex items-center gap-1">
            <Layers3 className="size-3" />
            <span>Models: {status?.models.registeredCount ?? "—"}</span>
          </div>
          <div className="flex items-center gap-1">
            <Siren className="size-3 text-amber-400" />
            <span>
              Active alerts:{" "}
              <span className="text-foreground">
                {status?.db.activeAlertCount ?? "—"}
              </span>
            </span>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <RefreshCw
              className={`size-3 ${loading ? "animate-spin" : ""}`}
            />
            <span>
              {lastUpdated
                ? `Updated ${lastUpdated.toLocaleTimeString("en-IN")}`
                : "Never refreshed"}
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ---------- Weather tab ---------- */

function WeatherTab({
  loading,
  cityPayloads,
  selectedPayload,
  selectedCityId,
  onSelectCity,
}: {
  loading: boolean;
  cityPayloads: CityWeatherPayload[];
  selectedPayload: CityWeatherPayload | null;
  selectedCityId: string;
  onSelectCity: (id: string) => void;
}) {
  if (loading && cityPayloads.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-72 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (cityPayloads.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No city data yet — press the Refresh button in the header.
      </div>
    );
  }

  const hourly = selectedPayload?.hourly ?? [];
  const current = selectedPayload?.current ?? null;

  return (
    <div className="flex flex-col gap-4">
      <WeatherHero payload={selectedPayload} />

      <HourlyForecast hourly={hourly} />

      <WeatherDetails current={current} />

      <RiskIndex
        probability={selectedPayload?.floodProbability ?? 0}
        riskLevel={selectedPayload?.riskLevel ?? "LOW"}
        inundationDepthM={selectedPayload?.inundationDepthM ?? 0}
        forecastRainfallMm={selectedPayload?.forecastRainfallMm ?? 0}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <IndiaMap
          cities={cityPayloads}
          selectedCityId={selectedCityId}
          onSelect={onSelectCity}
          height={480}
        />
        <CitiesForecast
          cities={cityPayloads}
          selectedCityId={selectedCityId}
          onSelect={onSelectCity}
        />
      </div>

      <CitySelector
        cityId={selectedCityId}
        onChange={onSelectCity}
      />
    </div>
  );
}

/* ---------- city selector (small dropdown at the bottom for mobile) ---------- */

function CitySelector({
  cityId,
  onChange,
}: {
  cityId: string;
  onChange: (id: string) => void;
}) {
  const city = getCityById(cityId);
  if (!city) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>Focused on:</span>
      <Badge variant="secondary">{city.name}</Badge>
      <span>· {city.state}</span>
      <span>· pop. {city.population.toLocaleString("en-IN")}</span>
      <span className="ml-auto">{city.riskNote}</span>
    </div>
  );
}
