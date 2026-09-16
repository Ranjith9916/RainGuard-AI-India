/**
 * GET /api/models
 *
 * Returns the ML model registry — the static `ML_MODELS` config that
 * describes every baseline / ML / ONNX model used by the pipeline.
 *
 * Each entry is honestly tagged with `isBaseline` and `isTrainedOnLabels`
 * so consumers can never confuse a baseline for a learned model.
 *
 * If the DB-backed `ModelRegistry` table has rows, they are merged in
 * (DB rows take precedence for fields that exist in both).
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ML_MODELS } from "@/lib/config/config";
import { logger } from "@/lib/config/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  const staticModels = Object.entries(ML_MODELS).map(([key, entry]) => ({
    key,
    name: entry.name,
    version: entry.version,
    type: entry.type,
    artifactPath: (entry as { artifactPath?: string }).artifactPath,
    isBaseline: entry.isBaseline,
    isTrainedOnLabels: entry.isTrainedOnLabels,
    description: entry.description,
    source: "static-registry",
  }));

  let dbModels: Awaited<ReturnType<typeof db.modelRegistry.findMany>> = [];
  try {
    dbModels = await db.modelRegistry.findMany({
      orderBy: { modelName: "asc" },
    });
  } catch (err) {
    logger.warn("api.models.db-registry-unavailable", {
      error: (err as Error).message,
    });
  }

  const dbByKey: Record<string, (typeof dbModels)[number]> = {};
  for (const m of dbModels) {
    const key = staticModels.find(
      (s) => s.name === m.modelName && s.version === m.modelVersion,
    )?.key;
    if (key) dbByKey[key] = m;
  }

  const merged = staticModels.map((s) => {
    const dbRow = dbByKey[s.key];
    if (!dbRow) return { ...s, dbRow: null };
    return {
      ...s,
      // DB rows override the static registry for persisted fields.
      isBaseline: dbRow.isBaseline,
      isTrainedOnLabels: dbRow.isTrainedOnLabels,
      artifactPath: dbRow.artifactPath ?? s.artifactPath,
      trainedAt: dbRow.trainedAt,
      trainingDatasetVersion: dbRow.trainingDatasetVersion,
      featureVersion: dbRow.featureVersion,
      notes: dbRow.notes,
      dbRow: {
        id: dbRow.id,
        modelName: dbRow.modelName,
        modelVersion: dbRow.modelVersion,
        modelType: dbRow.modelType,
      },
    };
  });

  return NextResponse.json({
    ok: true,
    count: merged.length,
    models: merged,
    // Also surface the raw static registry for callers that want the
    // exact config without DB enrichment.
    staticRegistry: ML_MODELS,
  });
}
