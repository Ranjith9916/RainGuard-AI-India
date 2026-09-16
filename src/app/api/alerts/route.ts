/**
 * GET /api/alerts
 *
 * Paginated list of all alerts (active + acknowledged + expired).
 *
 * Query params:
 *   - page (optional, default 1) — 1-indexed page number
 *   - pageSize (optional, default 50) — page size (max 200)
 *   - level (optional) — filter by alert level (INFO/WATCH/ADVISORY/WARNING/SEVERE_WARNING/EMERGENCY)
 *   - status (optional) — filter by status (active/acknowledged/expired)
 *   - cityId (optional) — filter by city
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/config/logger";
import { ALERT_LEVELS } from "@/lib/alerts/engine";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const pageParam = Number(url.searchParams.get("page") ?? "1");
  const pageSizeParam = Number(url.searchParams.get("pageSize") ?? "50");
  const level = (url.searchParams.get("level") ?? "").trim().toUpperCase();
  const status = (url.searchParams.get("status") ?? "").trim().toLowerCase();
  const cityId = (url.searchParams.get("cityId") ?? "").trim().toLowerCase();

  const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;
  const pageSize =
    Number.isFinite(pageSizeParam) && pageSizeParam > 0
      ? Math.min(Math.floor(pageSizeParam), 200)
      : 50;

  const where: {
    level?: string;
    status?: string;
    cityId?: string;
  } = {};
  if (level && (ALERT_LEVELS as readonly string[]).includes(level)) {
    where.level = level;
  }
  if (status && ["active", "acknowledged", "expired"].includes(status)) {
    where.status = status;
  }
  if (cityId) {
    where.cityId = cityId;
  }

  try {
    const [total, alerts] = await Promise.all([
      db.alert.count({ where }),
      db.alert.findMany({
        where,
        orderBy: { triggeredAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return NextResponse.json({
      ok: true,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      filters: { level, status, cityId },
      alerts,
    });
  } catch (err) {
    logger.error("api.alerts.list.error", { error: (err as Error).message });
    return NextResponse.json(
      {
        ok: false,
        error: (err as Error).message,
        page,
        pageSize,
        total: 0,
        alerts: [],
      },
      { status: 500 },
    );
  }
}
