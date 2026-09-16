/**
 * Weather icon mapping.
 *
 * Maps WMO weather codes to:
 *   - an emoji suitable for inline display in the UI
 *   - a CSS gradient string (two-stop, left→right) for card backgrounds
 *
 * Also exposes:
 *   - `riskColor(level)` — hex colour for an inundation-risk bucket
 *   - `tempColor(temperatureC)` — hex colour on a blue→red scale
 */

import type { RiskLevel } from "@/lib/weather/types";

export interface WeatherVisual {
  emoji: string;
  /** Two-stop gradient, e.g. "linear-gradient(135deg, #87CEEB, #4682B4)" */
  gradient: string;
  /** Short label, e.g. "Heavy rain" */
  label: string;
  /** True if the code represents precipitation */
  isPrecipitation: boolean;
  /** True if the code represents a thunderstorm */
  isThunderstorm: boolean;
}

/* -------------------------------------------------------------------------- */
/*  WMO code → visual mapping                                                  */
/* -------------------------------------------------------------------------- */

const WMO_VISUALS: Record<number, WeatherVisual> = {
  0: {
    emoji: "☀️",
    gradient: "linear-gradient(135deg, #FDB813, #FF8C00)",
    label: "Clear sky",
    isPrecipitation: false,
    isThunderstorm: false,
  },
  1: {
    emoji: "🌤️",
    gradient: "linear-gradient(135deg, #87CEEB, #4682B4)",
    label: "Mainly clear",
    isPrecipitation: false,
    isThunderstorm: false,
  },
  2: {
    emoji: "⛅",
    gradient: "linear-gradient(135deg, #B0C4DE, #708090)",
    label: "Partly cloudy",
    isPrecipitation: false,
    isThunderstorm: false,
  },
  3: {
    emoji: "☁️",
    gradient: "linear-gradient(135deg, #A9A9A9, #696969)",
    label: "Overcast",
    isPrecipitation: false,
    isThunderstorm: false,
  },
  45: {
    emoji: "🌫️",
    gradient: "linear-gradient(135deg, #D3D3D3, #A9A9A9)",
    label: "Fog",
    isPrecipitation: false,
    isThunderstorm: false,
  },
  48: {
    emoji: "🌫️",
    gradient: "linear-gradient(135deg, #D3D3D3, #BEBEBE)",
    label: "Rime fog",
    isPrecipitation: false,
    isThunderstorm: false,
  },
  51: {
    emoji: "🌦️",
    gradient: "linear-gradient(135deg, #B0C4DE, #4682B4)",
    label: "Light drizzle",
    isPrecipitation: true,
    isThunderstorm: false,
  },
  53: {
    emoji: "🌦️",
    gradient: "linear-gradient(135deg, #87CEEB, #1E90FF)",
    label: "Moderate drizzle",
    isPrecipitation: true,
    isThunderstorm: false,
  },
  55: {
    emoji: "🌧️",
    gradient: "linear-gradient(135deg, #4682B4, #000080)",
    label: "Dense drizzle",
    isPrecipitation: true,
    isThunderstorm: false,
  },
  56: {
    emoji: "🌧️",
    gradient: "linear-gradient(135deg, #B0C4DE, #1E90FF)",
    label: "Light freezing drizzle",
    isPrecipitation: true,
    isThunderstorm: false,
  },
  57: {
    emoji: "🌧️",
    gradient: "linear-gradient(135deg, #4682B4, #191970)",
    label: "Dense freezing drizzle",
    isPrecipitation: true,
    isThunderstorm: false,
  },
  61: {
    emoji: "🌦️",
    gradient: "linear-gradient(135deg, #87CEEB, #4682B4)",
    label: "Slight rain",
    isPrecipitation: true,
    isThunderstorm: false,
  },
  63: {
    emoji: "🌧️",
    gradient: "linear-gradient(135deg, #4682B4, #1E90FF)",
    label: "Moderate rain",
    isPrecipitation: true,
    isThunderstorm: false,
  },
  65: {
    emoji: "🌧️",
    gradient: "linear-gradient(135deg, #1E90FF, #000080)",
    label: "Heavy rain",
    isPrecipitation: true,
    isThunderstorm: false,
  },
  66: {
    emoji: "🌧️",
    gradient: "linear-gradient(135deg, #B0C4DE, #4682B4)",
    label: "Light freezing rain",
    isPrecipitation: true,
    isThunderstorm: false,
  },
  67: {
    emoji: "🌧️",
    gradient: "linear-gradient(135deg, #4682B4, #191970)",
    label: "Heavy freezing rain",
    isPrecipitation: true,
    isThunderstorm: false,
  },
  71: {
    emoji: "🌨️",
    gradient: "linear-gradient(135deg, #E0FFFF, #B0C4DE)",
    label: "Slight snow",
    isPrecipitation: true,
    isThunderstorm: false,
  },
  73: {
    emoji: "🌨️",
    gradient: "linear-gradient(135deg, #B0E0E6, #87CEEB)",
    label: "Moderate snow",
    isPrecipitation: true,
    isThunderstorm: false,
  },
  75: {
    emoji: "❄️",
    gradient: "linear-gradient(135deg, #87CEEB, #4682B4)",
    label: "Heavy snow",
    isPrecipitation: true,
    isThunderstorm: false,
  },
  77: {
    emoji: "❄️",
    gradient: "linear-gradient(135deg, #F0F8FF, #B0C4DE)",
    label: "Snow grains",
    isPrecipitation: true,
    isThunderstorm: false,
  },
  80: {
    emoji: "🌦️",
    gradient: "linear-gradient(135deg, #87CEEB, #4682B4)",
    label: "Slight rain showers",
    isPrecipitation: true,
    isThunderstorm: false,
  },
  81: {
    emoji: "🌧️",
    gradient: "linear-gradient(135deg, #4682B4, #1E90FF)",
    label: "Moderate rain showers",
    isPrecipitation: true,
    isThunderstorm: false,
  },
  82: {
    emoji: "⛈️",
    gradient: "linear-gradient(135deg, #1E90FF, #191970)",
    label: "Violent rain showers",
    isPrecipitation: true,
    isThunderstorm: false,
  },
  85: {
    emoji: "🌨️",
    gradient: "linear-gradient(135deg, #B0E0E6, #87CEEB)",
    label: "Slight snow showers",
    isPrecipitation: true,
    isThunderstorm: false,
  },
  86: {
    emoji: "❄️",
    gradient: "linear-gradient(135deg, #87CEEB, #4682B4)",
    label: "Heavy snow showers",
    isPrecipitation: true,
    isThunderstorm: false,
  },
  95: {
    emoji: "⛈️",
    gradient: "linear-gradient(135deg, #483D8B, #FFD700)",
    label: "Thunderstorm",
    isPrecipitation: true,
    isThunderstorm: true,
  },
  96: {
    emoji: "⛈️",
    gradient: "linear-gradient(135deg, #191970, #FFD700)",
    label: "Thunderstorm with slight hail",
    isPrecipitation: true,
    isThunderstorm: true,
  },
  99: {
    emoji: "🌩️",
    gradient: "linear-gradient(135deg, #191970, #FF4500)",
    label: "Thunderstorm with heavy hail",
    isPrecipitation: true,
    isThunderstorm: true,
  },
};

const FALLBACK_VISUAL: WeatherVisual = {
  emoji: "🌡️",
  gradient: "linear-gradient(135deg, #87CEEB, #4682B4)",
  label: "Unknown",
  isPrecipitation: false,
  isThunderstorm: false,
};

export function getWeatherVisual(code: number | null | undefined): WeatherVisual {
  if (code == null) return FALLBACK_VISUAL;
  return WMO_VISUALS[code] ?? FALLBACK_VISUAL;
}

/* -------------------------------------------------------------------------- */
/*  Risk level → colour                                                       */
/* -------------------------------------------------------------------------- */

const RISK_COLORS: Record<RiskLevel, string> = {
  LOW: "#22C55E", // green-500
  MODERATE: "#F59E0B", // amber-500
  HIGH: "#F97316", // orange-500
  CRITICAL: "#DC2626", // red-600
};

export function riskColor(level: RiskLevel): string {
  return RISK_COLORS[level] ?? "#6B7280";
}

/* -------------------------------------------------------------------------- */
/*  Temperature → colour (blue → red scale)                                   */
/* -------------------------------------------------------------------------- */

/**
 * Returns a hex colour on a blue→red temperature scale.
 *   - ≤ 0°C  → deep blue   (#1E3A8A)
 *   - 15°C   → light blue  (#3B82F6)
 *   - 25°C   → yellow      (#FACC15)
 *   - 35°C   → orange      (#F97316)
 *   - ≥ 45°C → deep red    (#7F1D1D)
 *
 * Uses piecewise linear interpolation between the anchors.
 */
export function tempColor(temperatureC: number): string {
  const anchors: Array<[number, [number, number, number]]> = [
    [-5, [30, 58, 138]],
    [15, [59, 130, 246]],
    [25, [250, 204, 21]],
    [35, [249, 115, 22]],
    [45, [127, 29, 29]],
  ];

  if (temperatureC <= anchors[0]![0]) return rgbToHex(anchors[0]![1]);
  if (temperatureC >= anchors[anchors.length - 1]![0]) {
    return rgbToHex(anchors[anchors.length - 1]![1]);
  }

  for (let i = 0; i < anchors.length - 1; i++) {
    const [t1, c1] = anchors[i]!;
    const [t2, c2] = anchors[i + 1]!;
    if (temperatureC >= t1 && temperatureC <= t2) {
      const fraction = (temperatureC - t1) / (t2 - t1);
      const r = Math.round(c1[0] + (c2[0] - c1[0]) * fraction);
      const g = Math.round(c1[1] + (c2[1] - c1[1]) * fraction);
      const b = Math.round(c1[2] + (c2[2] - c1[2]) * fraction);
      return rgbToHex([r, g, b]);
    }
  }
  return rgbToHex(anchors[1]![1]);
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export default { getWeatherVisual, riskColor, tempColor };
