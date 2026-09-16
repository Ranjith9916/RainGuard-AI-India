"use client";

/**
 * PipelineTab.tsx
 *
 * Pipeline monitoring view. Fetches:
 *   - GET /api/pipeline/runs   — run history list
 *   - GET /api/system/status   — provider snapshot
 * Triggers a fresh pipeline run via POST /api/pipeline/runs and shows
 * the latest run summary.
 */

import { useCallback, useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Activity,
  Clock,
  Database,
  Play,
  RefreshCw,
  Server,
  Timer,
  Workflow,
} from "lucide-react";

interface PipelineRun {
  id: string;
  pipelineName: string;
  status: string;
  source: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  recordsReceived: number;
  recordsValid: number;
  recordsRejected: number;
  errorMessage?: string | null;
}

interface RunsApiResponse {
  ok: boolean;
  total: number;
  count: number;
  runs: PipelineRun[];
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
    radar: { type: string; enabled: boolean };
    nwp: { type: string; enabled: boolean; model: string };
  };
  lastPipelineRun: PipelineRun | null;
  models: { registeredCount: number };
}

interface PostRunResponse {
  ok: boolean;
  pipelineRunId: string | null;
  pipelineName: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  citiesProcessed?: number;
  citiesSucceeded?: number;
  citiesFailed?: number;
  alertsEmitted?: number;
  error?: string;
}

const STATUS_TONE: Record<string, string> = {
  succeeded: "#22C55E",
  running: "#3B82F6",
  failed: "#DC2626",
  partial: "#F59E0B",
};

export default function PipelineTab() {
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [status, setStatus] = useState<SystemStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [lastRunSummary, setLastRunSummary] = useState<PostRunResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r, s] = await Promise.all([
        fetch("/api/pipeline/runs?limit=20", { cache: "no-store" }),
        fetch("/api/system/status", { cache: "no-store" }),
      ]);
      if (!r.ok) throw new Error(`runs ${r.status}`);
      if (!s.ok) throw new Error(`status ${s.status}`);
      const rj = (await r.json()) as RunsApiResponse;
      const sj = (await s.json()) as SystemStatusResponse;
      setRuns(rj.runs);
      setStatus(sj);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  async function triggerRun() {
    setTriggering(true);
    try {
      const r = await fetch("/api/pipeline/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pipelineName: "weather-cities-pipeline",
          source: "ui",
          persist: true,
        }),
      });
      const j = (await r.json()) as PostRunResponse;
      setLastRunSummary(j);
      if (j.ok) {
        toast({
          title: "Pipeline complete",
          description: `${j.citiesSucceeded ?? 0} succeeded / ${j.citiesFailed ?? 0} failed · ${j.alertsEmitted ?? 0} alerts`,
        });
      } else {
        toast({
          title: "Pipeline failed",
          description: j.error ?? "unknown error",
          variant: "destructive",
        });
      }
      fetchAll();
    } catch (err) {
      toast({
        title: "Pipeline trigger failed",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setTriggering(false);
    }
  }

  // Build a duration series for the run-history line chart.
  const durationSeries = runs
    .slice(0, 12)
    .reverse()
    .map((r) => ({
      label: new Date(r.startedAt).toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      duration: Math.round((r.durationMs ?? 0) / 1000),
      valid: r.recordsValid,
      rejected: r.recordsRejected,
    }));

  return (
    <div className="flex flex-col gap-4">
      {/* Trigger bar */}
      <Card className="gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Workflow className="size-5 text-sky-400" />
            <div>
              <div className="text-sm font-semibold">Pipeline monitoring</div>
              <div className="text-xs text-muted-foreground">
                {runs.length} runs in DB · last status:{" "}
                <span
                  style={{
                    color: STATUS_TONE[status?.lastPipelineRun?.status ?? ""] ?? "#9ca3af",
                  }}
                >
                  {status?.lastPipelineRun?.status ?? "—"}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={triggerRun} disabled={triggering}>
              {triggering ? (
                <RefreshCw className="size-4 animate-spin" />
              ) : (
                <Play className="size-4" />
              )}
              {triggering ? "Running..." : "Trigger pipeline run"}
            </Button>
            <Button variant="outline" size="icon" onClick={fetchAll} disabled={loading} title="Refresh">
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

      {/* Last run summary */}
      {lastRunSummary && (
        <Card className="gap-2 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Activity className="size-4 text-emerald-400" />
            <span>Last run summary</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
            <SummaryTile label="Status" value={lastRunSummary.ok ? "ok" : "fail"} />
            <SummaryTile label="Processed" value={String(lastRunSummary.citiesProcessed ?? 0)} />
            <SummaryTile label="Succeeded" value={String(lastRunSummary.citiesSucceeded ?? 0)} />
            <SummaryTile label="Failed" value={String(lastRunSummary.citiesFailed ?? 0)} />
            <SummaryTile label="Alerts" value={String(lastRunSummary.alertsEmitted ?? 0)} />
          </div>
        </Card>
      )}

      {/* Data source status */}
      <Card className="gap-2 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Server className="size-4 text-violet-400" />
          <span>Data source status</span>
        </div>
        {loading || !status ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <ProviderCard
              label="Weather"
              type={status.providers.weather.type}
              enabled={status.providers.weather.enabled}
              extra={`key: ${status.providers.weather.apiKeyConfigured ? "OK" : "missing"}`}
            />
            <ProviderCard
              label="Satellite"
              type={status.providers.satellite.type}
              enabled={status.providers.satellite.enabled}
              extra={`earthdata: ${status.providers.satellite.earthdataConfigured ? "OK" : "missing"}`}
            />
            <ProviderCard
              label="Radar"
              type={status.providers.radar.type}
              enabled={status.providers.radar.enabled}
              extra="open-meteo"
            />
            <ProviderCard
              label="NWP"
              type={status.providers.nwp.type}
              enabled={status.providers.nwp.enabled}
              extra={status.providers.nwp.model}
            />
          </div>
        )}
        {status && (
          <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
            <div className="flex items-center gap-1">
              <Database className="size-3" />
              <span>
                DB: <span className={status.db.healthy ? "text-emerald-400" : "text-destructive"}>{status.db.healthy ? "healthy" : "degraded"}</span>
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Activity className="size-3" />
              <span>Active alerts: {status.db.activeAlertCount}</span>
            </div>
            <div className="flex items-center gap-1">
              <Clock className="size-3" />
              <span>{status.system.timezone}</span>
            </div>
          </div>
        )}
      </Card>

      {/* Duration line chart */}
      <Card className="gap-3 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Timer className="size-4 text-sky-400" />
            <span>Recent run durations</span>
          </div>
          <Badge variant="secondary" className="text-xs">
            Last {durationSeries.length} runs
          </Badge>
        </div>
        <div className="h-56 w-full">
          {loading || durationSeries.length === 0 ? (
            <Skeleton className="h-full w-full" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={durationSeries}
                margin={{ top: 8, right: 8, bottom: 4, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "#9ca3af", fontSize: 10 }}
                  stroke="#4a4a5a"
                />
                <YAxis
                  label={{
                    value: "s",
                    angle: -90,
                    position: "insideLeft",
                    fill: "#9ca3af",
                    fontSize: 11,
                  }}
                  tick={{ fill: "#9ca3af", fontSize: 11 }}
                  stroke="#4a4a5a"
                  width={36}
                />
                <Tooltip
                  contentStyle={{
                    background: "#1f1f2e",
                    border: "1px solid #4a4a5a",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(v, n) => [
                    n === "duration" ? `${v} s` : `${v}`,
                    n === "duration" ? "Duration" : n,
                  ]}
                />
                <Line
                  type="monotone"
                  dataKey="duration"
                  stroke="#3B82F6"
                  strokeWidth={2}
                  dot={{ fill: "#3B82F6", r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      {/* Run history table */}
      <Card className="gap-2 p-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Run history</div>
          <Badge variant="secondary" className="text-xs">
            Latest {runs.length} runs
          </Badge>
        </div>
        <div className="rainguard-scrollbar max-h-[360px] overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-card text-[10px] uppercase text-muted-foreground">
              <tr>
                <th className="px-2 py-1">Status</th>
                <th className="px-2 py-1">Started</th>
                <th className="px-2 py-1">Duration</th>
                <th className="px-2 py-1">Valid</th>
                <th className="px-2 py-1">Failed</th>
                <th className="px-2 py-1">Source</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-2 py-2 text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              ) : runs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-2 py-2 text-muted-foreground">
                    No runs yet — click "Trigger pipeline run".
                  </td>
                </tr>
              ) : (
                runs.map((r) => {
                  const tone = STATUS_TONE[r.status] ?? "#9ca3af";
                  return (
                    <tr
                      key={r.id}
                      className="border-t border-border hover:bg-accent/30"
                    >
                      <td className="px-2 py-1">
                        <span
                          className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                          style={{
                            color: tone,
                            background: `${tone}22`,
                            border: `1px solid ${tone}`,
                          }}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="px-2 py-1 text-muted-foreground">
                        {new Date(r.startedAt).toLocaleString("en-IN", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </td>
                      <td className="px-2 py-1">
                        {r.durationMs != null
                          ? `${(r.durationMs / 1000).toFixed(1)}s`
                          : "—"}
                      </td>
                      <td className="px-2 py-1 text-emerald-400">
                        {r.recordsValid}
                      </td>
                      <td className="px-2 py-1 text-destructive">
                        {r.recordsRejected}
                      </td>
                      <td className="px-2 py-1 text-muted-foreground">
                        {r.source ?? "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card/40 p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-base font-bold text-foreground">{value}</div>
    </div>
  );
}

function ProviderCard({
  label,
  type,
  enabled,
  extra,
}: {
  label: string;
  type: string;
  enabled: boolean;
  extra: string;
}) {
  return (
    <div className="rounded-md border border-border bg-card/40 p-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span
          className={`text-[10px] font-semibold ${enabled ? "text-emerald-400" : "text-destructive"}`}
        >
          {enabled ? "on" : "off"}
        </span>
      </div>
      <div className="mt-0.5 text-sm font-semibold text-foreground">{type}</div>
      <div className="text-[10px] text-muted-foreground">{extra}</div>
    </div>
  );
}
