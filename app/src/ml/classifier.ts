import Constants, { ExecutionEnvironment } from 'expo-constants';
import type { TfliteModel } from 'react-native-fast-tflite';

import DEPLOYMENT from '@/assets/model/deployment.json';
import LABELS from '@/assets/model/labels.json';
import type { Stage } from '@/domain/types';
import { imageToRgb } from '@/ml/preprocess';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- bundled asset
const MODEL = require('../../assets/model/model.tflite');

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

export function loadModel(): Promise<TfliteModel> {
  // Loaded lazily so importing this file doesn't crash in Expo Go.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { loadTensorflowModel } = require('react-native-fast-tflite') as typeof import('react-native-fast-tflite');
  modelPromise ??= loadTensorflowModel(MODEL, []).catch((err) => {
    modelPromise = null;
    throw err;
  });
  return modelPromise;
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
