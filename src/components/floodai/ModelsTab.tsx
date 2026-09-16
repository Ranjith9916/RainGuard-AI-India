"use client";

/**
 * ModelsTab.tsx
 *
 * ML model registry view. Fetches `/api/models` and `/api/models/training-metrics`
 * and renders:
 *   - Per-model metric cards (with isBaseline / isTrainedOnLabels badges)
 *   - Training history line chart (synthesised from the latest metric + a
 *     monotonic improvement curve — the API only exposes the latest value)
 *   - Baseline models list with their type / version / description
 */

import { useEffect, useMemo, useState } from "react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Brain, Cpu, Gauge, History, LineChart as LineIcon } from "lucide-react";

interface ModelEntry {
  key: string;
  name: string;
  version: string;
  type: "baseline" | "ml" | "onnx";
  artifactPath?: string;
  isBaseline: boolean;
  isTrainedOnLabels: boolean;
  description: string;
  source?: string;
  trainedAt?: string;
  notes?: string;
}

interface MetricEntry {
  metricName: string;
  metricValue: number;
  split: string;
  evaluatedAt?: string;
  notes?: string;
  source: string;
}

interface ByModelEntry extends ModelEntry {
  metricCount: number;
  metrics: MetricEntry[];
}

interface ModelsApiResponse {
  ok: boolean;
  count: number;
  models: ModelEntry[];
}

interface MetricsApiResponse {
  ok: boolean;
  count: number;
  byModel: ByModelEntry[];
  filters: { modelName: string; split: string };
}

const TYPE_COLOR: Record<ModelEntry["type"], string> = {
  baseline: "#22C55E",
  ml: "#3B82F6",
  onnx: "#A855F7",
};

export default function ModelsTab() {
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [metrics, setMetrics] = useState<ByModelEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [m, t] = await Promise.all([
          fetch("/api/models", { cache: "no-store" }),
          fetch("/api/models/training-metrics", { cache: "no-store" }),
        ]);
        if (!m.ok) throw new Error(`models ${m.status}`);
        if (!t.ok) throw new Error(`metrics ${t.status}`);
        const mj = (await m.json()) as ModelsApiResponse;
        const tj = (await t.json()) as MetricsApiResponse;
        setModels(mj.models);
        setMetrics(tj.byModel);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Synthesised training history for the line chart — for each model, take
  // the primary metric and generate a 10-epoch monotonic improvement curve
  // toward the current value. This is for visualisation only; the actual
  // training history table isn't persisted in the baseline build.
  const trainingHistory = useMemo(() => {
    if (metrics.length === 0) return [];
    // For each model, pick the most informative metric.
    const primaryMetricOf = (m: ByModelEntry): MetricEntry | undefined => {
      const order = [
        "accuracy",
        "f1",
        "auc_roc",
        "iou",
        "pod",
        "csi",
        "rmse_mm",
        "rmse_depth_m",
        "mae_mm",
      ];
      for (const name of order) {
        const found = m.metrics.find((x) => x.metricName === name);
        if (found) return found;
      }
      return m.metrics[0];
    };

    const series: Array<{
      epoch: number;
      [modelName: string]: number | string;
    }> = [];
    for (let e = 1; e <= 10; e++) series.push({ epoch: e });

    metrics.forEach((m) => {
      const metric = primaryMetricOf(m);
      if (!metric) return;
      // Decide whether higher is better (default) or lower.
      const lowerBetter =
        metric.metricName.startsWith("rmse") ||
        metric.metricName.startsWith("mae") ||
        metric.metricName.startsWith("brier") ||
        metric.metricName.startsWith("far") ||
        metric.metricName.startsWith("log_loss") ||
        metric.metricName.startsWith("bias");
      const target = metric.metricValue;
      const start = lowerBetter ? target * 1.6 : target * 0.4;
      series.forEach((s) => {
        const frac = s.epoch / 10;
        const val = lowerBetter
          ? start - (start - target) * frac
          : start + (target - start) * frac;
        s[m.key] = Number(val.toFixed(3));
      });
    });

    return series;
  }, [metrics]);

  const baselineModels = models.filter((m) => m.isBaseline);
  const trainedModels = models.filter((m) => !m.isBaseline);

  return (
    <div className="flex flex-col gap-4">
      <Card className="gap-3 p-4">
        <div className="flex items-center gap-2">
          <Brain className="size-5 text-violet-400" />
          <div>
            <div className="text-sm font-semibold">ML model registry</div>
            <div className="text-xs text-muted-foreground">
              {models.length} models · {baselineModels.length} baselines ·{" "}
              {trainedModels.length} trained
            </div>
          </div>
        </div>
      </Card>

      {error && (
        <Card className="border-destructive/40 p-4 text-sm text-destructive">
          Error: {error}
        </Card>
      )}

      {/* Per-model metric cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))
        ) : (
          metrics.map((m) => {
            const color = TYPE_COLOR[m.type];
            return (
              <Card key={m.key} className="gap-2 p-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-foreground">
                    {m.name}
                  </div>
                  <Badge
                    variant="outline"
                    className="text-[10px]"
                    style={{ borderColor: color, color }}
                  >
                    {m.type}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-1 text-[10px] text-muted-foreground">
                  <span>v{m.version}</span>
                  {m.isBaseline && (
                    <Badge variant="secondary" className="text-[9px]">
                      baseline
                    </Badge>
                  )}
                  {m.isTrainedOnLabels ? (
                    <Badge variant="default" className="text-[9px]">
                      trained
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[9px]">
                      untrained
                    </Badge>
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {m.description}
                </div>

                <div className="mt-1 grid grid-cols-2 gap-1 text-[10px]">
                  {m.metrics.slice(0, 4).map((metric, i) => (
                    <div
                      key={i}
                      className="rounded border border-border bg-card/40 px-1.5 py-0.5"
                    >
                      <div className="text-[9px] uppercase text-muted-foreground">
                        {metric.metricName}
                      </div>
                      <div className="font-semibold text-foreground">
                        {metric.metricValue.toFixed(3)}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })
        )}
      </div>

      {/* Training history */}
      <Card className="gap-3 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <History className="size-4 text-violet-400" />
            <span>Training history (synthesised)</span>
          </div>
          <Badge variant="outline" className="text-xs">
            10 epochs
          </Badge>
        </div>
        <div className="text-[10px] text-muted-foreground">
          The baseline build does not persist per-epoch metrics — the curves
          below show a monotonic improvement from a hypothetical starting point
          toward the latest persisted metric.
        </div>
        <div className="h-72 w-full">
          {loading || trainingHistory.length === 0 ? (
            <Skeleton className="h-full w-full" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={trainingHistory}
                margin={{ top: 8, right: 8, bottom: 4, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
                <XAxis
                  dataKey="epoch"
                  tick={{ fill: "#9ca3af", fontSize: 11 }}
                  stroke="#4a4a5a"
                  unit="e"
                />
                <YAxis
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
                />
                {metrics.map((m, i) => {
                  const color = TYPE_COLOR[m.type];
                  return (
                    <Line
                      key={m.key}
                      type="monotone"
                      dataKey={m.key}
                      name={m.name}
                      stroke={color}
                      strokeWidth={2}
                      dot={{ fill: color, r: 2 }}
                      // Vary dash pattern so overlapping curves are visible.
                      strokeDasharray={i % 2 === 0 ? undefined : "4 2"}
                    />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="flex flex-wrap gap-3 text-[10px]">
          {metrics.map((m) => (
            <div key={m.key} className="flex items-center gap-1.5">
              <span
                className="inline-block size-2.5 rounded-sm"
                style={{ background: TYPE_COLOR[m.type] }}
              />
              <span className="text-muted-foreground">{m.name}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Baseline models list */}
      <Card className="gap-2 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Cpu className="size-4 text-emerald-400" />
          <span>Baseline models</span>
        </div>
        <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
          {baselineModels.map((m) => (
            <div
              key={m.key}
              className="rounded-md border border-border bg-card/40 p-2"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-foreground">{m.name}</span>
                <Badge variant="secondary" className="text-[9px]">
                  v{m.version}
                </Badge>
              </div>
              <div className="text-[10px] text-muted-foreground">
                {m.description}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Trained models list */}
      {trainedModels.length > 0 && (
        <Card className="gap-2 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Gauge className="size-4 text-amber-400" />
            <span>Trained models</span>
          </div>
          <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
            {trainedModels.map((m) => (
              <div
                key={m.key}
                className="rounded-md border border-border bg-card/40 p-2"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground">{m.name}</span>
                  <Badge variant="default" className="text-[9px]">
                    {m.type}
                  </Badge>
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {m.description}
                </div>
                {m.artifactPath && (
                  <div className="mt-1 flex items-center gap-1 text-[9px] text-muted-foreground">
                    <LineIcon className="size-3" />
                    <span className="font-mono">{m.artifactPath}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
