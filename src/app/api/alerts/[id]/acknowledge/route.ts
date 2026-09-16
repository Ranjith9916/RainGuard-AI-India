/**
 * POST /api/alerts/[id]/acknowledge
 *
 * Marks an alert as acknowledged. The `id` path parameter may be either the
 * row primary key (cuid) or the deterministic `alertId` (e.g.
 * "chennai-WARNING-2025-09-09T03") — both are supported.
 *
 * Request body (all optional):
 *   - acknowledgedBy (string) — operator name / user id
 *
 * On success the alert row's `status` is set to "acknowledged",
 * `acknowledgedAt` to now and `acknowledgedBy` to the supplied value.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/config/logger";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
  const id = (rawId ?? "").trim();

  if (!id) {
    return NextResponse.json(
      { ok: false, error: "Missing alert id in path" },
      { status: 400 },
    );
  }

  let body: { acknowledgedBy?: string } = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text) as { acknowledgedBy?: string };
  } catch {
    // Body is optional — ignore parse errors.
  }

  const acknowledgedBy = (body.acknowledgedBy ?? "operator").slice(0, 120);
  const acknowledgedAt = new Date();

  try {
    // Resolve the alert by either primary key (cuid) or alertId field.
    const alert =
      (await db.alert.findUnique({ where: { id } })) ??
      (await db.alert.findUnique({ where: { alertId: id } }));

    if (!alert) {
      return NextResponse.json(
        {
          ok: false,
          error: `Alert not found for id '${id}'`,
        },
        { status: 404 },
      );
    }

    const updated = await db.alert.update({
      where: { id: alert.id },
      data: {
        status: "acknowledged",
        acknowledgedAt,
        acknowledgedBy,
      },
    });

    logger.info("api.alerts.acknowledge.ok", {
      alertId: updated.alertId,
      acknowledgedBy,
    });

    return NextResponse.json({
      ok: true,
      alert: updated,
    });
  } catch (err) {
    logger.error("api.alerts.acknowledge.error", {
      id,
      error: (err as Error).message,
    });
    return NextResponse.json(
      {
        ok: false,
        id,
        error: (err as Error).message,
      },
      { status: 500 },
    );
  }
}
