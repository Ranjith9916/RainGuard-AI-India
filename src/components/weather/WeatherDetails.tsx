"use client";

/**
 * WeatherDetails.tsx
 *
 * Grid of detail cards: Wind, Humidity, Pressure, Cloud, Precip, Feels Like.
 * Each card has an icon, label, big value, and a progress bar normalised
 * against a sensible range.
 */

import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { CurrentWeather } from "@/lib/weather/types";
import {
  CloudFog,
  Droplets,
  Gauge,
  Thermometer,
  Waves,
  Wind,
} from "lucide-react";

interface WeatherDetailsProps {
  current: CurrentWeather | null;
}

interface DetailCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  pct: number; // 0..100 for the progress bar
  accent: string; // tailwind text color class
}

function DetailCard({
  icon,
  label,
  value,
  hint,
  pct,
  accent,
}: DetailCardProps) {
  return (
    <Card className="gap-2 p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className={accent}>{icon}</span>
        <span className="uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-semibold text-foreground">{value}</div>
      <Progress value={pct} className="h-1.5" />
      <div className="text-[10px] text-muted-foreground">{hint}</div>
    </Card>
  );
}

export default function WeatherDetails({ current }: WeatherDetailsProps) {
  if (!current) {
    return (
      <Card className="p-4 text-sm text-muted-foreground">
        No current observations available.
      </Card>
    );
  }

  const windMs = current.windSpeedMs ?? 0;
  const humidity = current.humidityPercent ?? 0;
  const pressure = current.pressureHpa ?? 1013;
  const cloud = current.cloudCoverPct ?? 0;
  const precip = current.precipitationMm ?? 0;
  const feels = current.apparentTemperatureC ?? current.temperatureC ?? 0;

  // Convert wind m/s → km/h for the display.
  const windKmh = windMs * 3.6;

  // Pressure normalisation: typical surface range 980–1040 hPa.
  const pressurePct = Math.max(
    0,
    Math.min(100, ((pressure - 980) / (1040 - 980)) * 100),
  );

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <DetailCard
        icon={<Wind className="size-4" />}
        label="Wind"
        value={`${windKmh.toFixed(1)} km/h`}
        hint={windKmh > 30 ? "Strong" : windKmh > 15 ? "Breezy" : "Calm"}
        pct={Math.min(100, (windKmh / 60) * 100)}
        accent="text-sky-400"
      />
      <DetailCard
        icon={<Droplets className="size-4" />}
        label="Humidity"
        value={`${Math.round(humidity)}%`}
        hint={humidity > 80 ? "Saturated" : humidity > 60 ? "Humid" : "Dry"}
        pct={humidity}
        accent="text-cyan-400"
      />
      <DetailCard
        icon={<Gauge className="size-4" />}
        label="Pressure"
        value={`${Math.round(pressure)}`}
        hint="hPa (SLP)"
        pct={pressurePct}
        accent="text-violet-400"
      />
      <DetailCard
        icon={<CloudFog className="size-4" />}
        label="Cloud"
        value={`${Math.round(cloud)}%`}
        hint={cloud > 80 ? "Overcast" : cloud > 40 ? "Cloudy" : "Clear"}
        pct={cloud}
        accent="text-slate-300"
      />
      <DetailCard
        icon={<Waves className="size-4" />}
        label="Precip"
        value={`${precip.toFixed(1)} mm`}
        hint={precip > 25 ? "Heavy 1h" : precip > 0.1 ? "Wet" : "None"}
        pct={Math.min(100, (precip / 50) * 100)}
        accent="text-blue-400"
      />
      <DetailCard
        icon={<Thermometer className="size-4" />}
        label="Feels"
        value={`${Math.round(feels)}°C`}
        hint={feels > 35 ? "Hot" : feels < 10 ? "Cold" : "Comfortable"}
        pct={Math.max(0, Math.min(100, ((feels + 10) / 60) * 100))}
        accent="text-amber-400"
      />
    </div>
  );
}
