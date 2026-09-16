/**
 * GET /api/alerts/active
 *
 * Returns all currently-active alerts (status = "active"), ordered by
 * severity (most severe first) then by triggeredAt desc. Used by the
 * dashboard's alert banner.
 *
 * No pagination — active alerts are bounded by the dedup window and
 * expected to be a few dozen at most.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/config/logger";
import { ALERT_LEVELS } from "@/lib/alerts/engine";

export const dynamic = "force-dynamic";

// Higher rank = more severe — used to order the response.
const LEVEL_RANK: Record<string, number> = {
  EMERGENCY: 5,
  SEVERE_WARNING: 4,
  WARNING: 3,
  ADVISORY: 2,
  WATCH: 1,
  INFO: 0,
};

export async function GET() {
  try {
    const alerts = await db.alert.findMany({
      where: { status: "active" },
      orderBy: [{ triggeredAt: "desc" }],
      take: 500,
    });

    const sorted = [...alerts].sort((a, b) => {
      const ra = LEVEL_RANK[a.level] ?? 0;
      const rb = LEVEL_RANK[b.level] ?? 0;
      if (rb !== ra) return rb - ra;
      return (
        new Date(b.triggeredAt).getTime() - new Date(a.triggeredAt).getTime()
      );
    });

    // Count per level for the dashboard summary chips.
    const byLevel: Record<string, number> = {};
    for (const level of ALERT_LEVELS) byLevel[level] = 0;
    for (const a of sorted) {
      byLevel[a.level] = (byLevel[a.level] ?? 0) + 1;
    }

    return NextResponse.json({
      ok: true,
      count: sorted.length,
      byLevel,
      alerts: sorted,
      knownLevels: ALERT_LEVELS,
    });
  } catch (err) {
    logger.error("api.alerts.active.error", {
      error: (err as Error).message,
    });
    return NextResponse.json(
      {
        ok: false,
        count: 0,
        byLevel: {},
        alerts: [],
        error: (err as Error).message,
      },
      { status: 500 },
    );
  }
}
