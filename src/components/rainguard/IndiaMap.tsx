"use client";

/**
 * IndiaMap.tsx
 *
 * deck.gl-powered pan-India map showing 16 monitored cities as 3D columns
 * whose height represents the predicted inundation depth (m), colour-coded
 * by risk bucket. City names are rendered via TextLayer.
 *
 * Basemap: CARTO dark raster tiles via @deck.gl/geo-layers TileLayer +
 * @deck.gl/layers BitmapLayer (no mapbox-gl dependency).
 *
 * The viewState is controlled — when the parent passes a new
 * `selectedCityId`, the camera flies to that city.
 */

import { useEffect, useMemo, useState } from "react";
import DeckGL from "@deck.gl/react";
import { MapView } from "@deck.gl/core";
import { TileLayer } from "@deck.gl/geo-layers";
import { BitmapLayer, ColumnLayer, TextLayer } from "@deck.gl/layers";
import type { Layer, ViewState } from "@deck.gl/core";
import { Card } from "@/components/ui/card";
import { riskColor } from "@/lib/weather-icons";
import type { CityWeatherPayload, MapDataPoint } from "@/lib/weather/types";
import { CITIES } from "@/lib/weather/cities";

/**
 * Loose tile-render context for the TileLayer.renderSubLayers callback.
 * deck.gl v8 types are partially exported; this local interface keeps the
 * access to `props.tile.bbox` and `props.data` type-safe without pulling in
 * the full Tile2DLayer generics.
 */
interface TileLayerRenderContext {
  tile: { bbox: { west: number; south: number; east: number; north: number } };
  // deck.gl's TileLayer passes a complex tile + sub-layer props object
  // whose full type is not exported in v8. We index it loosely here.
  data: unknown;
  [key: string]: unknown;
}

const INITIAL_VIEW_STATE: ViewState = {
  longitude: 78.9629,
  latitude: 22.5937,
  zoom: 4.2,
  pitch: 45,
  bearing: 0,
};

interface IndiaMapProps {
  cities: CityWeatherPayload[];
  selectedCityId?: string;
  onSelect?: (cityId: string) => void;
  height?: number;
}

interface HoverInfo {
  x: number;
  y: number;
  city: MapDataPoint;
}

export default function IndiaMap({
  cities,
  selectedCityId,
  onSelect,
  height = 480,
}: IndiaMapProps) {
  const [viewState, setViewState] = useState<ViewState>(INITIAL_VIEW_STATE);
  const [hover, setHover] = useState<HoverInfo | null>(null);

  // Fly to selected city when selectedCityId changes. The setState call
  // here is the canonical "synchronise external state into the camera"
  // pattern — it cannot be derived during render because it depends on
  // the deck.gl viewState prop cycle.
  useEffect(() => {
    if (!selectedCityId) return;
    const city = CITIES.find((c) => c.id === selectedCityId);
    if (!city) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setViewState((prev) => ({
      ...prev,
      longitude: city.longitude,
      latitude: city.latitude,
      zoom: Math.max(prev.zoom, 7),
      pitch: 55,
      bearing: 0,
      transitionDuration: 800,
    }));
  }, [selectedCityId]);

  // Build MapDataPoint array for the layers.
  const points: MapDataPoint[] = useMemo(() => {
    return cities
      .filter((c) => typeof c.latitude === "number")
      .map((c) => ({
        id: c.cityId,
        cityId: c.cityId,
        name: c.cityName,
        state: c.state,
        latitude: c.latitude,
        longitude: c.longitude,
        temperatureC: c.current?.temperatureC,
        rainfallMm: c.current?.precipitationMm,
        heavyRainProbability: c.heavyRainProbability,
        floodProbability: c.floodProbability,
        inundationDepthM: c.inundationDepthM,
        riskLevel: c.riskLevel ?? "LOW",
        weatherCode: c.current?.weatherCode,
        source: c.source,
        observedAt: c.fetchedAt,
        isDevData: c.isDevData,
      }));
  }, [cities]);

  // 3D column layer: height ~ inundation depth, but with a min so even LOW
  // risk cities render a visible column. Colour matches the risk bucket.
  const columnLayer = useMemo(() => {
    return new ColumnLayer({
      id: "inundation-columns",
      data: points,
      diskResolution: 16,
      radius: 18000,
      extruded: true,
      elevationScale: 80000,
      getPosition: (d: MapDataPoint) => [d.longitude, d.latitude],
      getElevation: (d: MapDataPoint) =>
        Math.max(0.1, (d.inundationDepthM ?? 0.1)) * 2,
      getFillColor: (d: MapDataPoint) => {
        const hex = riskColor(d.riskLevel ?? "LOW");
        return hexToRgba(hex, 220);
      },
      getLineColor: [0, 0, 0, 180],
      stroked: true,
      pickable: true,
      onHover: (info: { x: number; y: number; object?: MapDataPoint }) => {
        if (info.object) {
          setHover({ x: info.x, y: info.y, city: info.object });
        } else {
          setHover(null);
        }
      },
      onClick: (info: { object?: MapDataPoint }) => {
        if (info.object?.cityId) {
          onSelect?.(info.object.cityId);
        }
      },
      updateTriggers: {
        getFillColor: points.map((p) => p.riskLevel).join(","),
        getElevation: points.map((p) => p.inundationDepthM).join(","),
      },
    });
  }, [points, onSelect]);

  // Text layer for city labels — only at zoom ≥ 4 to avoid clutter.
  const textLayer = useMemo(() => {
    return new TextLayer({
      id: "city-labels",
      data: points,
      getPosition: (d: MapDataPoint) => [d.longitude, d.latitude],
      getText: (d: MapDataPoint) => d.name,
      getColor: [255, 255, 255, 230],
      getSize: 13,
      getSizeWithZoom: true,
      getAngle: 0,
      getTextAnchor: "middle",
      getAlignmentBaseline: "top",
      getPixelOffset: [0, 14],
      outline: true,
      outlineColor: [0, 0, 0, 200],
      outlineWidth: 2,
      pickable: false,
    });
  }, [points]);

  // OpenStreetMap dark raster basemap via TileLayer + BitmapLayer.
  // Using OSM standard tiles — free, no API key required.
  const tileLayer = useMemo(() => {
    return new TileLayer({
      id: "osm-basemap",
      data: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      minZoom: 0,
      maxZoom: 19,
      tileSize: 256,
      opacity: 0.7,
      renderSubLayers: (props: TileLayerRenderContext) => {
        const { bbox } = props.tile;
        return new BitmapLayer(props, {
          data: null,
          image: props.data,
          bounds: [bbox.west, bbox.south, bbox.east, bbox.north],
          textureParameters: {
            [10241]: 9729, // GL.LINEAR
            [10240]: 9729,
          },
        });
      },
    });
  }, []);

  const layers: Layer[] = [tileLayer, columnLayer, textLayer];

  return (
    <Card className="overflow-hidden p-0">
      <div className="relative w-full" style={{ height, minHeight: height }}>
        <DeckGL
          views={[new MapView({ repeat: true })]}
          viewState={viewState}
          controller={true}
          layers={layers}
          onViewStateChange={(e: { viewState: ViewState }) =>
            setViewState(e.viewState)
          }
          style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", background: "#0a0e1a" }}
        />

        {/* Hover tooltip */}
        {hover && (
          <div
            className="pointer-events-none absolute z-10 max-w-xs rounded-md border border-border bg-popover p-2 text-xs shadow-lg"
            style={{ left: hover.x + 12, top: hover.y + 12 }}
          >
            <div className="font-semibold text-foreground">
              {hover.city.name}
            </div>
            <div className="text-muted-foreground">{hover.city.state}</div>
            <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5">
              <span className="text-muted-foreground">Temp</span>
              <span>{Math.round(hover.city.temperatureC ?? 0)}°C</span>
              <span className="text-muted-foreground">Rain</span>
              <span>{(hover.city.rainfallMm ?? 0).toFixed(1)} mm</span>
              <span className="text-muted-foreground">Inundation</span>
              <span>
                {((hover.city.inundationDepthM ?? 0) * 100).toFixed(1)} cm
              </span>
              <span className="text-muted-foreground">Flood prob.</span>
              <span>
                {Math.round((hover.city.floodProbability ?? 0) * 100)}%
              </span>
              <span className="text-muted-foreground">Risk</span>
              <span
                className="font-semibold"
                style={{ color: riskColor(hover.city.riskLevel ?? "LOW") }}
              >
                {hover.city.riskLevel ?? "LOW"}
              </span>
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="absolute bottom-3 left-3 z-10 rounded-md border border-border bg-card/90 p-2 text-[10px] backdrop-blur-sm">
          <div className="mb-1 font-semibold text-foreground">Inundation risk</div>
          {(["LOW", "MODERATE", "HIGH", "CRITICAL"] as const).map((lvl) => (
            <div key={lvl} className="flex items-center gap-1.5">
              <span
                className="inline-block size-2.5 rounded-sm"
                style={{ background: riskColor(lvl) }}
              />
              <span className="text-muted-foreground">{lvl}</span>
            </div>
          ))}
        </div>

        {/* Hint */}
        <div className="absolute right-3 top-3 z-10 rounded-md border border-border bg-card/90 px-2 py-1 text-[10px] text-muted-foreground backdrop-blur-sm">
          Click a column to focus · drag to pan · scroll to zoom
        </div>
      </div>
    </Card>
  );
}

/* ---------- helpers ---------- */

function hexToRgba(hex: string, alpha: number): [number, number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [128, 128, 128, alpha];
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
}


