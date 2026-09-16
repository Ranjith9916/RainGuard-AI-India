/**
 * GET /api/system/status
 *
 * Returns a system health snapshot suitable for a dashboard top-bar:
 *   - DB health (can we connect + how many core rows exist?)
 *   - Active provider configuration (which APIs are wired up)
 *   - Last pipeline run (timestamp + counts)
 *   - Active alert count
 *
 * This route is intentionally cheap so it can be polled every few seconds
 * without back-pressuring the upstream weather APIs.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { PROVIDERS, SYSTEM, ML_MODELS } from "@/lib/config/config";
import { activeProviderName } from "@/lib/weather/unified-fetch";
import { providerRegistry } from "@/lib/adapters/registry";
import { logger } from "@/lib/config/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = new Date().toISOString();

  // DB health probe — we attempt a couple of cheap aggregates. If the DB is
  // unreachable (e.g. SQLite file missing) we still return 200 with a
  // `degraded` flag so the dashboard can render the partial state.
  let dbHealthy = true;
  let dbError: string | null = null;
  let activeAlertCount = 0;
  let lastPipelineRun: {
    id: string;
    pipelineName: string;
    status: string;
    startedAt: Date;
    finishedAt: Date | null;
    durationMs: number | null;
    recordsValid: number;
    recordsRejected: number;
  } | null = null;

  try {
    activeAlertCount = await db.alert.count({
      where: { status: "active" },
    });
  } catch (err) {
    dbHealthy = false;
    dbError = (err as Error).message;
    logger.warn("system.status.alert-count-failed", { error: dbError });
  }

  try {
    const run = await db.pipelineRun.findFirst({
      orderBy: { startedAt: "desc" },
    });
    if (run) {
      lastPipelineRun = {
        id: run.id,
        pipelineName: run.pipelineName,
        status: run.status,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        durationMs: run.durationMs,
        recordsValid: run.recordsValid,
        recordsRejected: run.recordsRejected,
      };
    }
  } catch (err) {
    dbHealthy = false;
    dbError = dbError ?? (err as Error).message;
    logger.warn("system.status.pipeline-run-failed", {
      error: (err as Error).message,
    });
  }

  // Provider snapshot — pure config, no network calls.
  const providers = {
    weather: {
      type: PROVIDERS.weather.type,
      enabled: PROVIDERS.weather.enabled,
      apiKeyConfigured: Boolean(PROVIDERS.weather.apiKey),
      activeProvider: activeProviderName(),
    },
    satellite: {
      type: PROVIDERS.satellite.type,
      enabled: PROVIDERS.satellite.enabled,
      earthdataConfigured:
        Boolean(PROVIDERS.satellite.earthdataUser) &&
        Boolean(PROVIDERS.satellite.earthdataPass),
      fallbackToOpenMeteo: PROVIDERS.satellite.fallbackToOpenMeteo,
    },
    radar: {
      type: PROVIDERS.radar.type,
      enabled: PROVIDERS.radar.enabled,
    },
    nwp: {
      type: PROVIDERS.nwp.type,
      enabled: PROVIDERS.nwp.enabled,
      model: PROVIDERS.nwp.model,
    },
    registrySnapshot: providerRegistry.snapshot(),
  };

  const modelCount = Object.keys(ML_MODELS).length;

  return NextResponse.json({
    system: {
      name: SYSTEM.name,
      version: SYSTEM.version,
      environment: SYSTEM.environment,
      isDevData: SYSTEM.isDevData,
      timezone: SYSTEM.timezone,
      startedAt,
    },
    db: {
      healthy: dbHealthy,
      error: dbError,
      activeAlertCount,
    },
    providers,
    lastPipelineRun,
    models: {
      registeredCount: modelCount,
      registry: ML_MODELS,
    },
  });
}
