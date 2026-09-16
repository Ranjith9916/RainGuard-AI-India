"use client";

/**
 * CitiesForecast.tsx
 *
 * 16-city list panel — each row shows the city name, current temperature,
 * rainfall, and a coloured temp-range bar (min→max from today's daily entry)
 * with the current temperature marker overlaid.
 *
 * Clicking a row selects the city in the parent dashboard.
 */

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getWeatherVisual, riskColor, tempColor } from "@/lib/weather-icons";
import type { CityWeatherPayload } from "@/lib/weather/types";
import { MapPin, Waves } from "lucide-react";

interface CitiesForecastProps {
  cities: CityWeatherPayload[];
  selectedCityId?: string;
  onSelect?: (cityId: string) => void;
}

export default function CitiesForecast({
  cities,
  selectedCityId,
  onSelect,
}: CitiesForecastProps) {
  if (cities.length === 0) {
    return (
      <Card className="p-4 text-sm text-muted-foreground">
        No city data yet — press Refresh.
      </Card>
    );
  }

  // Sort by temperature descending so the hottest city is at the top.
  const sorted = [...cities].sort(
    (a, b) =>
      (b.current.temperatureC ?? -999) - (a.current.temperatureC ?? -999),
  );

  // Compute global min/max for the temp-range bar scaling.
  const allTemps = sorted.flatMap((c) => {
    const today = c.forecast?.daily?.[0];
    return [
      today?.temperatureMinC ?? c.current.temperatureC ?? 0,
      today?.temperatureMaxC ?? c.current.temperatureC ?? 0,
    ];
  });
  const gMin = Math.min(...allTemps);
  const gMax = Math.max(...allTemps);
  const span = Math.max(1, gMax - gMin);

  return (
    <Card className="gap-2 p-3">
      <div className="flex items-center justify-between px-2 py-1">
        <div className="text-sm font-semibold">Cities forecast</div>
        <Badge variant="secondary" className="text-xs">
          {sorted.length} cities
        </Badge>
      </div>

      <div
        className="rainguard-scrollbar max-h-[520px] overflow-y-auto pr-1"
        style={{ scrollSnapType: "y proximity" }}
      >
        {sorted.map((city) => {
          const today = city.forecast?.daily?.[0];
          const t = city.current.temperatureC ?? 0;
          const tMin = today?.temperatureMinC ?? t - 3;
          const tMax = today?.temperatureMaxC ?? t + 3;
          const leftPct = ((tMin - gMin) / span) * 100;
          const widthPct = ((tMax - tMin) / span) * 100;
          const markerLeftPct = ((t - gMin) / span) * 100;
          const visual = getWeatherVisual(city.current.weatherCode);
          const riskHex = riskColor(city.riskLevel ?? "LOW");
          const isSelected = city.cityId === selectedCityId;

          return (
            <button
              key={city.cityId}
              onClick={() => onSelect?.(city.cityId)}
              className={`mb-1 flex w-full items-center gap-3 rounded-lg border p-2.5 text-left transition-colors ${
                isSelected
                  ? "border-primary bg-primary/5"
                  : "border-transparent hover:bg-accent/40"
              }`}
              style={{ scrollSnapAlign: "start" }}
            >
              <div className="text-2xl" aria-hidden>
                {visual.emoji}
              </div>

              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate text-sm font-medium">
                    {city.cityName}
                  </div>
                  <div
                    className="text-base font-bold"
                    style={{ color: tempColor(t) }}
                  >
                    {Math.round(t)}°
                  </div>
                </div>

                {/* Temperature range bar */}
                <div className="relative h-1.5 w-full rounded-full bg-muted">
                  <div
                    className="absolute h-full rounded-full"
                    style={{
                      left: `${leftPct}%`,
                      width: `${Math.max(2, widthPct)}%`,
                      background: `linear-gradient(90deg, ${tempColor(
                        tMin,
                      )}, ${tempColor(tMax)})`,
                    }}
                  />
                  <div
                    className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background"
                    style={{ left: `${markerLeftPct}%`, background: tempColor(t) }}
                  />
                </div>

                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <MapPin className="size-2.5" />
                    {city.state ?? "—"}
                  </span>
                  <span className="flex items-center gap-1">
                    <Waves className="size-2.5 text-sky-400" />
                    {(city.current.precipitationMm ?? 0).toFixed(1)} mm
                  </span>
                  <span
                    className="font-semibold uppercase"
                    style={{ color: riskHex }}
                  >
                    {city.riskLevel ?? "LOW"}
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
