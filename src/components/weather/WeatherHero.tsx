"use client";

/**
 * WeatherHero.tsx
 *
 * Google-Weather-style hero card. Large temperature, weather emoji, gradient
 * background derived from the WMO weather code, plus a row of stat chips
 * (high/low/humidity/rainfall) and a flood-risk pill on the right.
 */

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getWeatherVisual, riskColor, tempColor } from "@/lib/weather-icons";
import type { CityWeatherPayload } from "@/lib/weather/types";
import {
  Droplets,
  Gauge,
  MapPin,
  Sunrise,
  Sunset,
  Thermometer,
  Waves,
  Wind,
} from "lucide-react";

interface WeatherHeroProps {
  payload: CityWeatherPayload | null;
}

export default function WeatherHero({ payload }: WeatherHeroProps) {
  const current = payload?.current;
  const code = current?.weatherCode ?? null;
  const visual = getWeatherVisual(code);

  const temperatureC = current?.temperatureC ?? 0;
  const apparent =
    current?.apparentTemperatureC ?? current?.temperatureC ?? 0;
  const humidity = current?.humidityPercent ?? 0;
  const windMs = current?.windSpeedMs ?? 0;
  const pressure = current?.pressureHpa ?? 0;
  const precip = current?.precipitationMm ?? 0;
  const rainfallForecast = payload?.forecastRainfallMm ?? 0;
  const inundation = payload?.inundationDepthM ?? 0;
  const floodProbability = payload?.floodProbability ?? 0;
  const riskLevel = payload?.riskLevel ?? "LOW";

  const today = payload?.forecast?.daily?.[0];
  const tMax = today?.temperatureMaxC ?? temperatureC + 2;
  const tMin = today?.temperatureMinC ?? temperatureC - 5;

  const riskHex = riskColor(riskLevel);
  const floodPct = Math.round(floodProbability * 100);

  const sunrise = today?.sunrise ? new Date(today.sunrise) : null;
  const sunset = today?.sunset ? new Date(today.sunset) : null;
  const fmtHM = (d: Date | null) =>
    d ? d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—";

  return (
    <Card
      className="overflow-hidden border-0 p-0 shadow-lg"
      style={{
        background: visual.gradient,
        minHeight: 280,
      }}
    >
      <div className="relative flex flex-col gap-6 p-6 text-white sm:flex-row sm:items-stretch sm:justify-between">
        {/* Left: city + temperature + emoji */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm font-medium text-white/90">
            <MapPin className="size-4" />
            <span className="uppercase tracking-wide">
              {payload?.cityName ?? "India"} · {payload?.state ?? ""}
            </span>
          </div>

          <div className="flex items-end gap-4">
            <div
              className="text-7xl font-extralight leading-none drop-shadow-sm sm:text-8xl"
              style={{ color: "#fff" }}
            >
              {Math.round(temperatureC)}°
            </div>
            <div className="pb-2 text-5xl drop-shadow sm:text-6xl">
              {visual.emoji}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm text-white/95">
            <span className="font-semibold capitalize">{visual.label}</span>
            <span className="text-white/70">·</span>
            <span>Feels {Math.round(apparent)}°C</span>
          </div>

          {/* High / Low / humidity / rainfall chips */}
          <div className="mt-2 flex flex-wrap gap-2">
            <HeroChip
              icon={<Thermometer className="size-3.5" />}
              label="High"
              value={`${Math.round(tMax)}°`}
            />
            <HeroChip
              icon={<Thermometer className="size-3.5" />}
              label="Low"
              value={`${Math.round(tMin)}°`}
            />
            <HeroChip
              icon={<Droplets className="size-3.5" />}
              label="Humidity"
              value={`${Math.round(humidity)}%`}
            />
            <HeroChip
              icon={<Waves className="size-3.5" />}
              label="Rainfall"
              value={`${precip.toFixed(1)} mm`}
            />
            <HeroChip
              icon={<Wind className="size-3.5" />}
              label="Wind"
              value={`${windMs.toFixed(1)} m/s`}
            />
            <HeroChip
              icon={<Gauge className="size-3.5" />}
              label="Pressure"
              value={`${Math.round(pressure)} hPa`}
            />
          </div>
        </div>

        {/* Right: flood risk pill + sunrise/sunset */}
        <div className="flex flex-col items-stretch justify-between gap-3 sm:items-end">
          <div
            className="rounded-2xl bg-black/35 p-4 backdrop-blur-sm"
            style={{ borderLeft: `4px solid ${riskHex}` }}
          >
            <div className="text-[10px] font-semibold uppercase tracking-widest text-white/70">
              Flood Risk
            </div>
            <div
              className="mt-1 text-3xl font-bold"
              style={{ color: riskHex }}
            >
              {riskLevel}
            </div>
            <div className="mt-1 text-xs text-white/80">
              {floodPct}% probability
            </div>
            <div className="mt-1 text-xs text-white/70">
              Inundation depth: {(inundation * 100).toFixed(1)} cm
            </div>
            <div className="mt-1 text-xs text-white/70">
              Forecast rain: {rainfallForecast.toFixed(1)} mm
            </div>
          </div>

          <div className="flex flex-col gap-2 text-xs text-white/90 sm:items-end">
            <div className="flex items-center gap-1.5">
              <Sunrise className="size-3.5" />
              <span>Sunrise {fmtHM(sunrise)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Sunset className="size-3.5" />
              <span>Sunset {fmtHM(sunset)}</span>
            </div>
            {payload?.source && (
              <Badge
                variant="secondary"
                className="mt-1 bg-white/15 text-white"
              >
                src: {payload.source}
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Color stripe along the bottom showing the temperature color */}
      <div
        className="h-1.5 w-full"
        style={{ background: tempColor(temperatureC) }}
      />
    </Card>
  );
}

function HeroChip({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-full bg-black/30 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm">
      {icon}
      <span className="text-white/75">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
