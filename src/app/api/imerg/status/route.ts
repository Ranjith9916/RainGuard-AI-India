/**
 * GET /api/imerg/status
 *
 * Returns the GPM IMERG satellite provider status — whether Earthdata
 * credentials are configured, whether the auth probe succeeded, the
 * active fallback strategy, and the registry-level provider info.
 *
 * This endpoint does NOT issue a network probe (the provider caches its
 * own probe for 5 minutes); it just surfaces what the registry knows.
 */

import { NextResponse } from "next/server";
import { PROVIDERS, CACHE_TTL } from "@/lib/config/config";
import { providerRegistry } from "@/lib/adapters/registry";
import { logger } from "@/lib/config/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  const satelliteProvider = providerRegistry.getSatelliteProvider();
  const credentialsConfigured =
    Boolean(PROVIDERS.satellite.earthdataUser) &&
    Boolean(PROVIDERS.satellite.earthdataPass);

  // The GPM IMERG provider is only used when credentials are set; otherwise
  // the registry resolves the Open-Meteo satellite adapter.
  const activeProvider = satelliteProvider?.info ?? null;

  let providerKind: "gpm-imerg" | "open-meteo-fallback" | "disabled" = "disabled";
  if (activeProvider) {
    if (activeProvider.name === "gpm-imerg") providerKind = "gpm-imerg";
    else providerKind = "open-meteo-fallback";
  }

  try {
    return NextResponse.json({
      ok: true,
      provider: {
        kind: providerKind,
        info: activeProvider,
        credentialsConfigured,
        fallbackToOpenMeteo: PROVIDERS.satellite.fallbackToOpenMeteo,
        enabled: PROVIDERS.satellite.enabled,
        imergUrl: PROVIDERS.satellite.imergUrl,
        cacheTtlSeconds: CACHE_TTL.satellite.imerg,
        notes:
          "Auth-probe result is cached inside the provider for 5 minutes — call /api/imerg/rainfall to force a fresh probe.",
      },
      registrySnapshot: providerRegistry.snapshot(),
    });
  } catch (err) {
    logger.error("api.imerg.status.error", { error: (err as Error).message });
    return NextResponse.json(
      {
        ok: false,
        error: (err as Error).message,
        provider: { kind: providerKind, credentialsConfigured },
      },
      { status: 500 },
    );
  }
}
