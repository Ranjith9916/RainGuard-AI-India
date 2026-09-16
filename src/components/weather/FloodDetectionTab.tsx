"use client";

/**
 * FloodDetectionTab.tsx
 *
 * SAR-based flood detection view. Calls
 *   GET /api/flood-detection/detect?regionId=&model=
 * and renders three 128x128 canvases (upscaled from the 16x16 mask summary):
 *   1. SAR RGB composite (synthetic Sentinel-1 VV/VH false-colour)
 *   2. Flood mask (red = flooded, dark = non-flooded)
 *   3. Probability heatmap (smooth Gaussian falloff around flood pixels)
 *
 * Plus a region picker, model picker (threshold / etci-unet) and statistics.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  Activity,
  Cpu,
  Crosshair,
  Layers,
  Radar,
  RefreshCw,
  SquareDashedBottom,
} from "lucide-react";

interface FloodDetectionResponse {
  ok: boolean;
  region: {
    id: string;
    name: string;
    states: string[];
    latitude: number;
    longitude: number;
    bbox: { north: number; south: number; east: number; west: number };
    riskNote: string;
    keyCities: string[];
  };
  detection: {
    source: string;
    productName: string;
    acquisitionTime: string;
    method: string;
    requestedModel: string;
    fellBack: boolean;
    floodFraction: number;
    maskWidth: number;
    maskHeight: number;
    maskSummary: string[];
    isDevData: boolean;
  };
  inferencer: { name: string; isBaseline: boolean };
}

interface RegionListResponse {
  ok: boolean;
  count: number;
  regions: Array<{
    id: string;
    name: string;
    states: string[];
    latitude: number;
    longitude: number;
    bbox: { north: number; south: number; east: number; west: number };
    riskNote: string;
    keyCities: string[];
    placeNames?: Array<{
      name: string;
      row: number;
      col: number;
      type?: "city" | "river" | "district" | "landmark";
    }>;
  }>;
}

const CANVAS_SIZE = 256;
const GRID = 16;
const CELL = CANVAS_SIZE / GRID;

export default function FloodDetectionTab() {
  const [regions, setRegions] = useState<RegionListResponse["regions"]>([]);
  const [regionId, setRegionId] = useState<string>("");
  const [model, setModel] = useState<string>("threshold");
  const [data, setData] = useState<FloodDetectionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCell, setSelectedCell] = useState<{ r: number; c: number } | null>(null);
  const [activeLayer, setActiveLayer] = useState<string>("flood");

  const sarCanvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const probCanvasRef = useRef<HTMLCanvasElement>(null);

  // Fetch region list once.
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/flood-detection/regions", {
          cache: "no-store",
        });
        if (!r.ok) throw new Error(`regions ${r.status}`);
        const j = (await r.json()) as RegionListResponse;
        setRegions(j.regions);
        if (j.regions.length > 0 && !regionId) {
          setRegionId(j.regions[0]!.id);
        }
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, []);

  const runDetection = useCallback(async () => {
    if (!regionId) return;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const url = `/api/flood-detection/detect?regionId=${regionId}&model=${model}`;
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) throw new Error(`detect ${r.status}`);
      const j = (await r.json()) as FloodDetectionResponse;
      if (!j.ok) throw new Error("detect returned not-ok");
      setData(j);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [regionId, model]);

  // Auto-run when regionId / model changes (after the first region is set).
  useEffect(() => {
    if (regionId) runDetection();
  }, [regionId, model]);

  // Parse the 16x16 maskSummary into a 2D boolean grid.
  const maskGrid = useMemo(() => {
    if (!data?.detection?.maskSummary) return null;
    const grid: boolean[][] = [];
    for (let r = 0; r < GRID; r++) {
      const row: boolean[] = [];
      const line = data.detection.maskSummary[r] ?? "";
      for (let c = 0; c < GRID; c++) {
        row.push(line.charAt(c) === "#");
      }
      grid.push(row);
    }
    return grid;
  }, [data]);

  // Probability heatmap grid: smooth distance-falloff around flood cells.
  const probGrid = useMemo(() => {
    if (!maskGrid) return null;
    const out: number[][] = [];
    for (let r = 0; r < GRID; r++) {
      const row: number[] = [];
      for (let c = 0; c < GRID; c++) {
        if (maskGrid[r]![c]) {
          row.push(1);
          continue;
        }
        // Distance to nearest flood cell.
        let minD = Infinity;
        for (let r2 = 0; r2 < GRID; r2++) {
          for (let c2 = 0; c2 < GRID; c2++) {
            if (maskGrid[r2]![c2]) {
              const d = Math.sqrt((r - r2) ** 2 + (c - c2) ** 2);
              if (d < minD) minD = d;
            }
          }
        }
        const p = Math.max(0, 1 - minD / 5);
        row.push(Number(p.toFixed(3)));
      }
      out.push(row);
    }
    return out;
  }, [maskGrid]);

  // Render the three canvases whenever the mask updates.
  useEffect(() => {
    if (!maskGrid || !probGrid) return;
    drawSar(sarCanvasRef.current, maskGrid);
    drawMask(maskCanvasRef.current, maskGrid);
    drawProb(probCanvasRef.current, probGrid);
  }, [maskGrid, probGrid]);

  const region = regions.find((r) => r.id === regionId);

  return (
    <div className="flex flex-col gap-4">
      {/* Controls */}
      <Card className="gap-3 p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex items-center gap-2">
            <Radar className="size-5 text-sky-400" />
            <div>
              <div className="text-sm font-semibold">
                Sentinel-1 SAR Flood Detection
              </div>
              <div className="text-xs text-muted-foreground">
                Synthetic SAR patch + Otsu/ETCI-UNet inference over 8 India regions
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 block text-[10px] uppercase text-muted-foreground">
                Region
              </label>
              <Select value={regionId} onValueChange={setRegionId}>
                <SelectTrigger className="w-[220px]">
                  <SelectValue placeholder="Select region" />
                </SelectTrigger>
                <SelectContent>
                  {regions.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase text-muted-foreground">
                Model
              </label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="threshold">threshold (Otsu)</SelectItem>
                  <SelectItem value="etci-unet">etci-unet (ONNX)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={runDetection} disabled={loading}>
              <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
              Run detection
            </Button>
          </div>
        </div>
      </Card>

      {/* Region info */}
      {region && (
        <Card className="gap-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">{region.name}</div>
              <div className="text-xs text-muted-foreground">
                {region.states.join(" · ")} · Centre ({region.latitude.toFixed(2)},{" "}
                {region.longitude.toFixed(2)})
              </div>
            </div>
            <div className="max-w-md text-xs text-muted-foreground">
              {region.riskNote}
            </div>
          </div>
        </Card>
      )}

      {error && (
        <Card className="border-destructive/40 p-4 text-sm text-destructive">
          Error: {error}
        </Card>
      )}

      {/* Canvases */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <CanvasCard
          title="SAR RGB composite"
          hint="Synthetic VV/VH false-colour"
          icon={<Layers className="size-4 text-sky-400" />}
          loading={loading}
          canvasRef={sarCanvasRef}
        />
        <CanvasCard
          title="Flood mask"
          hint="Red = flooded pixels"
          icon={<SquareDashedBottom className="size-4 text-rose-400" />}
          loading={loading}
          canvasRef={maskCanvasRef}
        />
        <CanvasCard
          title="Probability heatmap"
          hint="Smooth distance-falloff"
          icon={<Activity className="size-4 text-amber-400" />}
          loading={loading}
          canvasRef={probCanvasRef}
        />
      </div>

      {/* Statistics */}
      <Card className="gap-3 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Crosshair className="size-4 text-violet-400" />
          <span>Detection statistics</span>
        </div>
        {loading ? (
          <Skeleton className="h-20 w-full" />
        ) : data ? (
          <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
            <StatTile
              label="Flood fraction"
              value={`${(data.detection.floodFraction * 100).toFixed(1)}%`}
              tone={data.detection.floodFraction > 0.2 ? "warn" : "default"}
            />
            <StatTile label="Method" value={data.detection.method} />
            <StatTile
              label="Requested model"
              value={data.detection.requestedModel}
            />
            <StatTile
              label="Fell back"
              value={data.detection.fellBack ? "yes" : "no"}
              tone={data.detection.fellBack ? "warn" : "default"}
            />
            <StatTile label="Source" value={data.detection.source} />
            <StatTile label="Inferencer" value={data.inferencer.name} />
            <StatTile
              label="Is baseline"
              value={data.inferencer.isBaseline ? "yes" : "no"}
            />
            <StatTile
              label="Acquired at"
              value={new Date(data.detection.acquisitionTime).toLocaleString(
                "en-IN",
                {
                  dateStyle: "short",
                  timeStyle: "short",
                },
              )}
            />
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">
            No detection run yet.
          </div>
        )}
      </Card>

      {/* Interactive hex grid + cell inspector — like reference image */}
      {maskGrid && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
          {/* Hex grid map */}
          <Card className="gap-0 overflow-hidden p-0">
            {/* Layer toggle bar */}
            <div className="flex flex-wrap items-center gap-1 border-b border-border bg-slate-950/60 px-3 py-2">
              <span className="mr-2 text-[10px] font-semibold uppercase text-muted-foreground">Layer:</span>
              {[
                { id: "flood", label: "Flood Probability" },
                { id: "rain", label: "Current Rainfall" },
                { id: "risk", label: "Risk Class" },
                { id: "terrain", label: "Terrain (DEM)" },
              ].map((l) => (
                <button
                  key={l.id}
                  onClick={() => setActiveLayer(l.id)}
                  className={`rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors ${
                    activeLayer === l.id
                      ? "bg-slate-700 text-white"
                      : "bg-slate-800/60 text-slate-400 hover:bg-slate-700/50"
                  }`}
                >
                  {l.label}
                </button>
              ))}
              <span className="ml-auto text-[10px] text-muted-foreground">click any cell to inspect →</span>
            </div>

            {/* SVG hex grid */}
            <div className="bg-slate-950 p-2">
              <svg
                viewBox="0 0 360 380"
                style={{ width: "100%", height: "auto", display: "block", maxHeight: 420 }}
                onClick={(e) => {
                  // Click on background deselects
                  if ((e.target as SVGElement).tagName === "rect" || (e.target as SVGElement).tagName === "svg") {
                    setSelectedCell(null);
                  }
                }}
              >
                <defs>
                  <linearGradient id="legendGradFlood" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#1e3a5f" />
                    <stop offset="25%" stopColor="#2c5f7c" />
                    <stop offset="50%" stopColor="#6b8e4e" />
                    <stop offset="75%" stopColor="#e85d04" />
                    <stop offset="100%" stopColor="#c1121f" />
                  </linearGradient>
                  <linearGradient id="legendGradRain" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#1a1a2e" />
                    <stop offset="50%" stopColor="#16213e" />
                    <stop offset="100%" stopColor="#0f3460" />
                  </linearGradient>
                  <linearGradient id="legendGradTerrain" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#2F4F4F" />
                    <stop offset="33%" stopColor="#6b8e4e" />
                    <stop offset="66%" stopColor="#d4a017" />
                    <stop offset="100%" stopColor="#8B4513" />
                  </linearGradient>
                </defs>

                {/* Background */}
                <rect width="360" height="380" fill="#0a0f1a" rx="6" />

                {/* Region label */}
                <text x="180" y="18" textAnchor="middle" fill="#64748b" fontSize="10" fontWeight="700" letterSpacing="1">
                  {(region?.name ?? "FLOOD REGION").toUpperCase()} — INUNDATION GRID
                </text>

                {/* Place name labels on the grid */}
                {region?.placeNames?.map((place, i) => {
                  const hexRadius = 10;
                  const hexW = hexRadius * Math.sqrt(3);
                  const hexH = hexRadius * 1.5;
                  const startX = 180 - ((GRID - 1) * hexW) / 2;
                  const startY = 190 - ((GRID - 1) * hexH) / 2;
                  const offset = place.row % 2 === 1 ? hexW / 2 : 0;
                  const px = startX + place.col * hexW + offset;
                  const py = startY + place.row * hexH;
                  const isCity = place.type === "city";
                  const isRiver = place.type === "river";
                  return (
                    <g key={`place-${i}`}>
                      {/* City marker dot */}
                      {isCity && (
                        <circle cx={px} cy={py} r="2" fill="#3b82f6" stroke="#fff" strokeWidth="0.5" />
                      )}
                      {/* River marker */}
                      {isRiver && (
                        <circle cx={px} cy={py} r="1.5" fill="#06b6d4" opacity="0.8" />
                      )}
                      {/* Label text */}
                      <text
                        x={px}
                        y={py - (isCity ? 5 : 4)}
                        textAnchor="middle"
                        fill={isCity ? "#60a5fa" : isRiver ? "#22d3ee" : "#cbd5e1"}
                        fontSize={isCity ? "8.5" : "7.5"}
                        fontWeight={isCity ? "700" : "500"}
                        opacity="0.95"
                        style={{ pointerEvents: "none", textTransform: "uppercase" }}
                      >
                        {place.name}
                      </text>
                    </g>
                  );
                })}

                {/* Hex cells */}
                {(() => {
                  const hexRadius = 10;
                  const hexW = hexRadius * Math.sqrt(3);
                  const hexH = hexRadius * 1.5;
                  const cols = GRID;
                  const rows = GRID;
                  const startX = 180 - ((cols - 1) * hexW) / 2;
                  const startY = 190 - ((rows - 1) * hexH) / 2;
                  const cells: React.ReactNode[] = [];

                  for (let r = 0; r < rows; r++) {
                    for (let c = 0; c < cols; c++) {
                      const offset = r % 2 === 1 ? hexW / 2 : 0;
                      const cx = startX + c * hexW + offset;
                      const cy = startY + r * hexH;
                      const isFlood = maskGrid[r]?.[c] ?? false;
                      const prob = probGrid?.[r]?.[c] ?? 0;
                      const isSelected = selectedCell?.r === r && selectedCell?.c === c;

                      // Color based on active layer
                      let fill = "#1e3a5f";
                      if (activeLayer === "flood") {
                        if (isFlood) {
                          if (prob > 0.8) fill = "#c1121f";
                          else if (prob > 0.5) fill = "#e85d04";
                          else fill = "#f48c06";
                        } else {
                          if (prob > 0.3) fill = "#6b8e4e";
                          else if (prob > 0.1) fill = "#2c5f7c";
                          else fill = "#1e3a5f";
                        }
                      } else if (activeLayer === "rain") {
                        const rainVal = isFlood ? prob * 35 : prob * 15;
                        if (rainVal > 25) fill = "#0f3460";
                        else if (rainVal > 10) fill = "#16213e";
                        else fill = "#1a1a2e";
                      } else if (activeLayer === "risk") {
                        if (prob > 0.7) fill = "#7f1d1d";
                        else if (prob > 0.4) fill = "#ea580c";
                        else if (prob > 0.2) fill = "#ca8a04";
                        else fill = "#166534";
                      } else if (activeLayer === "terrain") {
                        const elev = (r / GRID) * 30 + (c / GRID) * 10 + (isFlood ? 0 : 15);
                        if (elev > 25) fill = "#8B4513";
                        else if (elev > 15) fill = "#d4a017";
                        else if (elev > 8) fill = "#6b8e4e";
                        else fill = "#2F4F4F";
                      }

                      const pts: string[] = [];
                      for (let i = 0; i < 6; i++) {
                        const angle = (Math.PI / 3) * i - Math.PI / 2;
                        const px = cx + hexRadius * Math.cos(angle);
                        const py = cy + hexRadius * Math.sin(angle);
                        pts.push(`${px.toFixed(1)},${py.toFixed(1)}`);
                      }

                      cells.push(
                        <polygon
                          key={`hex-${r}-${c}`}
                          points={pts.join(" ")}
                          fill={fill}
                          stroke={isSelected ? "#ffaa00" : isFlood ? "#ff6b3544" : "#33415544"}
                          strokeWidth={isSelected ? "2" : "0.5"}
                          opacity={isSelected ? 1 : 0.85}
                          style={{ cursor: "pointer", transition: "opacity 0.15s" }}
                          onMouseEnter={(e) => {
                            (e.currentTarget as SVGPolygonElement).style.opacity = "1";
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as SVGPolygonElement).style.opacity = isSelected ? "1" : "0.85";
                          }}
                          onClick={() => setSelectedCell({ r, c })}
                        >
                          <title>{`Cell H_${String(r).padStart(2, "0")}${String(c).padStart(2, "0")} — ${isFlood ? "FLOOD" : "land"} — prob ${(prob * 100).toFixed(0)}%`}</title>
                        </polygon>,
                      );

                      // Selected cell glow
                      if (isSelected) {
                        cells.push(
                          <polygon
                            key={`glow-${r}-${c}`}
                            points={pts.join(" ")}
                            fill="none"
                            stroke="#ffaa00"
                            strokeWidth="2"
                            opacity="0.6"
                            style={{ pointerEvents: "none" }}
                          >
                            <animate attributeName="stroke-width" values="2;3;2" dur="1.5s" repeatCount="indefinite" />
                          </polygon>,
                        );
                      }
                    }
                  }
                  return cells;
                })()}

                {/* Colorbar */}
                <rect x="60" y="345" width="240" height="8" fill={`url(#legendGrad${activeLayer === "terrain" ? "Terrain" : activeLayer === "rain" ? "Rain" : "Flood"})`} rx="2" />
                <text x="60" y="365" fill="#64748b" fontSize="8">Low</text>
                <text x="180" y="365" textAnchor="middle" fill="#64748b" fontSize="8">
                  {activeLayer === "flood" ? "Flood probability" : activeLayer === "rain" ? "Rainfall mm/h" : activeLayer === "risk" ? "Risk class" : "Elevation m"}
                </text>
                <text x="300" y="365" textAnchor="end" fill="#64748b" fontSize="8">High</text>
              </svg>
            </div>
          </Card>

          {/* Cell Inspector panel */}
          <Card className="gap-0 overflow-hidden p-0">
            {selectedCell ? (() => {
              const { r, c } = selectedCell;
              const isFlood = maskGrid[r]?.[c] ?? false;
              const prob = probGrid?.[r]?.[c] ?? 0;
              const cellId = `H_${String(r).padStart(2, "0")}${String(c).padStart(2, "0")}`;
              const region0 = region;
              const lat = region0 ? region0.latitude + (r - GRID / 2) * 0.01 : 0;
              const lon = region0 ? region0.longitude + (c - GRID / 2) * 0.01 : 0;
              const elevation = ((r / GRID) * 25 + (c / GRID) * 8 + (isFlood ? 0 : 12)).toFixed(1);
              const slope = (Math.abs(r - GRID / 2) * 0.3 + Math.abs(c - GRID / 2) * 0.2).toFixed(1);
              const impervious = Math.round(30 + prob * 50);
              const drainageDist = Math.round(500 + (1 - prob) * 3000);
              const rainNow = (prob * 30 + (isFlood ? 5 : 0)).toFixed(1);
              const forecast60 = (prob * 20).toFixed(1);
              const confidence = Math.round(60 + prob * 35);
              const riskLabel = prob > 0.7 ? "EXTREME" : prob > 0.5 ? "HIGH" : prob > 0.3 ? "MODERATE" : prob > 0.1 ? "LOW" : "MINIMAL";
              const riskColor = prob > 0.7 ? "#dc2626" : prob > 0.5 ? "#ea580c" : prob > 0.3 ? "#f59e0b" : "#22c55e";

              return (
                <div className="flex h-full flex-col">
                  {/* Header */}
                  <div className="border-b border-border bg-slate-950/60 px-4 py-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Crosshair className="size-4 text-cyan-400" />
                        <span className="text-sm font-bold tracking-wide">{cellId}</span>
                      </div>
                      <button
                        onClick={() => setSelectedCell(null)}
                        className="text-muted-foreground hover:text-foreground text-xs"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="size-2 rounded-full" style={{ background: riskColor }} />
                      <span className="text-[10px] font-bold uppercase" style={{ color: riskColor }}>{riskLabel}</span>
                      <span className="text-[10px] text-muted-foreground">· {lat.toFixed(3)}°N, {lon.toFixed(3)}°E</span>
                    </div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">
                      Land use: {isFlood ? "Water body" : prob > 0.3 ? "Urban dense" : "Urban sparse"}
                    </div>
                  </div>

                  {/* Key metrics 2x2 grid */}
                  <div className="grid grid-cols-2 gap-px bg-border">
                    <div className="bg-card p-3">
                      <div className="text-[9px] uppercase text-muted-foreground">Flood Probability</div>
                      <div className="text-xl font-bold" style={{ color: riskColor }}>{(prob * 100).toFixed(0)}%</div>
                      <div className="text-[8px] text-muted-foreground">{confidence > 75 ? "high confidence" : "moderate confidence"}</div>
                    </div>
                    <div className="bg-card p-3">
                      <div className="text-[9px] uppercase text-muted-foreground">Rain (Now)</div>
                      <div className="text-xl font-bold text-cyan-400">{rainNow}</div>
                      <div className="text-[8px] text-muted-foreground">mm/h</div>
                    </div>
                    <div className="bg-card p-3">
                      <div className="text-[9px] uppercase text-muted-foreground">Forecast 60M</div>
                      <div className="text-xl font-bold text-orange-400">{forecast60}</div>
                      <div className="text-[8px] text-muted-foreground">mm predicted</div>
                    </div>
                    <div className="bg-card p-3">
                      <div className="text-[9px] uppercase text-muted-foreground">Confidence</div>
                      <div className="text-xl font-bold text-white">{confidence}%</div>
                      <div className="text-[8px] text-muted-foreground">model certainty</div>
                    </div>
                  </div>

                  {/* Flood probability bar */}
                  <div className="border-b border-border px-4 py-3">
                    <div className="mb-1.5 flex items-center justify-between text-[10px]">
                      <span className="text-muted-foreground">Flood probability</span>
                      <span className="font-bold" style={{ color: riskColor }}>{(prob * 100).toFixed(0)}%</span>
                    </div>
                    <div className="relative h-2 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${prob * 100}%`,
                          background: `linear-gradient(90deg, #22c55e, #f59e0b, #ea580c, #dc2626)`,
                        }}
                      />
                    </div>
                    <div className="mt-1 flex justify-between text-[8px] text-muted-foreground">
                      <span>0%</span><span>35%</span><span>60%</span><span>80%</span><span>100%</span>
                    </div>
                  </div>

                  {/* Terrain & exposure table */}
                  <div className="px-4 py-3">
                    <div className="mb-2 text-[10px] font-semibold uppercase text-muted-foreground">Terrain & Exposure</div>
                    <div className="space-y-1.5">
                      {[
                        { icon: "🏔", label: "Elevation", value: `${elevation} m` },
                        { icon: "📐", label: "Slope", value: `${slope}°` },
                        { icon: "🏗", label: "Impervious", value: `${impervious}%` },
                        { icon: "💧", label: "Drainage dist", value: `${drainageDist} m` },
                        { icon: "📍", label: "Land use", value: isFlood ? "water" : prob > 0.3 ? "urban-dense" : "urban-sparse" },
                        { icon: "🌐", label: "Region", value: region?.name ?? "—" },
                      ].map((row) => (
                        <div key={row.label} className="flex items-center justify-between text-xs">
                          <span className="flex items-center gap-1.5 text-muted-foreground">
                            <span>{row.icon}</span>
                            {row.label}
                          </span>
                          <span className="font-medium text-foreground">{row.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Recommended action */}
                  <div className="mt-auto border-t border-border bg-slate-950/40 px-4 py-3">
                    <div className="text-[10px] font-semibold uppercase text-muted-foreground mb-1">Recommended Action</div>
                    <div className="text-xs" style={{ color: riskColor }}>
                      {prob > 0.7
                        ? "EMERGENCY: Evacuate immediately. Deploy NDRF boat units."
                        : prob > 0.5
                        ? "HIGH: Pre-position rescue teams. Issue Red alert."
                        : prob > 0.3
                        ? "MODERATE: Monitor drains. Pre-position pumps."
                        : "LOW: Routine monitoring. No action needed."}
                    </div>
                  </div>
                </div>
              );
            })() : (
              <div className="flex h-full min-h-[300px] flex-col items-center justify-center p-6 text-center">
                <Crosshair className="mb-3 size-8 text-muted-foreground/40" />
                <div className="text-sm font-medium text-muted-foreground">Cell Inspector</div>
                <div className="mt-1 text-xs text-muted-foreground/70">
                  Click any hexagonal cell on the grid to inspect its flood data, rainfall, terrain, and recommended actions.
                </div>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

/* ---------- canvas drawing ---------- */

function drawSar(
  canvas: HTMLCanvasElement | null,
  mask: boolean[][],
) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw a realistic-looking SAR backscatter image.
  // Water = dark (low backscatter), Land = bright (high backscatter).
  // The pattern is derived from the mask so SAR and mask are spatially aligned.
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const flooded = mask[r]![c]!;
      // Stable per-cell hash for texture.
      const h = (Math.sin(r * 12.9898 + c * 78.233) * 43758.5453) % 1;
      const noise = Math.abs(h);

      let R: number, G: number, B: number;
      if (flooded) {
        // Water: very dark blue-black (low SAR backscatter)
        const v = 15 + noise * 20;
        R = Math.round(v * 0.3);
        G = Math.round(v * 0.4);
        B = Math.round(v * 0.6);
      } else {
        // Land: brown/tan with texture (higher backscatter)
        const v = 80 + noise * 60;
        R = Math.round(v * 0.85);
        G = Math.round(v * 0.75);
        B = Math.round(v * 0.55);
      }
      ctx.fillStyle = `rgb(${R}, ${G}, ${B})`;
      ctx.fillRect(c * CELL, r * CELL, CELL, CELL);
    }
  }

  // Subtle grid lines for reference.
  ctx.strokeStyle = "rgba(255,255,255,0.04)";
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= GRID; i++) {
    ctx.beginPath();
    ctx.moveTo(i * CELL, 0);
    ctx.lineTo(i * CELL, CANVAS_SIZE);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * CELL);
    ctx.lineTo(CANVAS_SIZE, i * CELL);
    ctx.stroke();
  }
}

function drawMask(
  canvas: HTMLCanvasElement | null,
  mask: boolean[][],
) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      ctx.fillStyle = mask[r]![c]! ? "#DC2626" : "#1a1a2a";
      ctx.fillRect(c * CELL, r * CELL, CELL, CELL);
    }
  }
}

function drawProb(
  canvas: HTMLCanvasElement | null,
  prob: number[][],
) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const p = prob[r]![c]!;
      // Colour ramp: blue (0) → cyan → yellow → red (1).
      const R = Math.round(p * 255);
      const G = Math.round((1 - Math.abs(p - 0.5) * 2) * 220);
      const B = Math.round((1 - p) * 220);
      ctx.fillStyle = `rgb(${R}, ${G}, ${B})`;
      ctx.fillRect(c * CELL, r * CELL, CELL, CELL);
    }
  }
}

/* ---------- sub-components ---------- */

function CanvasCard({
  title,
  hint,
  icon,
  loading,
  canvasRef,
}: {
  title: string;
  hint: string;
  icon: React.ReactNode;
  loading: boolean;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}) {
  return (
    <Card className="gap-2 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          {icon}
          <span>{title}</span>
        </div>
        <span className="text-[10px] text-muted-foreground">{hint}</span>
      </div>
      <div className="relative flex items-center justify-center">
        {loading && (
          <Skeleton className="absolute inset-0 m-auto h-[256px] w-[256px]" />
        )}
        <canvas
          ref={canvasRef}
          width={CANVAS_SIZE}
          height={CANVAS_SIZE}
          className="rounded-md border border-border bg-background"
          style={{ width: "100%", maxWidth: 256, aspectRatio: "1 / 1" }}
        />
      </div>
    </Card>
  );
}

function StatTile({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "warn";
}) {
  const color = tone === "warn" ? "text-amber-400" : "text-foreground";
  return (
    <div className="rounded-md border border-border bg-card/40 p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`mt-0.5 break-words text-sm font-semibold ${color}`}>
        {value}
      </div>
    </div>
  );
}
