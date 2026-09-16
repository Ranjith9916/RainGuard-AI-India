import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/config/logger";
import { CITIES } from "@/lib/weather/cities";

export const dynamic = "force-dynamic";

/**
 * POST /api/alerts/seed-demo
 *
 * Creates realistic demo flood alerts for demonstration purposes.
 * Generates alerts at various severity levels across multiple Indian cities
 * so the Alerts tab shows a full-spectrum warning dashboard.
 */

interface DemoAlertSpec {
  cityId: string;
  level: "INFO" | "WATCH" | "ADVISORY" | "WARNING" | "SEVERE_WARNING" | "EMERGENCY";
  floodProb: number;
  rainfall: number;
  inundation: number;
  reason: string;
  action: string;
}

const DEMO_ALERTS: DemoAlertSpec[] = [
  {
    cityId: "guwahati",
    level: "EMERGENCY",
    floodProb: 0.92,
    rainfall: 184.5,
    inundation: 1.85,
    reason:
      "Brahmaputra river at 87.3m (danger level 85.2m). IMERG satellite rainfall: 184.5mm in 24h. " +
      "5 districts submerged. NDRF teams deployed. This is a life-threatening situation.",
    action:
      "EMERGENCY EVACUATION: Deploy NDRF boat units immediately. Evacuate all low-lying areas within 5km of Brahmaputra. " +
      "Open relief camps at Guwahati Medical College, Nehru Stadium. Issue SMS alerts to all mobile numbers in Kamrup district.",
  },
  {
    cityId: "patna",
    level: "SEVERE_WARNING",
    floodProb: 0.78,
    rainfall: 142.2,
    inundation: 1.12,
    reason:
      "Kosi river embankment breach risk. 142.2mm rainfall in 24h. Ganga water level rising at Gandhi Ghat. " +
      "FMCG supply chain disrupted. Hospitals on backup power.",
    action:
      "SEVERE: Pre-position NDRF teams at Kosi embankment. Issue Red-alert advisory. " +
      "Evacuate villages in Supaul, Saharsa, Madhepura. Stockpile dry rations and drinking water.",
  },
  {
    cityId: "kolkata",
    level: "WARNING",
    floodProb: 0.65,
    rainfall: 98.7,
    inundation: 0.85,
    reason:
      "Hooghly river above warning mark. 98.7mm rainfall in 24h. Low-lying areas in Howrah, Salt Lake inundated. " +
      "Drainage pumping stations operating at maximum capacity.",
    action:
      "Activate arterial road diversions. Deploy NDRF teams to low-lying zones. Issue Red-alert advisory. " +
      "Monitor river levels hourly. Pre-position pumps at Behala, Garden Reach.",
  },
  {
    cityId: "mumbai",
    level: "WARNING",
    floodProb: 0.58,
    rainfall: 87.3,
    inundation: 0.72,
    reason:
      "Mithi river crossing 3.5m mark. 87.3mm rainfall in 6 hours. Low-lying areas in Sion, Kurla, Andheri submerged. " +
      "Suburban train services partially suspended on Central line.",
    action:
      "Deploy NDRF teams to Sion, Kurla. Issue public advisory on water-logged routes. " +
      "Pre-position mobile pumps at Andheri subway. Monitor Mithi river level continuously.",
  },
  {
    cityId: "chennai",
    level: "ADVISORY",
    floodProb: 0.42,
    rainfall: 56.8,
    inundation: 0.38,
    reason:
      "Cooum and Adyar rivers rising. 56.8mm rainfall in 12h. Water-logging reported in Velachery, Tambaram. " +
      "Cyclonic circulation over Bay of Bengal expected to intensify.",
    action:
      "Issue public advisory on water-logged routes. Increase NDRF alertness to Yellow. " +
      "Brief field teams. Pre-position mobile pumps at known bottlenecks.",
  },
  {
    cityId: "bhubaneswar",
    level: "ADVISORY",
    floodProb: 0.38,
    rainfall: 48.2,
    inundation: 0.32,
    reason:
      "Mahanadi river at 22.8m (warning: 23m). 48.2mm rainfall in 24h. Cyclone system forming in Bay of Bengal. " +
      "Coastal districts on alert. IMD has issued a cyclone watch.",
    action:
      "Issue public advisory. Pre-position disaster relief supplies. Alert district administration. " +
      "Monitor river and drain levels continuously.",
  },
  {
    cityId: "hyderabad",
    level: "WATCH",
    floodProb: 0.28,
    rainfall: 35.6,
    inundation: 0.22,
    reason:
      "Hussain Sagar lake at FRL (Full Reservoir Level). 35.6mm rainfall in 6h. " +
      "Mus river crossing 2.5m. Low-lying areas in Old City experiencing water-logging.",
    action:
      "Continue real-time sensor monitoring. Brief local emergency coordinators. " +
      "Advise public to stay weather-informed. Check drainage and flood barriers.",
  },
  {
    cityId: "surat",
    level: "WATCH",
    floodProb: 0.25,
    rainfall: 31.4,
    inundation: 0.18,
    reason:
      "Tapi river at 32.5m (warning: 33m). 31.4mm rainfall in 24h. " +
      "Tidal surge from Gulf of Khambat expected. Narmada dam releases at 2.5 lakh cusecs.",
    action:
      "Continue real-time sensor monitoring. Brief local emergency coordinators. " +
      "Advise public to stay weather-informed. Check drainage and flood barriers.",
  },
  {
    cityId: "delhi",
    level: "INFO",
    floodProb: 0.15,
    rainfall: 18.2,
    inundation: 0.08,
    reason:
      "Yamuna river at 204.5m (warning: 205m). 18.2mm rainfall in 24h. " +
      "Normal monsoon conditions. No immediate flooding risk but situation being monitored.",
    action: "Continue routine monitoring. Verify drainage pump availability.",
  },
  {
    cityId: "jaipur",
    level: "INFO",
    floodProb: 0.10,
    rainfall: 8.5,
    inundation: 0.04,
    reason:
      "Light rainfall (8.5mm in 24h). Dravyavati river at normal levels. " +
      "No flooding risk. Urban drainage systems operating normally.",
    action: "Continue routine monitoring. Verify drainage pump availability.",
  },
];

export async function POST() {
  const results: Array<{ city: string; level: string; created: boolean; alertId: string }> = [];

  for (const spec of DEMO_ALERTS) {
    const city = CITIES.find((c) => c.id === spec.cityId);
    if (!city) {
      results.push({
        city: spec.cityId,
        level: spec.level,
        created: false,
        alertId: "",
      });
      continue;
    }

    // Use a fixed timestamp suffix for dedup so re-seeding doesn't create duplicates
    const hourBucket = new Date().toISOString().slice(0, 13);
    const alertId = `demo-${spec.cityId}-${spec.level}-${hourBucket}`;

    try {
      // Check if already exists (idempotent)
      const existing = await db.alert.findUnique({ where: { alertId } });
      if (existing) {
        results.push({
          city: city.name,
          level: spec.level,
          created: false,
          alertId,
        });
        continue;
      }

      await db.alert.create({
        data: {
          alertId,
          level: spec.level,
          status: "active",
          title: `${spec.level} — ${city.name} Flood Alert`,
          cityId: city.id,
          latitude: city.latitude,
          longitude: city.longitude,
          locationName: `${city.name}, ${city.state}`,
          reason: spec.reason,
          expectedRainfallMm: spec.rainfall,
          floodProbability: spec.floodProb,
          expectedInundationM: spec.inundation,
          recommendedAction: spec.action,
        },
      });

      results.push({
        city: city.name,
        level: spec.level,
        created: true,
        alertId,
      });
    } catch (err) {
      logger.error("alerts.seed-demo", `Failed for ${city.name}`, {
        error: err instanceof Error ? err.message : "unknown",
      });
      results.push({
        city: city.name,
        level: spec.level,
        created: false,
        alertId,
      });
    }
  }

  const createdCount = results.filter((r) => r.created).length;

  return NextResponse.json({
    status: "ok",
    message: `Seeded ${createdCount} new demo flood alerts (${DEMO_ALERTS.length} total)`,
    created: createdCount,
    total: DEMO_ALERTS.length,
    alerts: results,
    generatedAt: new Date().toISOString(),
  });
}

/**
 * GET /api/alerts/seed-demo
 * Returns the demo alert specifications without creating them.
 */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    message: "POST to this endpoint to seed demo flood alerts",
    count: DEMO_ALERTS.length,
    specs: DEMO_ALERTS.map((s) => {
      const city = CITIES.find((c) => c.id === s.cityId);
      return {
        city: city?.name ?? s.cityId,
        level: s.level,
        floodProb: s.floodProb,
        rainfall: s.rainfall,
        inundation: s.inundation,
        reason: s.reason.slice(0, 80) + "...",
      };
    }),
  });
}
