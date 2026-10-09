import Constants, { ExecutionEnvironment } from 'expo-constants';
import type { TfliteModel } from 'react-native-fast-tflite';

import LABELS from '@/assets/model/labels.json';
import type { Stage } from '@/domain/types';
import { imageToRgb } from '@/ml/preprocess';

// Swap these two files for the trained model (see assets/model/README.md).
// Labels are "<item>__<stage>", e.g. "tilapia__use_soon". A label without "__"
// (the stock ImageNet placeholder) has no stage.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- bundled asset
const MODEL = require('../../assets/model/model.tflite');

export type Guess = { label: string; item: string; stage: Stage | null; confidence: number };

/**
 * Expo Go has no TFLite native module, so there the scanner returns sample
 * guesses to let the team work on the UI. Real AI needs a development build.
 */
export const DEMO_MODE = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

const DEMO_GUESSES: [string, number][][] = [
  [['tilapia__good', 0.82], ['bangus__good', 0.11], ['pork__fresh', 0.04]],
  [['banana__use_soon', 0.74], ['tomato__good', 0.15], ['kangkong__fresh', 0.06]],
  [['pork__fresh', 0.41], ['chicken__fresh', 0.36], ['tilapia__good', 0.12]],
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

function parseLabel(label: string): Pick<Guess, 'item' | 'stage'> {
  const [item, stage] = label.split('__');
  return { item, stage: (stage as Stage | undefined) ?? null };
}

/** Run the on-device model on one photo; returns the top guesses, best first. */
export async function classify(uri: string, top = 3): Promise<Guess[]> {
  if (DEMO_MODE) {
    const sample = DEMO_GUESSES[demoIndex++ % DEMO_GUESSES.length];
    return sample.slice(0, top).map(([label, confidence]) => ({ label, confidence, ...parseLabel(label) }));
  }
  const model = await loadModel();
  const input = model.inputs[0];
  const size = input.shape[1]; // [1, height, width, 3]
  const rgb = await imageToRgb(uri, size);

  // Keras MobileNetV3 rescales inside the model, so a float model gets raw
  // 0-255 values. A uint8-quantized model takes the bytes as they are.
  let buffer: ArrayBuffer;
  if (input.dataType === 'float32') buffer = Float32Array.from(rgb).buffer;
  else if (input.dataType === 'uint8') buffer = rgb.buffer as ArrayBuffer;
  else throw new Error(`Unsupported model input type: ${input.dataType}`);

  const [out] = await model.run([buffer]);
  const scores =
    model.outputs[0].dataType === 'uint8'
      ? Array.from(new Uint8Array(out), (v) => v / 255)
      : Array.from(new Float32Array(out));

  return scores
    .map((confidence, i) => ({ label: LABELS[i] ?? `class_${i}`, confidence }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, top)
    .map((g) => ({ ...g, ...parseLabel(g.label) }));
}
