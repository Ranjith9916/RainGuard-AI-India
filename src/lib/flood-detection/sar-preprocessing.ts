/**
 * Sentinel-1 SAR preprocessing.
 *
 * Ports the `s1_to_rgb` function from the ETCI 2021 flood-detection reference
 * (https://github.com/cloudtostreet/Sentinel-1-ETCI-2021). The function takes
 * the VV and VH backscatter channels (in dB) and returns a 3-channel RGB
 * composite that:
 *   - is suitable for human visualisation of SAR water / land features
 *   - is the input format expected by the ETCI U-Net inferencer
 *
 * Reference pipeline (from the ETCI repo):
 *   1. Convert VV/VH from dB to linear amplitude:  10^(dB/20)
 *   2. Clip to a sensible range (0..1) and apply a square-root stretch
 *   3. Compose:
 *        R = sqrt(VV_lin)
 *        G = sqrt(VH_lin)
 *        B = sqrt(VV_lin / VH_lin)   (the cross-ratio channel)
 *
 * The square-root stretch highlights water (low backscatter) as dark and
 * urban / vegetated (high backscatter) as bright — exactly what the
 * downstream U-Net was trained on.
 */

export interface SarPreprocessInput {
  /** VV backscatter in dB, row-major Float32Array */
  vv: Float32Array;
  /** VH backscatter in dB, row-major Float32Array */
  vh: Float32Array;
  width: number;
  height: number;
  /** Optional per-channel dB-floor clip (default -30 dB) */
  dbFloor?: number;
  /** Optional per-channel dB-ceiling clip (default 0 dB) */
  dbCeiling?: number;
}

export interface SarRgbComposite {
  /** Row-major Uint8Array of length width*height*3 (RGB triplet per pixel) */
  data: Uint8Array;
  width: number;
  height: number;
  /** Channels used — fixed at "R=VV G=VH B=VV/VH" per ETCI repo */
  channels: ["VV", "VH", "VV/VH"];
}

function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

function clipDb(db: number, floor: number, ceiling: number): number {
  if (db < floor) return floor;
  if (db > ceiling) return ceiling;
  return db;
}

function normaliseToUint8(value: number): number {
  // Square-root stretch, clamped to 0..255.
  const stretched = Math.sqrt(Math.max(0, Math.min(1, value)));
  return Math.round(stretched * 255);
}

/**
 * Convert Sentinel-1 VV/VH (dB) into an 8-bit RGB composite suitable for
 * both human visualisation and the ETCI U-Net inferencer.
 */
export function s1ToRgb(input: SarPreprocessInput): SarRgbComposite {
  const { vv, vh, width, height } = input;
  if (vv.length !== width * height || vh.length !== width * height) {
    throw new Error(
      `s1ToRgb: channel length ${vv.length}/${vh.length} != width*height ${width * height}`,
    );
  }

  const floor = input.dbFloor ?? -30;
  const ceiling = input.dbCeiling ?? 0;
  const data = new Uint8Array(width * height * 3);

  for (let i = 0; i < vv.length; i++) {
    const vvDb = clipDb(vv[i]!, floor, ceiling);
    const vhDb = clipDb(vh[i]!, floor, ceiling);

    const vvLin = dbToLinear(vvDb);
    const vhLin = dbToLinear(vhDb);
    // VV/VH ratio in linear space. Guard against divide-by-zero.
    const ratio = vhLin > 0 ? vvLin / vhLin : 1.0;

    // Square-root stretched → 0..255
    const r = normaliseToUint8(vvLin);
    const g = normaliseToUint8(vhLin);
    const b = normaliseToUint8(Math.min(1, ratio));

    const outIdx = i * 3;
    data[outIdx] = r;
    data[outIdx + 1] = g;
    data[outIdx + 2] = b;
  }

  return {
    data,
    width,
    height,
    channels: ["VV", "VH", "VV/VH"],
  };
}

/**
 * Helper: convert the dB values of a single pixel to an RGB triplet without
 * allocating a full composite. Useful for quick visualisations / debugging.
 */
export function pixelToRgb(vvDb: number, vhDb: number): [number, number, number] {
  const composite = s1ToRgb({
    vv: new Float32Array([vvDb]),
    vh: new Float32Array([vhDb]),
    width: 1,
    height: 1,
  });
  return [composite.data[0]!, composite.data[1]!, composite.data[2]!];
}

export default { s1ToRgb, pixelToRgb };
