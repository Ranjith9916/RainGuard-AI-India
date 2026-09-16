/**
 * Otsu threshold flood detector.
 *
 * Otsu's method picks the threshold that maximises the inter-class variance
 * between two pixel populations — in our case, water (low backscatter) and
 * land (high backscatter) in a Sentinel-1 VV image.
 *
 * This is the same algorithm used in the ETCI 2021 baseline submission.
 * Reference: N. Otsu (1979), "A Threshold Selection Method from Gray-Level
 * Histograms", IEEE Trans. SMC, 9(1).
 *
 * Implementation note: the algorithm is O(L) where L is the number of bin
 * levels — we use 256 levels by quantising the input to the nearest dB
 * integer (which is fine for Sentinel-1 since the dynamic range is ~30 dB).
 */

/* -------------------------------------------------------------------------- */
/*  Quantisation                                                             */
/* -------------------------------------------------------------------------- */

const NUM_BINS = 256;
const DB_FLOOR = -40;
const DB_CEILING = 10;

function quantise(db: number): number {
  if (db <= DB_FLOOR) return 0;
  if (db >= DB_CEILING) return NUM_BINS - 1;
  const fraction = (db - DB_FLOOR) / (DB_CEILING - DB_FLOOR);
  return Math.min(NUM_BINS - 1, Math.floor(fraction * NUM_BINS));
}

/* -------------------------------------------------------------------------- */
/*  Otsu                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Compute the Otsu threshold on a Float32Array of dB values.
 * Returns the threshold in dB.
 */
export function otsuThreshold(values: Float32Array): number {
  if (values.length === 0) return 0;

  // Build histogram.
  const histogram = new Float64Array(NUM_BINS);
  for (let i = 0; i < values.length; i++) {
    histogram[quantise(values[i]!)]++;
  }

  const total = values.length;
  let sumAll = 0;
  for (let i = 0; i < NUM_BINS; i++) {
    sumAll += i * histogram[i];
  }

  let sumBackground = 0;
  let weightBackground = 0;
  let maxVariance = -1;
  let bestBin = 0;

  for (let t = 0; t < NUM_BINS; t++) {
    weightBackground += histogram[t];
    if (weightBackground === 0) continue;
    const weightForeground = total - weightBackground;
    if (weightForeground === 0) break;

    sumBackground += t * histogram[t];
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sumAll - sumBackground) / weightForeground;
    const variance =
      weightBackground *
      weightForeground *
      (meanBackground - meanForeground) *
      (meanBackground - meanForeground);

    if (variance > maxVariance) {
      maxVariance = variance;
      bestBin = t;
    }
  }

  // Convert the bin back to dB.
  const fraction = (bestBin + 0.5) / NUM_BINS;
  const thresholdDb = DB_FLOOR + fraction * (DB_CEILING - DB_FLOOR);
  return Number(thresholdDb.toFixed(2));
}

/* -------------------------------------------------------------------------- */
/*  Threshold detector                                                        */
/* -------------------------------------------------------------------------- */

export interface ThresholdDetectionResult {
  /** Binary mask, row-major Uint8Array (1 = water, 0 = land) */
  mask: Uint8Array;
  width: number;
  height: number;
  /** Threshold (dB) chosen by Otsu */
  thresholdDb: number;
  /** Fraction of pixels classified as water (0..1) */
  waterFraction: number;
}

/**
 * Apply Otsu thresholding to a VV image. Pixels below the threshold are
 * classified as water (SAR water surfaces are dark).
 */
export function detectFloodByThreshold(
  vv: Float32Array,
  width: number,
  height: number,
): ThresholdDetectionResult {
  if (vv.length !== width * height) {
    throw new Error(
      `detectFloodByThreshold: vv length ${vv.length} != width*height ${width * height}`,
    );
  }
  const threshold = otsuThreshold(vv);
  const mask = new Uint8Array(vv.length);
  let waterPixels = 0;
  for (let i = 0; i < vv.length; i++) {
    if (vv[i]! < threshold) {
      mask[i] = 1;
      waterPixels++;
    } else {
      mask[i] = 0;
    }
  }
  return {
    mask,
    width,
    height,
    thresholdDb: threshold,
    waterFraction: Number((waterPixels / vv.length).toFixed(3)),
  };
}

/**
 * Two-channel variant: combine VV and VH Otsu thresholds. A pixel is water
 * only if it is below BOTH thresholds — this reduces false positives from
 * layover / shadow on the VV channel.
 */
export function detectFloodByDualThreshold(
  vv: Float32Array,
  vh: Float32Array,
  width: number,
  height: number,
): ThresholdDetectionResult {
  if (vv.length !== width * height || vh.length !== width * height) {
    throw new Error("detectFloodByDualThreshold: channel length mismatch");
  }
  const vvThreshold = otsuThreshold(vv);
  const vhThreshold = otsuThreshold(vh);
  // Take the more conservative (higher) of the two — fewer false positives.
  const threshold = Math.max(vvThreshold, vhThreshold);
  const mask = new Uint8Array(vv.length);
  let waterPixels = 0;
  for (let i = 0; i < vv.length; i++) {
    if (vv[i]! < threshold && vh[i]! < threshold) {
      mask[i] = 1;
      waterPixels++;
    } else {
      mask[i] = 0;
    }
  }
  return {
    mask,
    width,
    height,
    thresholdDb: threshold,
    waterFraction: Number((waterPixels / vv.length).toFixed(3)),
  };
}

export default { otsuThreshold, detectFloodByThreshold, detectFloodByDualThreshold };
