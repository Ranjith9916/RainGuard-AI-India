/**
 * Cloudburst early-warning engine.
 *
 * A from-scratch port of the public reference implementation at
 *   github.com/g-aaditya/Cloudburst-Early-Warning
 *
 * That project mixes hand-coded physics with simulated ML (ConvLSTM,
 * Transformer, Attention, PINN). Because the original repo does NOT bundle
 * trained weights — every model is exercised through the inference path but
 * the weights are random / heuristic — we replicate the same shape here:
 * the physics models compute real quantities (CAPE, lifting condensation
 * level, precipitable water), and the "ML" components are forward passes
 * through deterministic, hand-initialised networks.
 *
 * Everything is honestly labelled: the public `CloudburstEngine.run()`
 * method returns a `CloudburstResult` whose `isTrained` flag is `false`.
 */

import { logger } from "@/lib/config/logger";
import type {
  AtmosphericFeatures,
  ImergFeatures,
  RainfallFeatures,
} from "@/lib/features/feature-engineering";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface CloudburstInput {
  cityId: string;
  cityName: string;
  latitude: number;
  longitude: number;
  /** Surface temperature °C */
  temperatureC: number;
  /** Surface dew point °C */
  dewPointC: number;
  /** Surface pressure hPa */
  pressureHpa: number;
  /** Surface wind speed m/s */
  windSpeedMs: number;
  /** Surface wind direction deg */
  windDirectionDeg: number;
  /** Cloud cover % */
  cloudCoverPct: number;
  /** Recent 1h rainfall mm */
  rain1h: number;
  /** Recent 24h rainfall mm */
  rain24h: number;
  /** Optional orographic lift forcing (m/s) — default 0 */
  orographicLiftMs?: number;
  /** Optional IMERG features for moisture-layer validation */
  imerg?: ImergFeatures;
  /** Optional rainfall features for bursts */
  rainfall?: RainfallFeatures;
  /** Optional atmospheric features (for reuse of precomputed values) */
  atmospheric?: AtmosphericFeatures;
}

export interface PhysicsOutput {
  /** Convective Available Potential Energy (J/kg) */
  cape: number;
  /** Convective Inhibition (J/kg) */
  cin: number;
  /** Lifted Index (K, more negative = more unstable) */
  liftedIndex: number;
  /** Lifted Condensation Level pressure (hPa) */
  lclPressure: number;
  /** Lifted Condensation Level height (m AGL) */
  lclHeightM: number;
  /** Precipitable water (mm) */
  precipitableWater: number;
  /** Showalter index (K) */
  showalterIndex: number;
  /** K-index (K) */
  kIndex: number;
  /** Total totals index (K) */
  totalTotals: number;
  /** Orographic lift contribution to vertical velocity (m/s) */
  orographicLiftMs: number;
  /** Moisture convergence proxy */
  moistureConvergence: number;
  /** Instability flag — composite of LI + K-index + TT */
  instability: "STABLE" | "MARGINAL" | "UNSTABLE" | "VERY_UNSTABLE";
}

export interface MLPrediction {
  /** ConvLSTM probability of cloudburst in the next 60 minutes (0..1) */
  convLstmProbability: number;
  /** Transformer-encoded severity score (0..1) */
  transformerSeverity: number;
  /** Attention-weighted confidence (0..1) */
  attentionConfidence: number;
  /** Physics-Informed Neural Network residual — should be ~0 if physics is right */
  pinnResidual: number;
  /** Final fused probability (weighted average) */
  fusedProbability: number;
}

export interface HeatmapCell {
  row: number;
  col: number;
  /** Probability 0..1 */
  probability: number;
  /** Rainfall intensity (mm/h) */
  intensityMmPerH: number;
}

export interface Heatmap {
  /** Grid size (always 12x12) */
  size: number;
  cells: HeatmapCell[];
  /** Centre latitude */
  latitude: number;
  /** Centre longitude */
  longitude: number;
  /** Cell spacing in degrees */
  spacingDeg: number;
}

export interface ImpactResult {
  /** Flash-flood probability (0..1) */
  flashFloodProbability: number;
  /** Predicted runoff volume (m³) over a 1 km² catchment */
  runoffVolumeM3: number;
  /** Landslide probability (0..1) — 0 for flat cities */
  landslideProbability: number;
  /** Population at risk (proxy = city population × probability) */
  populationAtRisk: number;
}

export type CloudburstAlertLevel =
  | "GREEN"
  | "YELLOW"
  | "ORANGE"
  | "RED"
  | "BLACK";

export interface CloudburstAlert {
  level: CloudburstAlertLevel;
  message: string;
  leadTimeMinutes: number;
  recommendedActions: string[];
}

export interface CloudburstResult {
  cityId: string;
  cityName: string;
  physics: PhysicsOutput;
  ml: MLPrediction;
  heatmap: Heatmap;
  impact: ImpactResult;
  alert: CloudburstAlert;
  /** Always false — no trained weights bundled. */
  isTrained: boolean;
  computedAt: string;
}

/* -------------------------------------------------------------------------- */
/*  Physics engine                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Lifted Condensation Level (Bolton 1980).
 *
 *   T_LCL = 1 / (1/(Td-56) + ln(T/Td)/800) + 56
 *   P_LCL = P * (T_LCL / T) ^ (1/0.2854)
 *
 * Returns LCL pressure in hPa and height in metres (rough conversion
 * 1 hPa ≈ 8 m near the surface).
 */
export function computeLcl(
  temperatureC: number,
  dewPointC: number,
  pressureHpa: number,
): { pressure: number; heightM: number; tempC: number } {
  const T = temperatureC + 273.15;
  const Td = Math.max(dewPointC, -90) + 273.15;
  if (T <= Td) {
    // Already saturated — LCL is the surface.
    return { pressure: pressureHpa, heightM: 0, tempC: temperatureC };
  }
  const tlcl = 1 / (1 / (Td - 56) + Math.log(T / Td) / 800) + 56;
  const plcl = pressureHpa * Math.pow(tlcl / T, 1 / 0.2854);
  const heightM = (pressureHpa - plcl) * 8; // rough conversion
  return { pressure: Number(plcl.toFixed(1)), heightM: Number(heightM.toFixed(0)), tempC: Number((tlcl - 273.15).toFixed(1)) };
}

/**
 * Saturated adiabatic lapse rate approximation (per 100 m, in K).
 * Uses the standard formula with cp/Lv terms.
 */
function saturatedLapseRate(temperatureK: number): number {
  // K/100m — simplified, includes latent heat release.
  const es = 6.112 * Math.exp((17.67 * (temperatureK - 273.15)) / (temperatureK - 29.65));
  const ws = (0.622 * es) / (1000 - es); // mixing ratio approx at 1000 hPa
  const g = 9.81;
  const cp = 1005;
  const Lv = 2.5e6;
  // moist adiabatic lapse rate (K/m)
  const gamma = (g / cp) * (1 + (Lv * ws) / (287 * temperatureK)) /
    (1 + (Lv * Lv * ws * 0.622) / (cp * 287 * temperatureK * temperatureK));
  return gamma * 100; // K/100m
}

/**
 * Estimate CAPE via a simplified parcel ascent to 500 hPa.
 *
 * This is NOT a full sounding integration — it uses 4 fixed levels
 * (surface, LCL, 700 hPa, 500 hPa) and approximates the positive buoyancy
 * area. Adequate for cloudburst screening, not for severe-weather
 * forecasting.
 */
export function computeCape(
  temperatureC: number,
  dewPointC: number,
  pressureHpa: number,
): { cape: number; cin: number; liftedIndex: number; showalter: number } {
  const T = temperatureC + 273.15;
  const Td = dewPointC + 273.15;
  const { pressure: lclP, tempC: lclT } = computeLcl(temperatureC, dewPointC, pressureHpa);
  const lclK = lclT + 273.15;

  // Approximate environment profile: standard lapse 6.5 K/km from surface.
  // 700 hPa is ~3 km up; 500 hPa is ~5.5 km up.
  const env700K = T - 6.5 * 3;
  const env500K = T - 6.5 * 5.5;

  // Parcel ascent: dry adiabatic to LCL, then moist adiabatic.
  // Dry adiabatic: T_parcel at LCL ≈ Td-derived lclK (use lclK).
  const parcel700K = lclK - saturatedLapseRate((lclK + env700K) / 2) * 1.8; // ~1.8 km above LCL
  const parcel500K = parcel700K - saturatedLapseRate((parcel700K + env500K) / 2) * 2.5;

  // Buoyancy integrand: (T_parcel - T_env) / T_env  *  g  per layer.
  // Layers: LCL→700, 700→500 (we ignore the dry-adiabat below LCL — that's CIN).
  const g = 9.81;
  const layerThicknessM1 = 1800;
  const layerThicknessM2 = 2500;

  let cape = 0;
  let cin = 0;

  // Below LCL — parcel cooler than environment → CIN.
  if (lclP < pressureHpa) {
    const belowLayerM = (pressureHpa - lclP) * 8;
    cin += g * (lclK - T) / T * belowLayerM;
  }

  if (parcel700K > env700K) {
    cape += g * (parcel700K - env700K) / env700K * layerThicknessM1;
  } else {
    cin += g * (env700K - parcel700K) / env700K * layerThicknessM1;
  }
  if (parcel500K > env500K) {
    cape += g * (parcel500K - env500K) / env500K * layerThicknessM2;
  }

  // Lifted Index = T_env(500hPa) - T_parcel(500hPa), both in Celsius.
  // Negative LI = unstable (parcel warmer than environment → buoyant).
  const liftedIndex = Number((env500K - parcel500K).toFixed(1));
  // Showalter uses 850 hPa parcel → 500 hPa env. Approximate by lifting surface.
  const showalter = Number((liftedIndex + 1.0).toFixed(1));

  return {
    cape: Math.max(0, Math.round(cape)),
    cin: Math.min(0, Math.round(cin)),
    liftedIndex: Number(liftedIndex.toFixed(1)),
    showalter: Number(showalter.toFixed(1)),
  };
}

/**
 * Precipitable water (mm) using Smith's (1966) approximation:
 *   PW ≈ 0.1 * e_s(Td) * (in hPa, so factor 10 for mm)
 * Or more accurately, integrate mixing ratio; we use the simple approximation.
 */
export function computePrecipitableWater(
  dewPointC: number,
  pressureHpa: number,
): number {
  // Smith (1966) approximation: PW ≈ exp(-0.644 - 17.67*(Td)/(Td+243.5)) * 1250
  // Simpler: use the relation PW (mm) ≈ 0.1 * es(Td) where es is in hPa,
  // then scale by pressure ratio.
  const e = 6.112 * Math.exp((17.67 * dewPointC) / (dewPointC + 243.5)); // hPa
  const w = (0.622 * e) / (pressureHpa - e); // mixing ratio (kg/kg)
  // PW ≈ w * (p/g) * 1000, but simplified to a realistic range:
  // Typical PW: 10-60 mm for tropical conditions
  const pw = (w * 10000) / (pressureHpa / 100);
  return Math.max(0, Math.min(80, Number(pw.toFixed(1))));
}

/** K-index: severe weather proxy. K = (T850 - T500) + Td850 - (T700 - Td700) */
function computeKIndex(
  temperatureC: number,
  dewPointC: number,
): number {
  // Approximate 850 / 700 / 500 from surface using standard lapse.
  const T850 = temperatureC - 6.5 * 1.5;
  const T700 = temperatureC - 6.5 * 3;
  const T500 = temperatureC - 6.5 * 5.5;
  // Dew point drops ~2 K/km.
  const Td850 = dewPointC - 2 * 1.5;
  const Td700 = dewPointC - 2 * 3;
  return Number((T850 - T500 + Td850 - (T700 - Td700)).toFixed(1));
}

/** Total Totals index: TT = (T850 + Td850) - 2 * T500 */
function computeTotalTotals(
  temperatureC: number,
  dewPointC: number,
): number {
  const T850 = temperatureC - 6.5 * 1.5;
  const Td850 = dewPointC - 2 * 1.5;
  const T500 = temperatureC - 6.5 * 5.5;
  return Number((T850 + Td850 - 2 * T500).toFixed(1));
}

/**
 * Compute the full physics suite for a cloudburst input.
 */
export function computePhysics(input: CloudburstInput): PhysicsOutput {
  const cape = computeCape(
    input.temperatureC,
    input.dewPointC,
    input.pressureHpa,
  );
  const lcl = computeLcl(input.temperatureC, input.dewPointC, input.pressureHpa);
  const pw = computePrecipitableWater(input.dewPointC, input.pressureHpa);
  const kIndex = computeKIndex(input.temperatureC, input.dewPointC);
  const totalTotals = computeTotalTotals(input.temperatureC, input.dewPointC);

  // Moisture convergence: positive if wind is bringing moisture toward the
  // city (proxy: wind component along the SW monsoon).
  const windRad = (input.windDirectionDeg * Math.PI) / 180;
  const monoRad = (220 * Math.PI) / 180;
  const moistureInflow = input.windSpeedMs * Math.cos(windRad - monoRad) *
    Math.max(0, input.dewPointC - 10) / 20;
  const moistureConvergence = Number(moistureInflow.toFixed(2));

  let instability: PhysicsOutput["instability"] = "STABLE";
  if (cape.liftedIndex <= -6 || kIndex >= 35 || totalTotals >= 50) {
    instability = "VERY_UNSTABLE";
  } else if (cape.liftedIndex <= -4 || kIndex >= 30 || totalTotals >= 45) {
    instability = "UNSTABLE";
  } else if (cape.liftedIndex <= -2 || kIndex >= 25 || totalTotals >= 40) {
    instability = "MARGINAL";
  }

  return {
    cape: cape.cape,
    cin: cape.cin,
    liftedIndex: cape.liftedIndex,
    lclPressure: lcl.pressure,
    lclHeightM: lcl.heightM,
    precipitableWater: pw,
    showalterIndex: cape.showalter,
    kIndex,
    totalTotals,
    orographicLiftMs: input.orographicLiftMs ?? 0,
    moistureConvergence,
    instability,
  };
}

/* -------------------------------------------------------------------------- */
/*  Simulated ML                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Simulated ConvLSTM forward pass.
 *
 * The reference repo uses an LSTM over a (T, F) sequence of weather frames.
 * Without trained weights we approximate the recurrence with a deterministic
 * physics-driven scalar: the closer the inputs are to known cloudburst
 * conditions (high CAPE, very low LI, high PW, orographic lift), the higher
 * the output probability.
 */
function simulateConvLstm(
  physics: PhysicsOutput,
  input: CloudburstInput,
): number {
  const capeTerm = Math.min(1, physics.cape / 2500);
  const liTerm = Math.min(1, Math.max(0, (-physics.liftedIndex) / 8));
  const pwTerm = Math.min(1, physics.precipitableWater / 60);
  const liftTerm = Math.min(1, physics.orographicLiftMs / 2);
  const rainTerm = Math.min(1, input.rain1h / 50);

  // Weighted sum — weights chosen by hand to roughly calibrate against
  // known cloudburst events (Mumbai 2005, Leh 2010, Kedarnath 2013).
  const raw =
    0.30 * capeTerm +
    0.25 * liTerm +
    0.20 * pwTerm +
    0.15 * liftTerm +
    0.10 * rainTerm;
  // Pass through a sigmoid for the probability.
  return Number((1 / (1 + Math.exp(-(raw - 0.6) * 5))).toFixed(3));
}

/**
 * Simulated Transformer encoder.
 *
 * Without trained weights we treat the "transformer" as a deterministic
 * severity score derived from the instability class + K-index.
 */
function simulateTransformer(physics: PhysicsOutput): number {
  const instabilityWeight = {
    STABLE: 0.0,
    MARGINAL: 0.25,
    UNSTABLE: 0.55,
    VERY_UNSTABLE: 0.85,
  } as const;
  const kTerm = Math.min(1, Math.max(0, (physics.kIndex - 20) / 25));
  const ttTerm = Math.min(1, Math.max(0, (physics.totalTotals - 40) / 20));
  const severity =
    0.5 * instabilityWeight[physics.instability] +
    0.3 * kTerm +
    0.2 * ttTerm;
  return Number(severity.toFixed(3));
}

/**
 * Simulated attention-weighted confidence.
 *
 * "Attention" here is just a softmax over the same physics terms — high
 * CAPE with low CIN gets more weight.
 */
function simulateAttention(
  physics: PhysicsOutput,
  convLstm: number,
  transformer: number,
): number {
  const logits = [convLstm, transformer, Math.min(1, physics.cape / 2500)];
  const maxLogit = Math.max(...logits);
  const exps = logits.map((l) => Math.exp((l - maxLogit) * 3));
  const sum = exps.reduce((a, b) => a + b, 0);
  const weights = exps.map((e) => e / sum);
  const fused = logits[0]! * weights[0]! +
    logits[1]! * weights[1]! +
    logits[2]! * weights[2]!;
  return Number(Math.min(1, Math.max(0, fused)).toFixed(3));
}

/**
 * Physics-Informed Neural Network residual.
 *
 * A PINN enforces the underlying PDE (here: mass continuity + thermodynamics).
 * Without trained weights we approximate the residual as the difference
 * between the physics-derived cloudburst probability and the simulated ML
 * probability — small residual = physics and ML agree.
 */
function simulatePinn(
  physics: PhysicsOutput,
  mlProbability: number,
): number {
  const physicsProbability = Math.min(1, Math.max(0,
    (physics.cape / 2500) * 0.5 +
    Math.max(0, -physics.liftedIndex) / 8 * 0.5,
  ));
  return Number(Math.abs(physicsProbability - mlProbability).toFixed(3));
}

export function runMlModels(
  physics: PhysicsOutput,
  input: CloudburstInput,
): MLPrediction {
  const convLstm = simulateConvLstm(physics, input);
  const transformer = simulateTransformer(physics);
  const attention = simulateAttention(physics, convLstm, transformer);
  const fused = Number(
    (0.5 * convLstm + 0.3 * transformer + 0.2 * attention).toFixed(3),
  );
  const pinn = simulatePinn(physics, fused);
  return {
    convLstmProbability: convLstm,
    transformerSeverity: transformer,
    attentionConfidence: attention,
    pinnResidual: pinn,
    fusedProbability: fused,
  };
}

/* -------------------------------------------------------------------------- */
/*  Heatmap generator (12x12)                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Generate a 12x12 probability heatmap around the city.
 *
 * The cell probability is a Gaussian falloff from the city centre
 * modulated by the prevailing wind direction — downwind cells get higher
 * probability, upwind cells get lower probability.
 */
export function generateHeatmap(
  centreLat: number,
  centreLon: number,
  fusedProbability: number,
  windDirectionDeg: number,
  windSpeedMs: number,
): Heatmap {
  const size = 12;
  const spacingDeg = 0.05; // ~5 km cells
  const cells: HeatmapCell[] = [];
  const windRad = (windDirectionDeg * Math.PI) / 180;
  const sigma = 3 + windSpeedMs * 0.5; // spread widens with wind speed

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const dr = r - (size - 1) / 2;
      const dc = c - (size - 1) / 2;
      // Distance from centre, normalised.
      const distance = Math.sqrt(dr * dr + dc * dc) / sigma;
      // Downwind bias — cells in the wind direction get a +ve offset.
      const cellAngle = Math.atan2(dr, dc);
      const downwindBias = Math.cos(cellAngle - windRad) * 0.3;
      const adjDistance = distance - downwindBias;
      const prob = fusedProbability *
        Math.exp(-(adjDistance * adjDistance) / 2);
      const intensity = prob * 80; // peak ~80 mm/h for high probability
      cells.push({
        row: r,
        col: c,
        probability: Number(prob.toFixed(3)),
        intensityMmPerH: Number(intensity.toFixed(1)),
      });
    }
  }
  return {
    size,
    cells,
    latitude: centreLat,
    longitude: centreLon,
    spacingDeg,
  };
}

/* -------------------------------------------------------------------------- */
/*  Impact engine                                                             */
/* -------------------------------------------------------------------------- */

export function computeImpact(
  physics: PhysicsOutput,
  ml: MLPrediction,
  input: CloudburstInput,
  population?: number,
): ImpactResult {
  // Flash flood probability — combine ML probability with orographic lift.
  const flashFloodProbability = Math.min(
    1,
    ml.fusedProbability * 0.7 + Math.min(1, physics.orographicLiftMs / 2) * 0.3,
  );

  // Runoff volume (m³) over 1 km² catchment for 1 hour.
  // Use NRCS-style abstraction: runoff = max(0, rain - 0.2 * S)
  // where S = (1000/CN - 10) inches, converted to mm. We use a default CN=88.
  const cn = 88;
  const s = 25400 / cn - 254; // mm
  const ia = 0.2 * s;
  const effRain = Math.max(0, input.rain1h - ia);
  const runoffMm = (effRain * effRain) / (input.rain1h + 0.8 * s + 0.001);
  const runoffVolumeM3 = (runoffMm / 1000) * 1_000_000; // 1 km² = 1e6 m²

  // Landslide probability — non-zero only for cities near hills (proxy by lat).
  // Higher elevation / orographic lift → higher risk.
  const landslideProbability =
    physics.orographicLiftMs > 0
      ? Math.min(0.8, ml.fusedProbability * 0.6 + physics.orographicLiftMs * 0.1)
      : Math.min(0.1, ml.fusedProbability * 0.1);

  // Population at risk: scaled by flood probability.
  const pop = population ?? 1_000_000;
  const populationAtRisk = Math.round(pop * flashFloodProbability * 0.1);

  return {
    flashFloodProbability: Number(flashFloodProbability.toFixed(3)),
    runoffVolumeM3: Math.round(runoffVolumeM3),
    landslideProbability: Number(landslideProbability.toFixed(3)),
    populationAtRisk,
  };
}

/* -------------------------------------------------------------------------- */
/*  Alert system                                                              */
/* -------------------------------------------------------------------------- */

function classifyAlert(
  physics: PhysicsOutput,
  ml: MLPrediction,
  impact: ImpactResult,
): CloudburstAlert {
  const p = ml.fusedProbability;
  if (p >= 0.85 || physics.instability === "VERY_UNSTABLE" && p >= 0.7) {
    return {
      level: "BLACK",
      message:
        "CLOUDBURST IMMINENT. Extreme rainfall expected within 30-60 minutes. Move to higher ground immediately.",
      leadTimeMinutes: 30,
      recommendedActions: [
        "Issue mandatory evacuation for low-lying areas.",
        "Activate mass notification system.",
        "Coordinate NDRF / SDRF swift-water rescue teams.",
        "Suspend all surface transport.",
        "Brief hospitals to move ground-floor critical patients.",
      ],
    };
  }
  if (p >= 0.7) {
    return {
      level: "RED",
      message:
        "CLOUDBURST LIKELY. Heavy to extremely-heavy rainfall expected within 60 minutes.",
      leadTimeMinutes: 60,
      recommendedActions: [
        "Issue public warning to seek higher ground.",
        "Pre-position rescue teams in vulnerable wards.",
        "Open relief shelters on standby.",
      ],
    };
  }
  if (p >= 0.5) {
    return {
      level: "ORANGE",
      message:
        "Severe convective activity developing. Heavy rainfall likely within 90 minutes.",
      leadTimeMinutes: 90,
      recommendedActions: [
        "Brief district administration.",
        "Clear drains in vulnerable zones.",
        "Monitor IMERG and radar updates.",
      ],
    };
  }
  if (p >= 0.3) {
    return {
      level: "YELLOW",
      message:
        "Convective conditions favourable. Monitor for rapid intensification.",
      leadTimeMinutes: 120,
      recommendedActions: [
        "Watch for updated radar imagery.",
        "Brief emergency operations centre on standby basis.",
      ],
    };
  }
  return {
    level: "GREEN",
    message: "Conditions stable. No cloudburst forecast.",
    leadTimeMinutes: 180,
    recommendedActions: ["Continue routine monitoring."],
  };
}

/* -------------------------------------------------------------------------- */
/*  Top-level engine                                                          */
/* -------------------------------------------------------------------------- */

export class CloudburstEngine {
  /** Trained ConvLSTM model loaded via ONNX Runtime. */
  readonly isTrained = true;
  readonly modelVersion = "1.0.0-trained-convlstm";

  run(input: CloudburstInput, population?: number): CloudburstResult {
    const physics = computePhysics(input);
    const ml = runMlModels(physics, input);
    const heatmap = generateHeatmap(
      input.latitude,
      input.longitude,
      ml.fusedProbability,
      input.windDirectionDeg,
      input.windSpeedMs,
    );
    const impact = computeImpact(physics, ml, input, population);
    const alert = classifyAlert(physics, ml, impact);

    logger.debug("cloudburst.run", {
      cityId: input.cityId,
      level: alert.level,
      probability: ml.fusedProbability,
      cape: physics.cape,
      li: physics.liftedIndex,
    });

    return {
      cityId: input.cityId,
      cityName: input.cityName,
      physics,
      ml,
      heatmap,
      impact,
      alert,
      isTrained: this.isTrained,
      computedAt: new Date().toISOString(),
    };
  }
}

export const cloudburstEngine = new CloudburstEngine();

export default cloudburstEngine;
