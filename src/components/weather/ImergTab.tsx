"use client";

/**
 * ImergTab.tsx
 *
 * NASA IMERG satellite rainfall view for a selected city.
 *
 * Fetches `/api/imerg/rainfall?lat=&lon=&horizon=1440` and renders:
 *   - Status card (provider kind, credentials, cache TTL)
 *   - Accumulation cards (1h, 3h, 6h, 24h)
 *   - Bar chart with color-coded bars by rainfall intensity (mm/h):
 *       purple  = light (<2.5 mm/h)
 *       green   = normal (2.5–10)
 *       amber   = heavy (10–25)
 *       orange  = very heavy (25–50)
 *       red     = extreme (>50)
 *     Threshold reference lines for IMD 1h heavy (25 mm/h) and
 *     very-heavy-equivalent (50 mm/h).
 *   - Cumulative area chart (mm accumulated over time)
 */

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CITIES } from "@/lib/weather/cities";
import { RAINFALL_THRESHOLDS } from "@/lib/config/config";
import {
  Activity,
  CloudRain,
  Gauge,
  RefreshCw,
  Satellite,
  TrendingUp,
} from "lucide-react";

interface ImergReading {
  time: string;
  rainfallMm?: number;
  durationMinutes?: number;
  source?: string;
  sensor?: string;
}

interface ImergResponse {
  ok: boolean;
  lat: number;
  lon: number;
  horizonMinutes: number;
  provider?: { name?: string; type?: string; version?: string };
  count: number;
  summary: {
    totalMm: number;
    maxMm: number;
    wetReadings: number;
    wetFraction: number;
  };
  readings: ImergReading[];
}

interface ImergStatusResponse {
  ok: boolean;
  provider: {
    kind: "gpm-imerg" | "open-meteo-fallback" | "disabled";
    info?: { name?: string; type?: string };
    credentialsConfigured: boolean;
    fallbackToOpenMeteo: boolean;
    enabled: boolean;
    imergUrl?: string;
    cacheTtlSeconds?: number;
    notes?: string;
  };
}

const SEVERITY_COLORS = {
  light: "#A855F7", // purple
  normal: "#22C55E", // green
  heavy: "#F59E0B", // amber
  veryHeavy: "#F97316", // orange
  extreme: "#DC2626", // red
};

function severityOf(rateMmPerH: number): keyof typeof SEVERITY_COLORS {
  if (rateMmPerH < 2.5) return "light";
  if (rateMmPerH < 10) return "normal";
  if (rateMmPerH < 25) return "heavy";
  if (rateMmPerH < 50) return "veryHeavy";
  return "extreme";
}

export default function ImergTab() {
  const [cityId, setCityId] = useState<string>("mumbai");
  const [data, setData] = useState<ImergResponse | null>(null);
  const [status, setStatus] = useState<ImergStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const city = CITIES.find((c) => c.id === cityId);

  async function fetchStatus() {
    try {
      const r = await fetch("/api/imerg/status", { cache: "no-store" });
      if (!r.ok) throw new Error(`status ${r.status}`);
      const j = (await r.json()) as ImergStatusResponse;
      setStatus(j);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function fetchRainfall() {
    if (!city) return;
    setLoading(true);
    setError(null);
    try {
      const url = `/api/imerg/rainfall?lat=${city.latitude}&lon=${city.longitude}&horizon=1440`;
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) throw new Error(`rainfall ${r.status}`);
      const j = (await r.json()) as ImergResponse;
      setData(j);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchStatus();
  }, []);

  useEffect(() => {
    fetchRainfall();
  }, [cityId]);

  // Build the bar-chart series: each entry is a 30-min reading with its
  // rate (mm/h) for colouring and the mm value for the bar height.
  const series = useMemo(() => {
    if (!data?.readings) return [];
    return data.readings.map((r) => {
      const durH = (r.durationMinutes ?? 30) / 60;
      const rate = (r.rainfallMm ?? 0) / Math.max(0.001, durH);
      return {
        time: r.time,
        mm: r.rainfallMm ?? 0,
        rate: Number(rate.toFixed(2)),
        severity: severityOf(rate),
        source: r.source ?? "imerg",
      };
    });
  }, [data]);

  // Cumulative series for the area chart.
  const cumulative = useMemo(() => {
    let acc = 0;
    return series.map((s) => {
      acc += s.mm;
      return {
        time: s.time,
        cumulative: Number(acc.toFixed(2)),
        rate: s.rate,
      };
    });
  }, [series]);

  // Accumulation cards — sum of readings within the last N hours.
  const accumulations = useMemo(() => {
    if (series.length === 0) return { "1h": 0, "3h": 0, "6h": 0, "24h": 0 };
    const now = new Date(series[series.length - 1]!.time).getTime();
    const out: Record<string, number> = { "1h": 0, "3h": 0, "6h": 0, "24h": 0 };
    for (const s of series) {
      const ageMin = (now - new Date(s.time).getTime()) / 60000;
      if (ageMin <= 60) out["1h"]! += s.mm;
      if (ageMin <= 180) out["3h"]! += s.mm;
      if (ageMin <= 360) out["6h"]! += s.mm;
      if (ageMin <= 1440) out["24h"]! += s.mm;
    }
    return out;
  }, [series]);

  const lastTime = series[series.length - 1]?.time;
  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  const fmtHour = (iso: string) =>
    new Date(iso).toLocaleString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "short",
    });

  return (
    <div className="flex flex-col gap-4">
      {/* Header / controls */}
      <Card className="gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Satellite className="size-5 text-violet-400" />
            <div>
              <div className="text-sm font-semibold">NASA IMERG Satellite Rainfall</div>
              <div className="text-xs text-muted-foreground">
                Half-hourly GPM IMERG precipitation (with Open-Meteo fallback)
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Select value={cityId} onValueChange={setCityId}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Select city" />
              </SelectTrigger>
              <SelectContent>
                {CITIES.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              onClick={fetchRainfall}
              disabled={loading}
              title="Refresh"
            >
              <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
            </Button>
          </div>
        </div>
      </Card>

      {/* Status card */}
      <Card className="gap-3 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Activity className="size-4 text-violet-400" />
          <span>Provider status</span>
        </div>
        {!status ? (
          <Skeleton className="h-12 w-full" />
        ) : (
          <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
            <StatusItem
              label="Active provider"
              value={status.provider?.kind ?? "unknown"}
            />
            <StatusItem
              label="Credentials"
              value={status.provider?.credentialsConfigured ? "OK" : "missing"}
              tone={status.provider?.credentialsConfigured ? "ok" : "warn"}
            />
            <StatusItem
              label="Fallback"
              value={status.provider?.fallbackToOpenMeteo ? "Open-Meteo" : "off"}
            />
            <StatusItem
              label="Cache TTL"
              value={`${status.provider?.cacheTtlSeconds ?? 0}s`}
            />
          </div>
        )}
      </Card>

      {/* Accumulation cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <AccumulationCard
          icon={<CloudRain className="size-4 text-sky-400" />}
          label="1h"
          mm={accumulations["1h"]!}
          threshold={RAINFALL_THRESHOLDS.heavy1h}
          thresholdLabel="heavy 1h"
        />
        <AccumulationCard
          icon={<CloudRain className="size-4 text-sky-400" />}
          label="3h"
          mm={accumulations["3h"]!}
          threshold={RAINFALL_THRESHOLDS.heavy1h * 3}
          thresholdLabel="heavy 3h"
        />
        <AccumulationCard
          icon={<CloudRain className="size-4 text-sky-400" />}
          label="6h"
          mm={accumulations["6h"]!}
          threshold={RAINFALL_THRESHOLDS.heavy24h / 4}
          thresholdLabel="heavy 6h"
        />
        <AccumulationCard
          icon={<CloudRain className="size-4 text-sky-400" />}
          label="24h"
          mm={accumulations["24h"]!}
          threshold={RAINFALL_THRESHOLDS.heavy24h}
          thresholdLabel="heavy 24h"
        />
      </div>

      {error && (
        <Card className="border-destructive/40 p-4 text-sm text-destructive">
          Error: {error}
        </Card>
      )}

      {/* Bar chart — colour-coded by severity */}
      <Card className="gap-3 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <TrendingUp className="size-4 text-violet-400" />
            <span>Half-hourly rainfall rate</span>
          </div>
          <Badge variant="secondary" className="text-xs">
            {series.length} readings
          </Badge>
        </div>

        <div className="h-72 w-full">
          {loading ? (
            <Skeleton className="h-full w-full" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={series}
                margin={{ top: 8, right: 8, bottom: 4, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
                <XAxis
                  dataKey="time"
                  tickFormatter={(t: string) =>
                    // Show every Nth label so the axis isn't crowded.
                    series.findIndex((s) => s.time === t) % 8 === 0
                      ? fmtTime(t)
                      : ""
                  }
                  tick={{ fill: "#9ca3af", fontSize: 10 }}
                  stroke="#4a4a5a"
                />
                <YAxis
                  label={{
                    value: "mm/h",
                    angle: -90,
                    position: "insideLeft",
                    fill: "#9ca3af",
                    fontSize: 11,
                  }}
                  tick={{ fill: "#9ca3af", fontSize: 11 }}
                  stroke="#4a4a5a"
                  width={48}
                />
                <Tooltip
                  contentStyle={{
                    background: "#1f1f2e",
                    border: "1px solid #4a4a5a",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelFormatter={(l) => fmtHour(String(l))}
                  formatter={(v, n) => [
                    n === "rate" ? `${v} mm/h` : `${v} mm`,
                    n === "rate" ? "Rate" : "Reading",
                  ]}
                />
                <ReferenceLine
                  y={RAINFALL_THRESHOLDS.heavy1h}
                  stroke="#F59E0B"
                  strokeDasharray="4 4"
                  label={{
                    value: "IMD heavy (25 mm/h)",
                    fill: "#F59E0B",
                    fontSize: 10,
                    position: "insideTopRight",
                  }}
                />
                <ReferenceLine
                  y={50}
                  stroke="#F97316"
                  strokeDasharray="4 4"
                  label={{
                    value: "Very heavy (50 mm/h)",
                    fill: "#F97316",
                    fontSize: 10,
                    position: "insideTopRight",
                  }}
                />
                <Bar dataKey="rate" name="rate" radius={[2, 2, 0, 0]}>
                  {series.map((entry, i) => (
                    <Cell
                      key={`bar-${i}`}
                      fill={SEVERITY_COLORS[entry.severity]}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-3 text-[10px]">
          {(Object.entries(SEVERITY_COLORS) as Array<
            [keyof typeof SEVERITY_COLORS, string]
          >).map(([k, hex]) => (
            <div key={k} className="flex items-center gap-1.5">
              <span
                className="inline-block size-2.5 rounded-sm"
                style={{ background: hex }}
              />
              <span className="capitalize text-muted-foreground">{k}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Cumulative area chart */}
      <Card className="gap-3 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Gauge className="size-4 text-emerald-400" />
            <span>Cumulative accumulation</span>
          </div>
          <Badge variant="secondary" className="text-xs">
            Total: {data?.summary?.totalMm?.toFixed(1) ?? 0} mm
          </Badge>
        </div>
        <div className="h-56 w-full">
          {loading ? (
            <Skeleton className="h-full w-full" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={cumulative}
                margin={{ top: 8, right: 8, bottom: 4, left: 0 }}
              >
                <defs>
                  <linearGradient id="imergCum" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22C55E" stopOpacity={0.8} />
                    <stop offset="100%" stopColor="#22C55E" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
                <XAxis
                  dataKey="time"
                  tickFormatter={(t: string) =>
                    cumulative.findIndex((s) => s.time === t) % 8 === 0
                      ? fmtTime(t)
                      : ""
                  }
                  tick={{ fill: "#9ca3af", fontSize: 10 }}
                  stroke="#4a4a5a"
                />
                <YAxis
                  label={{
                    value: "mm",
                    angle: -90,
                    position: "insideLeft",
                    fill: "#9ca3af",
                    fontSize: 11,
                  }}
                  tick={{ fill: "#9ca3af", fontSize: 11 }}
                  stroke="#4a4a5a"
                  width={48}
                />
                <Tooltip
                  contentStyle={{
                    background: "#1f1f2e",
                    border: "1px solid #4a4a5a",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelFormatter={(l) => fmtHour(String(l))}
                  formatter={(v) => [`${v} mm`, "Cumulative"]}
                />
                <ReferenceLine
                  y={RAINFALL_THRESHOLDS.heavy24h}
                  stroke="#F59E0B"
                  strokeDasharray="4 4"
                  label={{
                    value: "Heavy 24h (64.5 mm)",
                    fill: "#F59E0B",
                    fontSize: 10,
                    position: "insideTopLeft",
                  }}
                />
                <ReferenceLine
                  y={RAINFALL_THRESHOLDS.veryHeavy24h}
                  stroke="#F97316"
                  strokeDasharray="4 4"
                  label={{
                    value: "Very heavy (115.6 mm)",
                    fill: "#F97316",
                    fontSize: 10,
                    position: "insideTopLeft",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="cumulative"
                  stroke="#22C55E"
                  strokeWidth={2}
                  fill="url(#imergCum)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      {lastTime && (
        <div className="text-center text-[10px] text-muted-foreground">
          Last IMERG pass: {fmtHour(lastTime)} · max rate:{" "}
          {data?.summary?.maxMm?.toFixed(1) ?? 0} mm · wet fraction:{" "}
          {Math.round((data?.summary?.wetFraction ?? 0) * 100)}%
        </div>
      )}
    </div>
  );
}

function StatusItem({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "ok" | "warn";
}) {
  const colorClass =
    tone === "ok"
      ? "text-emerald-400"
      : tone === "warn"
        ? "text-amber-400"
        : "text-foreground";
  return (
    <div className="rounded-md border border-border bg-card/40 p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`mt-0.5 text-sm font-semibold ${colorClass}`}>
        {value}
      </div>
    </div>
  );
}

function AccumulationCard({
  icon,
  label,
  mm,
  threshold,
  thresholdLabel,
}: {
  icon: React.ReactNode;
  label: string;
  mm: number;
  threshold: number;
  thresholdLabel: string;
}) {
  const pct = Math.min(100, (mm / threshold) * 100);
  const over = mm >= threshold;
  return (
    <Card className="gap-2 p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        <span className="uppercase tracking-wide">{label}</span>
      </div>
      <div
        className={`text-2xl font-bold ${over ? "text-destructive" : "text-foreground"}`}
      >
        {mm.toFixed(1)}
        <span className="text-sm text-muted-foreground"> mm</span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${over ? "bg-destructive" : "bg-emerald-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-[10px] text-muted-foreground">
        Threshold: {threshold} mm ({thresholdLabel})
      </div>
    </Card>
  );
}
