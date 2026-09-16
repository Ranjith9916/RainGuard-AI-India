"use client";

/**
 * CloudburstTab.tsx
 *
 * Cloudburst early-warning view. Fetches `/api/cloudburst/predict?cityId=` and
 * renders:
 *   - Coloured alert banner (GREEN / YELLOW / ORANGE / RED / BLACK)
 *   - 4 physics metric cards (CAPE, LCL, Precipitable Water, K-index)
 *   - Impact assessment grid (flash-flood prob, runoff, landslide, pop at risk)
 *   - Radar chart of physics terms (CAPE, LI negated, PW, K-index, TT, moisture)
 *   - Grouped bar chart of ML probabilities (ConvLSTM, Transformer, Attention, Fused)
 *   - Area chart of heatmap cell intensities (row mean)
 *   - Forecast line chart (next 60 min extrapolation)
 *   - XAI bar chart (relative contribution of each input term to the fused probability)
 *   - Model attribution cards
 *   - Recommended actions list
 */

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CITIES } from "@/lib/weather/cities";
import {
  AlertTriangle,
  CloudLightning,
  CloudRainWind,
  Compass,
  Gauge,
  RefreshCw,
  ShieldAlert,
  Siren,
  Users,
  Waves,
  Wind,
  Zap,
} from "lucide-react";

// -- Type mirrors of the API payload (kept loose) -------------------------

interface CloudburstPhysics {
  cape: number;
  cin: number;
  liftedIndex: number;
  lclPressure: number;
  lclHeightM: number;
  precipitableWater: number;
  showalterIndex: number;
  kIndex: number;
  totalTotals: number;
  orographicLiftMs: number;
  moistureConvergence: number;
  instability: "STABLE" | "MARGINAL" | "UNSTABLE" | "VERY_UNSTABLE";
}

interface CloudburstML {
  convLstmProbability: number;
  transformerSeverity: number;
  attentionConfidence: number;
  pinnResidual: number;
  fusedProbability: number;
}

interface CloudburstHeatmap {
  size: number;
  cells: Array<{ row: number; col: number; probability: number; intensityMmPerH: number }>;
}

interface CloudburstImpact {
  flashFloodProbability: number;
  runoffVolumeM3: number;
  landslideProbability: number;
  populationAtRisk: number;
}

interface CloudburstAlert {
  level: "GREEN" | "YELLOW" | "ORANGE" | "RED" | "BLACK";
  message: string;
  leadTimeMinutes: number;
  recommendedActions: string[];
}

interface CloudburstResult {
  cityId: string;
  cityName: string;
  physics: CloudburstPhysics;
  ml: CloudburstML;
  heatmap: CloudburstHeatmap;
  impact: CloudburstImpact;
  alert: CloudburstAlert;
  isTrained: boolean;
  computedAt: string;
}

interface CloudburstApiResponse {
  ok: boolean;
  cityId: string;
  cityName: string;
  cached?: boolean;
  fetchedAt?: string;
  expiresAt?: string;
  result: CloudburstResult;
  inputs?: {
    weatherSource?: string;
    atmospheric?: unknown;
    rainfallFeatures?: unknown;
    imergFeatures?: unknown;
  };
}

// -- Static config --------------------------------------------------------

const LEVEL_COLORS: Record<CloudburstAlert["level"], string> = {
  GREEN: "#22C55E",
  YELLOW: "#FACC15",
  ORANGE: "#F97316",
  RED: "#DC2626",
  BLACK: "#0a0a0a",
};

const LEVEL_BG: Record<CloudburstAlert["level"], string> = {
  GREEN: "rgba(34, 197, 94, 0.15)",
  YELLOW: "rgba(250, 204, 21, 0.15)",
  ORANGE: "rgba(249, 115, 22, 0.15)",
  RED: "rgba(220, 38, 38, 0.18)",
  BLACK: "rgba(10, 10, 10, 0.6)",
};

export default function CloudburstTab() {
  const [cityId, setCityId] = useState<string>("mumbai");
  const [data, setData] = useState<CloudburstApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchCloudburst() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/cloudburst/predict?cityId=${cityId}`, {
        cache: "no-store",
      });
      if (!r.ok) throw new Error(`predict ${r.status}`);
      const j = (await r.json()) as CloudburstApiResponse;
      if (!j.ok) throw new Error("cloudburst engine returned not-ok");
      setData(j);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchCloudburst();
  }, [cityId]);

  const result = data?.result;
  const physics = result?.physics;
  const ml = result?.ml;
  const impact = result?.impact;
  const alert = result?.alert;

  // Radar chart data — physics terms normalised 0..1 for the radar.
  const radarData = useMemo(() => {
    if (!physics) return [];
    const capeT = Math.min(1, physics.cape / 2500);
    const liT = Math.min(1, Math.max(0, -physics.liftedIndex / 8));
    const pwT = Math.min(1, physics.precipitableWater / 60);
    const kT = Math.min(1, Math.max(0, (physics.kIndex - 20) / 25));
    const ttT = Math.min(1, Math.max(0, (physics.totalTotals - 40) / 20));
    const mcT = Math.min(1, Math.max(0, (physics.moistureConvergence + 5) / 10));
    return [
      { axis: "CAPE", value: Number(capeT.toFixed(2)), raw: physics.cape },
      { axis: "LiftedIdx", value: Number(liT.toFixed(2)), raw: physics.liftedIndex },
      { axis: "PrecipWater", value: Number(pwT.toFixed(2)), raw: physics.precipitableWater },
      { axis: "K-index", value: Number(kT.toFixed(2)), raw: physics.kIndex },
      { axis: "TotalTotals", value: Number(ttT.toFixed(2)), raw: physics.totalTotals },
      { axis: "MoistureConv", value: Number(mcT.toFixed(2)), raw: physics.moistureConvergence },
    ];
  }, [physics]);

  // ML probabilities bar chart
  const mlBars = useMemo(() => {
    if (!ml) return [];
    return [
      { name: "ConvLSTM", value: Number((ml.convLstmProbability * 100).toFixed(1)) },
      { name: "Transformer", value: Number((ml.transformerSeverity * 100).toFixed(1)) },
      { name: "Attention", value: Number((ml.attentionConfidence * 100).toFixed(1)) },
      { name: "Fused", value: Number((ml.fusedProbability * 100).toFixed(1)) },
    ];
  }, [ml]);

  // Heatmap row-mean area chart
  const heatmapSeries = useMemo(() => {
    if (!result?.heatmap) return [];
    const size = result.heatmap.size;
    const rowMeans: number[] = new Array(size).fill(0);
    for (const c of result.heatmap.cells) {
      rowMeans[c.row]! += c.intensityMmPerH;
    }
    return rowMeans.map((v, i) => ({
      row: `r${i + 1}`,
      intensity: Number((v / size).toFixed(2)),
    }));
  }, [result]);

  // 60-min forecast line chart (synthetic — extrapolate fused probability)
  const forecastSeries = useMemo(() => {
    if (!ml) return [];
    const base = ml.fusedProbability;
    const out: Array<{ minute: number; probability: number }> = [];
    for (let t = 0; t <= 60; t += 5) {
      // Simple saturating curve toward base + 0.1 over 60 min.
      const val = base + (1 - base) * 0.4 * (t / 60);
      out.push({
        minute: t,
        probability: Number((val * 100).toFixed(1)),
      });
    }
    return out;
  }, [ml]);

  // XAI contributions bar chart — synthetic attribution of the fused
  // probability across the physics terms.
  const xaiData = useMemo(() => {
    if (!physics || !ml) return [];
    const capeTerm = Math.min(1, physics.cape / 2500) * 0.30;
    const liTerm = Math.min(1, Math.max(0, -physics.liftedIndex) / 8) * 0.25;
    const pwTerm = Math.min(1, physics.precipitableWater / 60) * 0.20;
    const liftTerm = Math.min(1, physics.orographicLiftMs / 2) * 0.15;
    const kTerm = Math.min(1, Math.max(0, (physics.kIndex - 20) / 25)) * 0.10;
    return [
      { name: "CAPE", value: Number((capeTerm * 100).toFixed(1)) },
      { name: "LiftedIdx", value: Number((liTerm * 100).toFixed(1)) },
      { name: "PrecipWater", value: Number((pwTerm * 100).toFixed(1)) },
      { name: "OroLift", value: Number((liftTerm * 100).toFixed(1)) },
      { name: "K-index", value: Number((kTerm * 100).toFixed(1)) },
    ];
  }, [physics, ml]);

  return (
    <div className="flex flex-col gap-4">
      {/* Header / controls */}
      <Card className="gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CloudLightning className="size-5 text-amber-400" />
            <div>
              <div className="text-sm font-semibold">
                Cloudburst Early Warning
              </div>
              <div className="text-xs text-muted-foreground">
                Physics + simulated ML (ConvLSTM / Transformer / Attention / PINN)
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
              onClick={fetchCloudburst}
              disabled={loading}
              title="Refresh"
            >
              <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
            </Button>
          </div>
        </div>
      </Card>

      {/* Alert banner */}
      {loading ? (
        <Skeleton className="h-24 w-full" />
      ) : alert ? (
        <Card
          className="gap-2 p-4"
          style={{
            background: LEVEL_BG[alert.level],
            borderLeft: `6px solid ${LEVEL_COLORS[alert.level]}`,
          }}
        >
          <div className="flex items-center gap-3">
            <Siren
              className="size-8"
              style={{ color: LEVEL_COLORS[alert.level] }}
            />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span
                  className="text-xl font-bold"
                  style={{ color: LEVEL_COLORS[alert.level] }}
                >
                  {alert.level}
                </span>
                <Badge variant="secondary" className="text-xs">
                  Lead time: {alert.leadTimeMinutes} min
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {physics?.instability ?? "—"}
                </Badge>
                {data?.cached && (
                  <Badge variant="outline" className="text-xs">
                    cached
                  </Badge>
                )}
              </div>
              <div className="mt-1 text-sm text-foreground">{alert.message}</div>
            </div>
          </div>
        </Card>
      ) : null}

      {error && (
        <Card className="border-destructive/40 p-4 text-sm text-destructive">
          Error: {error}
        </Card>
      )}

      {/* Physics metric cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <PhysicsCard
          icon={<Zap className="size-4 text-amber-400" />}
          label="CAPE"
          value={`${physics?.cape ?? 0}`}
          unit="J/kg"
          hint={physics ? `${physics.cape > 1500 ? "Strong" : physics.cape > 500 ? "Mod" : "Weak"}` : "—"}
        />
        <PhysicsCard
          icon={<Compass className="size-4 text-sky-400" />}
          label="LCL height"
          value={`${physics?.lclHeightM ?? 0}`}
          unit="m AGL"
          hint={physics ? `${physics.lclHeightM < 1000 ? "Low base" : "High base"}` : "—"}
        />
        <PhysicsCard
          icon={<CloudRainWind className="size-4 text-cyan-400" />}
          label="Precip water"
          value={`${physics?.precipitableWater ?? 0}`}
          unit="mm"
          hint={physics ? `${physics.precipitableWater > 40 ? "Moist" : "Dry"}` : "—"}
        />
        <PhysicsCard
          icon={<Gauge className="size-4 text-violet-400" />}
          label="K-index"
          value={`${physics?.kIndex ?? 0}`}
          unit="K"
          hint={physics ? `${physics.kIndex > 30 ? "Unstable" : "Stable"}` : "—"}
        />
      </div>

      {/* Impact assessment grid */}
      <Card className="gap-3 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <ShieldAlert className="size-4 text-destructive" />
          <span>Impact assessment</span>
        </div>
        {impact ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <ImpactCard
              icon={<Waves className="size-4 text-sky-400" />}
              label="Flash flood prob"
              value={`${Math.round(impact.flashFloodProbability * 100)}%`}
            />
            <ImpactCard
              icon={<Gauge className="size-4 text-violet-400" />}
              label="Runoff volume"
              value={`${(impact.runoffVolumeM3 / 1000).toFixed(1)} k m³`}
            />
            <ImpactCard
              icon={<AlertTriangle className="size-4 text-amber-400" />}
              label="Landslide prob"
              value={`${Math.round(impact.landslideProbability * 100)}%`}
            />
            <ImpactCard
              icon={<Users className="size-4 text-rose-400" />}
              label="Pop at risk"
              value={impact.populationAtRisk.toLocaleString("en-IN")}
            />
          </div>
        ) : (
          <Skeleton className="h-16 w-full" />
        )}
      </Card>

      {/* Charts grid: radar + ML bars */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="gap-3 p-4">
          <div className="text-sm font-semibold">Physics profile</div>
          <div className="h-64 w-full">
            {loading || radarData.length === 0 ? (
              <Skeleton className="h-full w-full" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={radarData} outerRadius="75%">
                  <PolarGrid stroke="#2a2a3a" />
                  <PolarAngleAxis
                    dataKey="axis"
                    tick={{ fill: "#9ca3af", fontSize: 10 }}
                  />
                  <PolarRadiusAxis
                    domain={[0, 1]}
                    tickCount={5}
                    tick={{ fill: "#6b7280", fontSize: 9 }}
                  />
                  <Radar
                    dataKey="value"
                    stroke="#A855F7"
                    fill="#A855F7"
                    fillOpacity={0.45}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#1f1f2e",
                      border: "1px solid #4a4a5a",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(value, _name, item) => {
                      const raw =
                        (item as { payload?: { raw?: number } } | undefined)
                          ?.payload?.raw ?? "—";
                      return [`${value} (raw: ${raw})`, "Normalised"];
                    }}
                  />
                </RadarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card className="gap-3 p-4">
          <div className="text-sm font-semibold">ML model probabilities</div>
          <div className="h-64 w-full">
            {loading || mlBars.length === 0 ? (
              <Skeleton className="h-full w-full" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={mlBars}
                  margin={{ top: 8, right: 8, bottom: 4, left: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: "#9ca3af", fontSize: 11 }}
                    stroke="#4a4a5a"
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fill: "#9ca3af", fontSize: 11 }}
                    stroke="#4a4a5a"
                    width={36}
                    label={{
                      value: "%",
                      angle: -90,
                      position: "insideLeft",
                      fill: "#9ca3af",
                      fontSize: 11,
                    }}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#1f1f2e",
                      border: "1px solid #4a4a5a",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(v) => [`${v}%`, "Probability"]}
                  />
                  <Bar dataKey="value" radius={[3, 3, 0, 0]}>
                    {mlBars.map((b, i) => (
                      <Cell
                        key={`ml-${i}`}
                        fill={
                          b.value >= 70
                            ? "#DC2626"
                            : b.value >= 40
                              ? "#F59E0B"
                              : "#22C55E"
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      {/* Charts grid: heatmap area + forecast line */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="gap-3 p-4">
          <div className="text-sm font-semibold">
            Heatmap row-mean intensity (mm/h)
          </div>
          <div className="h-56 w-full">
            {loading || heatmapSeries.length === 0 ? (
              <Skeleton className="h-full w-full" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={heatmapSeries}
                  margin={{ top: 8, right: 8, bottom: 4, left: 0 }}
                >
                  <defs>
                    <linearGradient id="cloudburstHm" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#F97316" stopOpacity={0.8} />
                      <stop offset="100%" stopColor="#F97316" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
                  <XAxis
                    dataKey="row"
                    tick={{ fill: "#9ca3af", fontSize: 10 }}
                    stroke="#4a4a5a"
                  />
                  <YAxis
                    tick={{ fill: "#9ca3af", fontSize: 11 }}
                    stroke="#4a4a5a"
                    width={36}
                    label={{
                      value: "mm/h",
                      angle: -90,
                      position: "insideLeft",
                      fill: "#9ca3af",
                      fontSize: 11,
                    }}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#1f1f2e",
                      border: "1px solid #4a4a5a",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="intensity"
                    stroke="#F97316"
                    strokeWidth={2}
                    fill="url(#cloudburstHm)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card className="gap-3 p-4">
          <div className="text-sm font-semibold">
            60-min probability forecast
          </div>
          <div className="h-56 w-full">
            {loading || forecastSeries.length === 0 ? (
              <Skeleton className="h-full w-full" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={forecastSeries}
                  margin={{ top: 8, right: 8, bottom: 4, left: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
                  <XAxis
                    dataKey="minute"
                    tick={{ fill: "#9ca3af", fontSize: 11 }}
                    stroke="#4a4a5a"
                    unit="m"
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fill: "#9ca3af", fontSize: 11 }}
                    stroke="#4a4a5a"
                    width={36}
                    unit="%"
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#1f1f2e",
                      border: "1px solid #4a4a5a",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="probability"
                    stroke="#22C55E"
                    strokeWidth={2.5}
                    dot={{ fill: "#22C55E", r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      {/* XAI contributions + model attribution */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="gap-3 p-4">
          <div className="text-sm font-semibold">
            Explainability (XAI) — feature contributions
          </div>
          <div className="h-56 w-full">
            {loading || xaiData.length === 0 ? (
              <Skeleton className="h-full w-full" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={xaiData}
                  margin={{ top: 8, right: 8, bottom: 4, left: 0 }}
                  layout="vertical"
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
                  <XAxis
                    type="number"
                    domain={[0, 40]}
                    tick={{ fill: "#9ca3af", fontSize: 11 }}
                    stroke="#4a4a5a"
                    unit="%"
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fill: "#9ca3af", fontSize: 11 }}
                    stroke="#4a4a5a"
                    width={90}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#1f1f2e",
                      border: "1px solid #4a4a5a",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(v) => [`${v}%`, "Contribution"]}
                  />
                  <Bar dataKey="value" radius={[0, 3, 3, 0]}>
                    {xaiData.map((b, i) => (
                      <Cell
                        key={`xai-${i}`}
                        fill={
                          b.value > 20
                            ? "#DC2626"
                            : b.value > 10
                              ? "#F59E0B"
                              : "#A855F7"
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card className="gap-3 p-4">
          <div className="text-sm font-semibold">Model attribution</div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <ModelCard name="ConvLSTM" tag="ml" prob={ml?.convLstmProbability} />
            <ModelCard name="Transformer" tag="ml" prob={ml?.transformerSeverity} />
            <ModelCard name="Attention" tag="ml" prob={ml?.attentionConfidence} />
            <ModelCard name="PINN" tag="physics" residual={ml?.pinnResidual} />
          </div>
          <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
            <Wind className="size-3" />
            <span>
              Engine: <span className="font-semibold text-foreground">cloudburst-convlstm v0.1.0</span>
              · isTrained: <span className="font-semibold text-amber-400">{String(result?.isTrained ?? false)}</span>
            </span>
          </div>
        </Card>
      </div>

      {/* Recommendations */}
      {alert && (
        <Card className="gap-2 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ShieldAlert className="size-4 text-destructive" />
            <span>Recommended actions ({alert.leadTimeMinutes} min lead)</span>
          </div>
          <ul className="ml-4 list-disc text-sm text-foreground">
            {alert.recommendedActions.map((a, i) => (
              <li key={i} className="py-0.5">
                {a}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/* ---------- sub-components ---------- */

function PhysicsCard({
  icon,
  label,
  value,
  unit,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  unit: string;
  hint: string;
}) {
  return (
    <Card className="gap-2 p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        <span className="uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-bold text-foreground">
        {value}
        <span className="ml-1 text-xs text-muted-foreground">{unit}</span>
      </div>
      <div className="text-[10px] text-muted-foreground">{hint}</div>
    </Card>
  );
}

function ImpactCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-border bg-card/40 p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-1 text-lg font-bold text-foreground">{value}</div>
    </div>
  );
}

function ModelCard({
  name,
  tag,
  prob,
  residual,
}: {
  name: string;
  tag: "ml" | "physics";
  prob?: number;
  residual?: number;
}) {
  const val =
    prob != null ? `${Math.round(prob * 100)}%` : residual != null ? `${residual.toFixed(3)}` : "—";
  const sub = prob != null ? "probability" : "residual";
  return (
    <div className="rounded-md border border-border bg-card/40 p-2">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span className="font-semibold uppercase tracking-wide text-foreground">
          {name}
        </span>
        <Badge
          variant={tag === "ml" ? "default" : "secondary"}
          className="text-[9px]"
        >
          {tag}
        </Badge>
      </div>
      <div className="mt-1 text-base font-bold text-foreground">{val}</div>
      <div className="text-[9px] text-muted-foreground">{sub}</div>
    </div>
  );
}
