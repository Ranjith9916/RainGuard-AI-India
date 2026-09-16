/**
 * GET /api/flood-detection/detect?regionId=&model=
 *
 * Runs SAR-based flood detection for a region from the INDIA_FLOOD_REGIONS
 * registry. The endpoint synthesises a SAR patch (deterministic in lat/lon)
 * and runs the configured inferencer over it — see the SyntheticSarProvider
 * doc-comment for why the baseline build synthesises rather than downloads.
 *
 * Query params:
 *   - regionId (required) — one of INDIA_FLOOD_REGIONS ids
 *   - model (optional) — "threshold" (default) or "etci-unet"
 *
 * The response carries the flood fraction, the inferencer method used
 * (and whether it fell back), plus a serialised summary of the mask so
 * the dashboard can render a coarse heatmap without pulling binary data.
 */

import { NextResponse } from "next/server";
import { INDIA_FLOOD_REGIONS, getRegionById } from "@/lib/flood-detection/india-regions";
import { SyntheticSarProvider } from "@/lib/adapters/sentinel1/sentinel1.provider";
import {
  ETCIUnetInferencer,
  ThresholdBaselineInferencer,
} from "@/lib/adapters/flood-model/flood-inferencer";
import { logger } from "@/lib/config/logger";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const regionId = (url.searchParams.get("regionId") ?? "").trim().toLowerCase();
  const modelParam = (url.searchParams.get("model") ?? "").trim().toLowerCase();

  if (!regionId) {
    return NextResponse.json(
      {
        ok: false,
        error: "Missing 'regionId' query parameter",
        knownRegionIds: INDIA_FLOOD_REGIONS.map((r) => r.id),
      },
      { status: 400 },
    );
  }

  const region = getRegionById(regionId);
  if (!region) {
    return NextResponse.json(
      {
        ok: false,
        error: `Unknown regionId '${regionId}'`,
        knownRegionIds: INDIA_FLOOD_REGIONS.map((r) => r.id),
      },
      { status: 404 },
    );
  }

  const useEtci = modelParam === "etci-unet" || modelParam === "etci";
  const inferencer = useEtci
    ? new ETCIUnetInferencer()
    : new ThresholdBaselineInferencer();

  const provider = new SyntheticSarProvider(inferencer);

  try {
    const result = await provider.detectFlood({
      latitude: region.latitude,
      longitude: region.longitude,
      lookbackDays: 12,
      timeoutMs: 20000,
    });

    // Build a coarse ASCII summary of the mask (downsampled to 16x16) so
    // the response stays JSON-friendly.
    const downsample = 16;
    const summary: string[] = [];
    if (result.maskWidth > 0 && result.maskHeight > 0) {
      const sx = Math.max(1, Math.floor(result.maskWidth / downsample));
      const sy = Math.max(1, Math.floor(result.maskHeight / downsample));
      for (let y = 0; y < result.maskHeight; y += sy) {
        let row = "";
        for (let x = 0; x < result.maskWidth; x += sx) {
          const idx = y * result.maskWidth + x;
          row += result.mask[idx] ? "#" : ".";
        }
        summary.push(row);
      }
    }

    return NextResponse.json({
      ok: true,
      region: {
        id: region.id,
        name: region.name,
        states: region.states,
        latitude: region.latitude,
        longitude: region.longitude,
        bbox: region.bbox,
        riskNote: region.riskNote,
        keyCities: region.keyCities,
      },
      detection: {
        source: result.source,
        productName: result.productName,
        acquisitionTime: result.acquisitionTime,
        method: result.method,
        requestedModel: useEtci ? "etci-unet" : "threshold",
        fellBack: useEtci && result.method === "threshold",
        floodFraction: result.floodFraction,
        maskWidth: result.maskWidth,
        maskHeight: result.maskHeight,
        maskSummary: summary,
        isDevData: result.isDevData,
      },
      inferencer: {
        name: inferencer.name,
        isBaseline: inferencer.isBaseline,
      },
    });
  } catch (err) {
    logger.error("api.flood-detection.detect.error", {
      regionId,
      error: (err as Error).message,
    });
    return NextResponse.json(
      {
        ok: false,
        regionId,
        error: (err as Error).message,
      },
      { status: 500 },
    );
  }
}
