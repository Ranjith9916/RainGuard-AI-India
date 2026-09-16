/**
 * GET /api/pipeline/runs
 *
 * Lists recent PipelineRun rows in reverse-chronological order.
 *
 * Query params:
 *   - limit (optional, default 20) — cap on returned rows (max 100)
 *   - status (optional) — filter by status (running/succeeded/failed)
 *   - pipelineName (optional) — filter by pipeline name
 *
 * POST /api/pipeline/runs
 *
 * Kicks off a fresh prediction-pipeline run synchronously, persists the
 * PipelineRun row + per-city FloodPrediction rows + any emitted Alert rows,
 * and returns the run summary. This is the canonical way to "refresh" the
 * system outside the cron schedule.
 *
 * POST body (all optional):
 *   - pipelineName (string, default "weather-cities-pipeline")
 *   - source (string, default "api")
 *   - persist (boolean, default true)
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/config/logger";
import { runPredictionPipeline } from "@/lib/alerts/pipeline";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limitParam = Number(url.searchParams.get("limit") ?? "20");
  const status = (url.searchParams.get("status") ?? "").trim().toLowerCase();
  const pipelineName = (url.searchParams.get("pipelineName") ?? "").trim();

  const limit =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(Math.floor(limitParam), 100)
      : 20;

  const where: { status?: string; pipelineName?: string } = {};
  if (status) where.status = status;
  if (pipelineName) where.pipelineName = pipelineName;

  try {
    const [total, runs] = await Promise.all([
      db.pipelineRun.count({ where }),
      db.pipelineRun.findMany({
        where,
        orderBy: { startedAt: "desc" },
        take: limit,
      }),
    ]);

    return NextResponse.json({
      ok: true,
      total,
      count: runs.length,
      runs,
    });
  } catch (err) {
    logger.error("api.pipeline.runs.list.error", {
      error: (err as Error).message,
    });
    return NextResponse.json(
      {
        ok: false,
        error: (err as Error).message,
        runs: [],
        total: 0,
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const startedAt = new Date();
  const startMs = Date.now();

  let body: {
    pipelineName?: string;
    source?: string;
    persist?: boolean;
  } = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text) as typeof body;
  } catch {
    // ignore parse errors — fall through to defaults.
  }

  const pipelineName = body.pipelineName ?? "weather-cities-pipeline";
  const source = body.source ?? "api";
  const persist = body.persist !== false;

  // Create the PipelineRun row up-front so we have an id to attach child
  // rows to. Status will be updated to succeeded/failed at the end.
  let pipelineRunId: string | null = null;
  if (persist) {
    try {
      const run = await db.pipelineRun.create({
        data: {
          pipelineName,
          status: "running",
          source,
        },
      });
      pipelineRunId = run.id;
    } catch (err) {
      logger.warn("api.pipeline.runs.create-failed", {
        error: (err as Error).message,
      });
    }
  }

  try {
    const result = await runPredictionPipeline({});

    // Persist per-city predictions + alerts if requested.
    if (persist && pipelineRunId) {
      for (const r of result.results) {
        if (r.error || !r.prediction) continue;
        try {
          await db.floodPrediction.create({
            data: {
              cityId: r.city.id,
              latitude: r.city.latitude,
              longitude: r.city.longitude,
              validTime: new Date(
                Date.now() + r.prediction.rainfallForecast.horizonMinutes * 60000,
              ),
              horizonMinutes: r.prediction.rainfallForecast.horizonMinutes,
              heavyRainProbability: r.prediction.heavyRain.probability,
              heavyRainClass: r.prediction.heavyRain.isHeavy ? "HEAVY" : "NONE",
              heavyRainThreshold: r.prediction.heavyRain.threshold,
              forecastRainfallMm:
                r.prediction.rainfallForecast.forecastRainfallMm,
              floodProbability: r.prediction.floodProbability.probability,
              riskLevel: r.prediction.combinedRiskLevel,
              inundationDepthM: r.prediction.inundation.depthM,
              inundationAreaKm2: r.prediction.inundation.inundationAreaKm2,
              confidence: r.prediction.rainfallForecast.confidence,
              modelVersions: "baseline",
              dataSources: r.payload?.source ?? "unknown",
              modelName: r.prediction.heavyRain.modelName,
              modelVersion: r.prediction.heavyRain.modelVersion,
              isBaseline: r.prediction.allBaselines,
            },
          });
        } catch (err) {
          logger.warn("api.pipeline.runs.flood-prediction-persist-failed", {
            cityId: r.city.id,
            error: (err as Error).message,
          });
        }

        if (r.alert) {
          try {
            await db.alert.upsert({
              where: { alertId: r.alert.alertId },
              create: {
                alertId: r.alert.alertId,
                level: r.alert.level,
                status: "active",
                title: r.alert.title,
                cityId: r.alert.cityId,
                latitude: r.alert.latitude,
                longitude: r.alert.longitude,
                locationName: r.alert.cityName,
                reason: r.alert.reason,
                expectedRainfallMm: r.alert.expectedRainfallMm ?? null,
                floodProbability: r.alert.floodProbability ?? null,
                expectedInundationM: r.alert.expectedInundationM ?? null,
                recommendedAction: r.alert.recommendedAction,
                triggeredAt: new Date(r.alert.triggeredAt),
              },
              update: {},
            });
          } catch (err) {
            logger.warn("api.pipeline.runs.alert-persist-failed", {
              alertId: r.alert.alertId,
              error: (err as Error).message,
            });
          }
        }
      }
    }

    const finishedAt = new Date();
    const durationMs = Date.now() - startMs;

    if (persist && pipelineRunId) {
      try {
        await db.pipelineRun.update({
          where: { id: pipelineRunId },
          data: {
            status: result.citiesFailed === 0 ? "succeeded" : "partial",
            finishedAt,
            durationMs,
            recordsReceived: result.citiesProcessed,
            recordsValid: result.citiesSucceeded,
            recordsRejected: result.citiesFailed,
          },
        });
      } catch (err) {
        logger.warn("api.pipeline.runs.update-failed", {
          error: (err as Error).message,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      pipelineRunId,
      pipelineName,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs,
      citiesProcessed: result.citiesProcessed,
      citiesSucceeded: result.citiesSucceeded,
      citiesFailed: result.citiesFailed,
      alertsEmitted: result.alertsEmitted,
      summary: {
        succeeded: result.citiesSucceeded,
        failed: result.citiesFailed,
        alertsEmitted: result.alertsEmitted,
      },
    });
  } catch (err) {
    logger.error("api.pipeline.runs.post.error", {
      error: (err as Error).message,
    });

    if (persist && pipelineRunId) {
      try {
        await db.pipelineRun.update({
          where: { id: pipelineRunId },
          data: {
            status: "failed",
            finishedAt: new Date(),
            durationMs: Date.now() - startMs,
            errorMessage: (err as Error).message,
          },
        });
      } catch {
        // best-effort
      }
    }

    return NextResponse.json(
      {
        ok: false,
        pipelineRunId,
        error: (err as Error).message,
      },
      { status: 500 },
    );
  }
}
