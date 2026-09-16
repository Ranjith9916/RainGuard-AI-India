"use client";

/**
 * HourlyForecast.tsx
 *
 * Horizontal-scroll strip of hourly forecast tiles (next 24h).
 * Each tile shows: time (HH:MM), weather emoji, temperature, and
 * precipitation probability (mini bar at the bottom).
 *
 * Uses the `.rainguard-scrollbar` class for the custom dark scrollbar.
 */

import { Card } from "@/components/ui/card";
import { getWeatherVisual } from "@/lib/weather-icons";
import type { HourlyEntry } from "@/lib/weather/types";
import { Clock, Droplets } from "lucide-react";

interface HourlyForecastProps {
  hourly: HourlyEntry[];
  /** Optional title override. Default "Hourly forecast". */
  title?: string;
}

export default function HourlyForecast({
  hourly,
  title = "Hourly forecast",
}: HourlyForecastProps) {
  // Take the next 24 entries; if no current time anchor, take first 24.
  const slice = hourly.slice(0, 24);

  if (slice.length === 0) {
    return (
      <Card className="p-4 text-sm text-muted-foreground">
        No hourly forecast available.
      </Card>
    );
  }

  return (
    <Card className="gap-3 p-4">
      <div className="flex items-center gap-2 px-2 text-sm font-semibold text-foreground">
        <Clock className="size-4 text-muted-foreground" />
        <span>{title}</span>
        <span className="ml-auto text-xs font-normal text-muted-foreground">
          Next {slice.length} hours
        </span>
      </div>

      <div
        className="rainguard-scrollbar flex gap-2 overflow-x-auto px-2 pb-2"
        style={{ scrollSnapType: "x proximity" }}
      >
        {slice.map((h, i) => {
          const t = new Date(h.time);
          const label =
            i === 0
              ? "Now"
              : t.toLocaleTimeString("en-IN", {
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                });
          const visual = getWeatherVisual(h.weatherCode);
          const temp = h.temperatureC ?? 0;
          const pop = Math.round(h.precipitationProbability ?? 0);

          return (
            <div
              key={`${h.time}-${i}`}
              className="flex min-w-[88px] shrink-0 flex-col items-center gap-1.5 rounded-xl border border-border bg-card/40 p-3"
              style={{ scrollSnapAlign: "start" }}
            >
              <div className="text-xs font-medium text-muted-foreground">
                {label}
              </div>
              <div className="text-2xl" aria-hidden>
                {visual.emoji}
              </div>
              <div className="text-sm font-semibold text-foreground">
                {Math.round(temp)}°
              </div>
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Droplets className="size-3 text-sky-400" />
                <span>{pop}%</span>
              </div>
              {/* Precip prob bar */}
              <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-sky-400"
                  style={{ width: `${pop}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
