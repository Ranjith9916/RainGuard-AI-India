/**
 * GET /api/flood-detection/regions
 *
 * Returns the static INDIA_FLOOD_REGIONS registry — the 8 flood-prone
 * regions used as SAR-monitoring targets. Each region includes its bbox,
 * risk note and keyCities so the dashboard can render the region picker.
 *
 * Query params:
 *   - q (optional) — case-insensitive substring search against the name
 */

import { NextResponse } from "next/server";
import { INDIA_FLOOD_REGIONS } from "@/lib/flood-detection/india-regions";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();

  const regions = q
    ? INDIA_FLOOD_REGIONS.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.id.toLowerCase().includes(q) ||
          r.states.some((s) => s.toLowerCase().includes(q)),
      )
    : INDIA_FLOOD_REGIONS;

  return NextResponse.json({
    ok: true,
    count: regions.length,
    regions: regions.map((r) => ({
      id: r.id,
      name: r.name,
      states: r.states,
      latitude: r.latitude,
      longitude: r.longitude,
      bbox: r.bbox,
      riskNote: r.riskNote,
      keyCities: r.keyCities,
      placeNames: r.placeNames,
    })),
  });
}
