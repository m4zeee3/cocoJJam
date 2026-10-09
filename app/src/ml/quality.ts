/**
 * Photo quality checks on the 224×224 RGB the models already use (S10, UC-1.5).
 * Pure functions: no React Native.
 */

export type QualityIssue = 'too_dark' | 'too_bright' | 'blurry';

/** Starting thresholds: tune with real phone photos. */
export const QUALITY = {
  /** Mean luminance (0–255) below this is too dark. */
  darkMean: 45,
  /** Mean luminance above this, with little detail, is washed out. */
  brightMean: 235,
  /** Variance of the Laplacian below this is too blurry to judge texture. */
  blurVariance: 25,
};

export function luminance(rgb: Uint8Array) {
  const n = rgb.length / 3;
  const out = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 3) out[i] = 0.299 * rgb[j] + 0.587 * rgb[j + 1] + 0.114 * rgb[j + 2];
  return out;
}

/** Variance of the 4-neighbour Laplacian: a standard sharpness measure. */
export function sharpness(gray: Float32Array, size: number) {
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const i = y * size + x;
      const lap = gray[i - size] + gray[i + size] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

export function checkQuality(rgb: Uint8Array, size: number): QualityIssue | null {
  const gray = luminance(rgb);
  let total = 0;
  for (const v of gray) total += v;
  const mean = total / gray.length;
  if (mean < QUALITY.darkMean) return 'too_dark';
  const sharp = sharpness(gray, size);
  if (mean > QUALITY.brightMean && sharp < QUALITY.blurVariance * 2) return 'too_bright';
  if (sharp < QUALITY.blurVariance) return 'blurry';
  return null;
}

export const QUALITY_MESSAGE: Record<QualityIssue, { text: string; tips: string[] }> = {
  too_dark: {
    text: 'This photo is a bit too dark for me to check. Could you retake it?',
    tips: ['Move to brighter light, like near a window', 'Turn on the flash'],
  },
  too_bright: {
    text: 'This photo is too bright and washed out. Could you retake it?',
    tips: ['Avoid direct sun or glare on the item', 'Tilt the phone a little to cut reflections'],
  },
  blurry: {
    text: 'This photo is a bit blurry, so I can’t see the texture. Could you retake it?',
    tips: ['Hold the phone steady and tap the item to focus', 'Move closer so the item fills the frame'],
  },
};
