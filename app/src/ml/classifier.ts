import Constants, { ExecutionEnvironment } from 'expo-constants';
import type { TfliteModel } from 'react-native-fast-tflite';

import LABELS from '@/assets/model/labels.json';
import { interpret, type Guess } from '@/ml/labels';
import { imageToRgb } from '@/ml/preprocess';

export type { Guess } from '@/ml/labels';

// Swap these two files for the trained model (see assets/model/README.md).
// Labels like "beef/fresh" or "fish/gill-non-fresh"; see ml/labels.ts.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- bundled asset
const MODEL = require('../../assets/model/model.tflite');

/**
 * Expo Go has no TFLite native module, so there the scanner returns sample
 * guesses to let the team work on the UI. Real AI needs a development build.
 */
export const DEMO_MODE = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

// Sample score vectors in the trained model's label order (beef, chicken, fish ×4, pork).
const DEMO_LABELS = [
  'beef/fresh', 'beef/spoiled', 'chicken/fresh', 'chicken/spoiled',
  'fish/eye-fresh', 'fish/eye-non-fresh', 'fish/gill-fresh', 'fish/gill-non-fresh',
  'pork/fresh', 'pork/spoiled',
];
const DEMO_SCORES: number[][] = [
  [0, 0, 0.01, 0, 0.12, 0.03, 0.72, 0.1, 0.01, 0.01], // fish, gills, good
  [0.02, 0.01, 0.48, 0.34, 0, 0, 0, 0, 0.1, 0.05], // chicken, use soon
  [0.34, 0.04, 0.01, 0, 0, 0, 0, 0, 0.4, 0.21], // pork vs beef, not sure
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

/** Run the on-device model on one photo; returns the top guesses, best first. */
export async function classify(uri: string, top = 3): Promise<Guess[]> {
  if (DEMO_MODE) return interpret(DEMO_LABELS, DEMO_SCORES[demoIndex++ % DEMO_SCORES.length], top);
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

  return interpret(LABELS as string[], scores, top);
}
