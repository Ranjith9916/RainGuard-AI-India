"use client";

/**
 * RainfallTab.tsx
 *
 * Rainfall analysis view. Fetches `/api/weather/forecast?lat=&lon=&horizon=`
 * and reads the `hourly[].precipitationMm` field (the rainfall series).
 *
 * Renders:
 *   - Aggregation cards (1h, 3h, 6h, 24h totals vs IMD thresholds)
 *   - Bar chart with color-coded bars by severity (purple → green → amber
 *     → orange → red) and threshold reference lines for 1h heavy (25 mm)
 *   - Cumulative area chart with 24h threshold reference lines
 */

import { useCallback, useEffect, useMemo, useState } from "react";
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
  CloudRain,
  Gauge,
  RefreshCw,
  TrendingUp,
  Waves,
} from "lucide-react";

interface HourlyEntry {
  time: string;
  temperatureC?: number;
  precipitationMm?: number; // ← this is the rainfall field
  precipitationProbability?: number;
  humidityPercent?: number;
  windSpeedMs?: number;
  weatherCode?: number;
  cloudCoverPct?: number;
}

interface ForecastApiResponse {
  ok: boolean;
  requestedAt: string;
  horizonMinutes: number;
  weather: {
    source: string;
    latitude: number;
    longitude: number;
    timezone: string;
    fetchedAt: string;
    current: unknown;
    hourly: HourlyEntry[];
    forecast?: { daily: unknown[] };
  };
}

const SEVERITY_COLORS = {
  light: "#A855F7",
  normal: "#22C55E",
  heavy: "#F59E0B",
  veryHeavy: "#F97316",
  extreme: "#DC2626",
};

function severityOf(mm: number): keyof typeof SEVERITY_COLORS {
  if (mm < 2.5) return "light";
  if (mm < 10) return "normal";
  if (mm < 25) return "heavy";
  if (mm < 50) return "veryHeavy";
  return "extreme";
}

export default function RainfallTab() {
  const [cityId, setCityId] = useState<string>("mumbai");
  const [data, setData] = useState<ForecastApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const city = CITIES.find((c) => c.id === cityId);

  const fetchForecast = useCallback(async () => {
    if (!city) return;
    setLoading(true);
    setError(null);
    try {
      const url = `/api/weather/forecast?lat=${city.latitude}&lon=${city.longitude}&horizon=360`;
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) throw new Error(`forecast ${r.status}`);
      const j = (await r.json()) as ForecastApiResponse;
      if (!j.ok) throw new Error("forecast returned not-ok");
      setData(j);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [city]);

  useEffect(() => {
    fetchForecast();
  }, [fetchForecast]);

  const hourly = data?.weather?.hourly ?? [];

  // Series for bar chart — each entry is the rainfall mm for that hour.
  const series = useMemo(() => {
    return hourly.map((h) => ({
      time: h.time,
      mm: h.precipitationMm ?? 0,
      pop: Math.round(h.precipitationProbability ?? 0),
      severity: severityOf(h.precipitationMm ?? 0),
    }));
  }, [hourly]);

  // Cumulative series for the area chart.
  const cumulative = useMemo(() => {
    let acc = 0;
    return series.map((s) => {
      acc += s.mm;
      return { time: s.time, cumulative: Number(acc.toFixed(2)) };
    });
  }, [series]);

  // Aggregations — sum the first N hours of the forecast (upcoming rainfall)
  const aggregations = useMemo(() => {
    if (series.length === 0) return { "1h": 0, "3h": 0, "6h": 0, "24h": 0 };
    return {
      "1h": Number((series[0]?.mm ?? 0).toFixed(2)),
      "3h": Number(series.slice(0, 3).reduce((a, s) => a + s.mm, 0).toFixed(2)),
      "6h": Number(series.slice(0, 6).reduce((a, s) => a + s.mm, 0).toFixed(2)),
      "24h": Number(series.slice(0, 24).reduce((a, s) => a + s.mm, 0).toFixed(2)),
    };
  }, [series]);

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
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
      {/* Controls */}
      <Card className="gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CloudRain className="size-5 text-sky-400" />
            <div>
              <div className="text-sm font-semibold">Rainfall analysis</div>
              <div className="text-xs text-muted-forecast">
                Hourly rainfall series from the unified weather provider
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select value={cityId} onValueChange={setCityId}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
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
              onClick={fetchForecast}
              disabled={loading}
              title="Refresh"
            >
              <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
            </Button>
          </div>
        </div>
      </Card>

      {error && (
        <Card className="border-destructive/40 p-4 text-sm text-destructive">
          Error: {error}
        </Card>
      )}

      {/* Aggregation cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <AggregationCard
          icon={<Waves className="size-4 text-sky-400" />}
          label="1h total"
          mm={aggregations["1h"]!}
          threshold={RAINFALL_THRESHOLDS.heavy1h}
          thresholdLabel="heavy 1h"
        />
        <AggregationCard
          icon={<Waves className="size-4 text-sky-400" />}
          label="3h total"
          mm={aggregations["3h"]!}
          threshold={RAINFALL_THRESHOLDS.heavy1h * 3}
          thresholdLabel="heavy 3h"
        />
        <AggregationCard
          icon={<Waves className="size-4 text-sky-400" />}
          label="6h total"
          mm={aggregations["6h"]!}
          threshold={RAINFALL_THRESHOLDS.heavy24h / 4}
          thresholdLabel="heavy 6h"
        />
        <AggregationCard
          icon={<Waves className="size-4 text-sky-400" />}
          label="24h total"
          mm={aggregations["24h"]!}
          threshold={RAINFALL_THRESHOLDS.heavy24h}
          thresholdLabel="heavy 24h"
        />
      </div>

      {/* Bar chart */}
      <Card className="gap-3 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <TrendingUp className="size-4 text-sky-400" />
            <span>Hourly rainfall (mm)</span>
          </div>
          <Badge variant="secondary" className="text-xs">
            {series.length} hours · source {data?.weather?.source ?? "—"}
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
                  tickFormatter={(t: string, i: number) =>
                    i % 3 === 0 ? fmtTime(t) : ""
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
                  width={40}
                />
                <Tooltip
                  contentStyle={{
                    background: "#1f1f2e",
                    border: "1px solid #4a4a5a",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelFormatter={(l) => fmtHour(String(l))}
                  formatter={(v, n) =>
                    n === "pop"
                      ? [`${v}%`, "Precip prob"]
                      : [`${v} mm`, "Rainfall"]
                  }
                />
                <ReferenceLine
                  y={RAINFALL_THRESHOLDS.heavy1h}
                  stroke="#F59E0B"
                  strokeDasharray="4 4"
                  label={{
                    value: `Heavy 1h (${RAINFALL_THRESHOLDS.heavy1h} mm)`,
                    fill: "#F59E0B",
                    fontSize: 10,
                    position: "insideTopRight",
                  }}
                />
                <Bar dataKey="mm" name="mm" radius={[2, 2, 0, 0]}>
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
            <span>Cumulative rainfall</span>
          </div>
          <Badge variant="secondary" className="text-xs">
            Total: {cumulative[cumulative.length - 1]?.cumulative?.toFixed(1) ?? 0} mm
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
                  <linearGradient id="rainCum" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22C55E" stopOpacity={0.8} />
                    <stop offset="100%" stopColor="#22C55E" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
                <XAxis
                  dataKey="time"
                  tickFormatter={(t: string, i: number) =>
                    i % 3 === 0 ? fmtTime(t) : ""
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
                  width={40}
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
                    value: `Heavy 24h (${RAINFALL_THRESHOLDS.heavy24h} mm)`,
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
                    value: `Very heavy (${RAINFALL_THRESHOLDS.veryHeavy24h} mm)`,
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
                  fill="url(#rainCum)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>
    </div>
  );
}

function AggregationCard({
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
