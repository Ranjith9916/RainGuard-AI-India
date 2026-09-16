/**
 * GET /api/risk/history?hours=
 *
 * Returns the most recent FloodPrediction rows persisted to the DB,
 * bucketed by city. Useful for the dashboard's history sparkline that
 * shows risk-level evolution over the last N hours.
 *
 * Query params:
 *   - hours (optional, default = 24) — lookback window
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/config/logger";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const hoursParam = Number(url.searchParams.get("hours") ?? "24");
  const hours =
    Number.isFinite(hoursParam) && hoursParam > 0 && hoursParam <= 24 * 30
      ? Math.floor(hoursParam)
      : 24;

  const since = new Date(Date.now() - hours * 3600 * 1000);

  try {
    const predictions = await db.floodPrediction.findMany({
      where: { predictionTime: { gte: since } },
      orderBy: { predictionTime: "desc" },
      take: 1000,
    });

    // Group by cityId for easier UI consumption.
    const byCity: Record<
      string,
      Array<{
        id: string;
        predictionTime: Date;
        validTime: Date;
        horizonMinutes: number;
        heavyRainProbability: number | null;
        forecastRainfallMm: number | null;
        floodProbability: number | null;
        riskLevel: string | null;
        inundationDepthM: number | null;
        combinedRiskLevel?: string | null;
        modelName: string;
        modelVersion: string;
      }>
    > = {};

    for (const p of predictions) {
      const key = p.cityId ?? "unknown";
      if (!byCity[key]) byCity[key] = [];
      byCity[key].push({
        id: p.id,
        predictionTime: p.predictionTime,
        validTime: p.validTime,
        horizonMinutes: p.horizonMinutes,
        heavyRainProbability: p.heavyRainProbability,
        forecastRainfallMm: p.forecastRainfallMm,
        floodProbability: p.floodProbability,
        riskLevel: p.riskLevel,
        inundationDepthM: p.inundationDepthM,
        modelName: p.modelName,
        modelVersion: p.modelVersion,
      });
    }

    const counts = Object.fromEntries(
      Object.entries(byCity).map(([k, v]) => [k, v.length]),
    );

    return NextResponse.json({
      ok: true,
      hours,
      since,
      totalPredictions: predictions.length,
      perCityCounts: counts,
      byCity,
      latest: predictions[0] ?? null,
    });
  } catch (err) {
    logger.error("api.risk.history.error", {
      error: (err as Error).message,
    });
    return NextResponse.json(
      {
        ok: false,
        hours,
        since,
        error: (err as Error).message,
        byCity: {},
        totalPredictions: 0,
      },
      { status: 500 },
    );
  }
}
