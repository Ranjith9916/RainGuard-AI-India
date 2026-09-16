"use client";

/**
 * RiskIndex.tsx
 *
 * AQI-style gauge showing the flood probability (0..1) mapped to a coloured
 * band. The gauge is a horizontal arc with the probability value centred
 * inside, plus a row of threshold markers below.
 */

import { Card } from "@/components/ui/card";
import { riskColor } from "@/lib/weather-icons";
import type { RiskLevel } from "@/lib/weather/types";
import { AlertTriangle, ShieldCheck } from "lucide-react";

interface RiskIndexProps {
  probability: number;
  riskLevel: RiskLevel;
  inundationDepthM?: number;
  forecastRainfallMm?: number;
}

const RISK_BANDS: Array<{
  level: RiskLevel;
  threshold: number;
  color: string;
  label: string;
}> = [
  { level: "LOW", threshold: 0.2, color: "#22C55E", label: "Low" },
  { level: "MODERATE", threshold: 0.4, color: "#F59E0B", label: "Moderate" },
  { level: "HIGH", threshold: 0.7, color: "#F97316", label: "High" },
  { level: "CRITICAL", threshold: 1.01, color: "#DC2626", label: "Critical" },
];

export default function RiskIndex({
  probability,
  riskLevel,
  inundationDepthM = 0,
  forecastRainfallMm = 0,
}: RiskIndexProps) {
  const pct = Math.max(0, Math.min(1, probability));
  const pct100 = Math.round(pct * 100);
  const color = riskColor(riskLevel);

  return (
    <Card className="gap-4 p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          {pct >= 0.7 ? (
            <AlertTriangle className="size-4 text-destructive" />
          ) : (
            <ShieldCheck className="size-4 text-emerald-400" />
          )}
          <span>Flood probability index</span>
        </div>
        <div
          className="rounded-full px-2 py-0.5 text-xs font-bold"
          style={{
            background: `${color}22`,
            color,
            border: `1px solid ${color}`,
          }}
        >
          {riskLevel}
        </div>
      </div>

      {/* Arc / horizontal gauge */}
      <div className="relative h-3 w-full overflow-hidden rounded-full bg-gradient-to-r from-emerald-500 via-amber-500 to-red-600">
        <div
          className="absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background shadow-md"
          style={{
            left: `${pct100}%`,
            background: color,
          }}
        />
      </div>

      {/* Probability read-out */}
      <div className="flex items-end justify-between">
        <div>
          <div className="text-4xl font-bold" style={{ color }}>
            {pct100}
            <span className="text-xl">%</span>
          </div>
          <div className="text-xs text-muted-foreground">
            Flood probability (next horizon)
          </div>
        </div>
        <div className="flex flex-col gap-1 text-right text-xs text-muted-foreground">
          <div>
            Inundation:{" "}
            <span className="font-semibold text-foreground">
              {(inundationDepthM * 100).toFixed(1)} cm
            </span>
          </div>
          <div>
            Forecast rain:{" "}
            <span className="font-semibold text-foreground">
              {forecastRainfallMm.toFixed(1)} mm
            </span>
          </div>
        </div>
      </div>

      {/* Threshold legend */}
      <div className="grid grid-cols-4 gap-2 text-center text-[10px]">
        {RISK_BANDS.map((band) => {
          const active = band.level === riskLevel;
          return (
            <div
              key={band.level}
              className="rounded-md border p-2"
              style={{
                borderColor: active ? band.color : "transparent",
                background: active ? `${band.color}11` : "transparent",
              }}
            >
              <div
                className="h-1.5 w-full rounded-full"
                style={{ background: band.color }}
              />
              <div className="mt-1 font-semibold" style={{ color: band.color }}>
                {band.label}
              </div>
              <div className="text-muted-foreground">
                ≥ {Math.round(band.threshold * 100)}%
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
