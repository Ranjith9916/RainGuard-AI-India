/**
 * GET /api/models/training-metrics
 *
 * Returns the latest per-model training metrics from the `ModelMetric`
 * table. Metrics are grouped by model so the dashboard can render a
 * side-by-side comparison panel.
 *
 * Query params:
 *   - modelName (optional) — filter to a single model
 *   - split (optional) — filter to a split (train/val/test)
 *
 * Because every model in the baseline build is a baseline (no learned
 * weights), the DB rows will typically be empty — the route therefore
 * also returns a static "placeholder metrics" block per model so the
 * dashboard can render the panel shape on a fresh DB.
 */

import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ML_MODELS } from "@/lib/config/config";
import { logger } from "@/lib/config/logger";

export const dynamic = "force-dynamic";

type DbMetricWithModel = Prisma.ModelMetricGetPayload<{
  include: { model: true };
}>;

const PLACEHOLDER_METRICS: Record<
  string,
  Array<{ metricName: string; metricValue: number; split: string }>
> = {
  heavyRain: [
    { metricName: "accuracy", metricValue: 0.78, split: "validation" },
    { metricName: "precision", metricValue: 0.65, split: "validation" },
    { metricName: "recall", metricValue: 0.71, split: "validation" },
    { metricName: "f1", metricValue: 0.68, split: "validation" },
    { metricName: "brier_score", metricValue: 0.21, split: "validation" },
  ],
  rainfallForecast: [
    { metricName: "rmse_mm", metricValue: 12.4, split: "validation" },
    { metricName: "mae_mm", metricValue: 8.1, split: "validation" },
    { metricName: "bias_mm", metricValue: -1.3, split: "validation" },
  ],
  floodProbability: [
    { metricName: "auc_roc", metricValue: 0.81, split: "validation" },
    { metricName: "brier_score", metricValue: 0.18, split: "validation" },
    { metricName: "log_loss", metricValue: 0.52, split: "validation" },
  ],
  inundation: [
    { metricName: "rmse_depth_m", metricValue: 0.14, split: "validation" },
    { metricName: "mae_depth_m", metricValue: 0.09, split: "validation" },
    { metricName: "iou", metricValue: 0.46, split: "validation" },
  ],
  sarFlood: [
    { metricName: "iou", metricValue: 0.0, split: "validation" },
    { metricName: "f1", metricValue: 0.0, split: "validation" },
  ],
  cloudburst: [
    { metricName: "pod", metricValue: 0.42, split: "validation" },
    { metricName: "far", metricValue: 0.31, split: "validation" },
    { metricName: "csi", metricValue: 0.34, split: "validation" },
  ],
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const modelName = (url.searchParams.get("modelName") ?? "").trim();
  const split = (url.searchParams.get("split") ?? "").trim();

  // Pull persisted metrics from DB.
  const where: { metricName?: string; split?: string } = {};
  if (split) where.split = split;
  // Note: ModelMetric does not have a modelName column directly — it's
  // joined via modelId. For the simple list view we fetch all and group
  // in JS.
  let dbMetrics: DbMetricWithModel[] = [];
  try {
    dbMetrics = await db.modelMetric.findMany({
      where,
      orderBy: { evaluatedAt: "desc" },
      take: 1000,
      include: { model: true },
    });
  } catch (err) {
    logger.warn("api.models.training-metrics.db-unavailable", {
      error: (err as Error).message,
    });
  }

  // Group DB metrics by model key (matching the static registry).
  const dbByKey: Record<string, DbMetricWithModel[]> = {};
  for (const m of dbMetrics) {
    const key = Object.entries(ML_MODELS).find(
      ([, entry]) =>
        entry.name === m.model.modelName &&
        entry.version === m.model.modelVersion,
    )?.[0];
    if (!key) continue;
    if (modelName && key !== modelName) continue;
    if (!dbByKey[key]) dbByKey[key] = [];
    dbByKey[key].push(m);
  }

  // Build the per-model response, falling back to placeholder metrics
  // when the DB has none.
  const byModel = Object.entries(ML_MODELS)
    .filter(([key]) => !modelName || key === modelName)
    .map(([key, entry]) => {
      const dbRows = dbByKey[key] ?? [];
      const metrics =
        dbRows.length > 0
          ? dbRows.map((r) => ({
              metricName: r.metricName,
              metricValue: r.metricValue,
              split: r.split,
              evaluatedAt: r.evaluatedAt,
              notes: r.notes,
              source: "db",
            }))
          : (PLACEHOLDER_METRICS[key] ?? []).map((m) => ({
              ...m,
              source: "placeholder",
            }));

      return {
        key,
        name: entry.name,
        version: entry.version,
        type: entry.type,
        isBaseline: entry.isBaseline,
        isTrainedOnLabels: entry.isTrainedOnLabels,
        description: entry.description,
        metricCount: metrics.length,
        metrics,
      };
    });

  return NextResponse.json({
    ok: true,
    count: byModel.length,
    byModel,
    filters: { modelName, split },
  });
}
