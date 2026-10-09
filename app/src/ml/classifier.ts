import { Asset } from 'expo-asset';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import type { TfliteModel } from 'react-native-fast-tflite';

import DEPLOYMENT from '@/assets/model/deployment.json';
import LABELS from '@/assets/model/labels.json';
import type { Stage } from '@/domain/types';
import GATE_LABELS from '@/assets/model/gate/imagenet-labels.json';
import { Image } from 'react-native';

import { hasFace } from '@/ml/faces';
import { fishLikeShare, judgeGate, type GateReject } from '@/ml/gate';
import { judgeItems, readItems, type ItemRead, type Verdict } from '@/ml/read';
import { imageToRgb } from '@/ml/preprocess';
import { checkQuality, type QualityIssue } from '@/ml/quality';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- bundled asset
const MODEL = require('../../assets/model/model.tflite');
// General ImageNet MobileNet (uint8), only used to reject non-food photos (ml/gate.ts).
// eslint-disable-next-line @typescript-eslint/no-require-imports -- bundled asset
const GATE_MODEL = require('../../assets/model/gate/imagenet.tflite');

export type FishView = 'eye' | 'gill';
export type Finding = 'fresh' | 'spoiled' | 'non-fresh';
export type Guess = {
  label: string;
  item: string;
  stage: Stage | null;
  finding: Finding;
  view: FishView | null;
  confidence: number;
};

/**
 * Expo Go has no TFLite native module, so there the scanner returns sample
 * guesses to let the team work on the UI. Real AI needs a development build.
 */
export const DEMO_MODE = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
export const CONFIDENCE_THRESHOLD = DEPLOYMENT.confidence_threshold;

const DEMO_GUESSES: [string, number][][] = [
  [['pork/fresh', 0.82], ['beef/fresh', 0.11], ['chicken/spoiled', 0.04]],
  [['fish/eye-non-fresh', 0.74], ['chicken/fresh', 0.15], ['pork/spoiled', 0.06]],
  [['pork/fresh', 0.41], ['chicken/fresh', 0.36], ['fish/gill-fresh', 0.12]],
];
let demoIndex = 0;

let modelPromise: Promise<TfliteModel> | null = null;

/**
 * A local file:// path to the bundled model. In a release APK a bundled asset is
 * an Android resource ("assets_model_model"), not a URL, and fast-tflite can only
 * open URLs, so expo-asset copies it to the app's cache first. Works offline.
 */
async function modelFileUrl(module: number = MODEL): Promise<string> {
  const asset = Asset.fromModule(module);
  if (!asset.localUri) await asset.downloadAsync();
  if (!asset.localUri) throw new Error('Could not unpack the bundled model file.');
  return asset.localUri;
}

export function loadModel(): Promise<TfliteModel> {
  // Loaded lazily so importing this file doesn't crash in Expo Go.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { loadTensorflowModel } = require('react-native-fast-tflite') as typeof import('react-native-fast-tflite');
  modelPromise ??= modelFileUrl()
    .then((url) => loadTensorflowModel({ url }, []))
    .catch((err) => {
      modelPromise = null;
      throw err;
    });
  return modelPromise;
}

let gatePromise: Promise<TfliteModel> | null = null;

function loadGate(): Promise<TfliteModel> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { loadTensorflowModel } = require('react-native-fast-tflite') as typeof import('react-native-fast-tflite');
  gatePromise ??= modelFileUrl(GATE_MODEL)
    .then((url) => loadTensorflowModel({ url }, []))
    .catch((err) => {
      gatePromise = null;
      throw err;
    });
  return gatePromise;
}

/** The general model on a 224×224 RGB photo: why it isn't food we can check (or null), and how fish-like it is. */
async function runGate(rgb: Uint8Array): Promise<{ reject: GateReject | null; fishLike: number }> {
  const gate = await loadGate();
  const [out] = await gate.run([rgb.buffer as ArrayBuffer]);
  if (!out) return { reject: null, fishLike: 0 };
  const scores = Array.from(new Uint8Array(out), (v) => v / 255);
  const labels = GATE_LABELS as string[];
  return { reject: judgeGate(labels, scores), fishLike: fishLikeShare(labels, scores) };
}

function imageSize(uri: string) {
  return new Promise<{ width: number; height: number }>((resolve) =>
    Image.getSize(uri, (width, height) => resolve({ width, height }), () => resolve({ width: 0, height: 0 })),
  );
}

/** Load both models into memory (used by the splash so the first scan is instant). */
export function warmUpModels() {
  return Promise.all([loadModel(), loadGate().catch(() => null)]);
}

export type Analysis =
  | {
      kind: 'ok';
      /** Raw class guesses, for logs only: never shown to users. */
      guesses: Guess[];
      /** Beef / pork / chicken / fish, most likely first. */
      items: ItemRead[];
      /** What the chat may say: "This looks like beef" vs "I can't tell for sure". */
      verdict: Verdict;
    }
  | { kind: 'quality'; issue: QualityIssue }
  | { kind: 'face' }
  | { kind: 'not_food'; reject: GateReject };

/**
 * Validate a photo, then read it, all on the phone (UC-1.4–1.7, 1.9):
 * 1. quality (too dark, washed out, blurry) — skippable with "use it anyway",
 * 2. a face (ML Kit), 3. the general model (person, animal, object, produce,
 * cooked food), 4. the freshness model, read safely (ml/read.ts).
 */
export async function analyzePhoto(uri: string, opts: { skipQuality?: boolean } = {}): Promise<Analysis> {
  const verdictOf = (all: Guess[], fishLike: number) => {
    const items = readItems(all);
    const verdict = judgeItems(items, all[0]?.confidence ?? 0, CONFIDENCE_THRESHOLD, fishLike);
    return { kind: 'ok' as const, guesses: all.slice(0, 3), items, verdict };
  };
  if (DEMO_MODE) return verdictOf(await classify(uri, LABELS.length), 0);

  const model = await loadModel();
  const size = model.inputs[0]?.shape[1] ?? 224;
  const rgb = await imageToRgb(uri, size);
  if (!opts.skipQuality) {
    const issue = checkQuality(rgb, size);
    if (issue) return { kind: 'quality', issue };
  }
  const { width, height } = await imageSize(uri);
  if (await hasFace(uri, width, height)) return { kind: 'face' };
  // A gate that fails to load must not block scanning.
  const gate = await runGate(rgb).catch(() => ({ reject: null, fishLike: 0 }));
  if (gate.reject) return { kind: 'not_food', reject: gate.reject };
  return verdictOf(await classifyRgb(rgb, LABELS.length), gate.fishLike);
}

/** One readable line for an error from the model (native errors carry a full stack trace). */
export function shortError(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.split('\n')[0].replace(/^[\w.$]+Exception:\s*/, '').slice(0, 140);
}

function parseLabel(label: string): Omit<Guess, 'confidence'> {
  const [item, classification, extra] = label.split('/');
  if (!item || !classification || extra) throw new Error(`Invalid model label: ${label}`);

  if (item === 'fish') {
    const view = classification.startsWith('eye-') ? 'eye' : classification.startsWith('gill-') ? 'gill' : null;
    const condition = view ? classification.slice(view.length + 1) : '';
    if (!view || (condition !== 'fresh' && condition !== 'non-fresh')) {
      throw new Error(`Invalid fish model label: ${label}`);
    }
    return {
      label,
      item: 'fish',
      stage: condition === 'fresh' ? 'fresh' : null,
      finding: condition,
      view,
    };
  }

  if (classification !== 'fresh' && classification !== 'spoiled') {
    throw new Error(`Invalid model label: ${label}`);
  }
  return {
    label,
    item,
    stage: classification,
    finding: classification,
    view: null,
  };
}

/** Readable class name for scan guess choices and fish-view follow-up. */
export function describeGuess(guess: Guess): string {
  if (guess.view) return `Fish · ${guess.view} view · ${guess.finding}`;
  return `${guess.item} · ${guess.finding}`;
}

/** Run the on-device model on one photo; returns calibrated probabilities, best first. */
export async function classify(uri: string, top = 3): Promise<Guess[]> {
  if (DEMO_MODE) {
    const sample = DEMO_GUESSES[demoIndex++ % DEMO_GUESSES.length];
    return sample.slice(0, top).map(([label, confidence]) => ({ ...parseLabel(label), confidence }));
  }
  const model = await loadModel();
  const input = model.inputs[0];
  const output = model.outputs[0];
  if (
    !input ||
    input.dataType !== 'float32' ||
    input.shape.length !== 4 ||
    input.shape[0] !== 1 ||
    input.shape[3] !== 3
  ) {
    throw new Error('The bundled TFLite model has an unsupported input. Expected float32 [1, height, width, 3].');
  }
  if (!output || output.dataType !== 'float32' || output.shape[1] !== LABELS.length) {
    throw new Error('The bundled TFLite model outputs do not match labels.json.');
  }
  const rgb = await imageToRgb(uri, input.shape[1]);
  return classifyRgb(rgb, top);
}

/** The freshness model on an already-resized RGB photo (see classify for the checks). */
async function classifyRgb(rgb: Uint8Array, top: number): Promise<Guess[]> {
  const model = await loadModel();
  const [out] = await model.run([Float32Array.from(rgb).buffer]);
  if (!out) throw new Error('The bundled TFLite model returned no output.');
  const scores = Array.from(new Float32Array(out));
  if (
    scores.length !== LABELS.length ||
    scores.some((score) => !Number.isFinite(score) || score < -1e-5 || score > 1 + 1e-5) ||
    Math.abs(scores.reduce((sum, score) => sum + score, 0) - 1) > 1e-4
  ) {
    throw new Error('The bundled TFLite model returned invalid class probabilities.');
  }

  return scores
    .map((confidence, i) => ({ ...parseLabel(LABELS[i]), confidence }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, top);
}
