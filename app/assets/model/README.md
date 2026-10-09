# On-device model

`model.tflite`, `labels.json` and `deployment.json` are loaded by
`src/ml/classifier.ts`. They are the float32 TFLite export of training run
`ai-training/models/mobilenetv3-small-v2`.

- Input: `[1, 224, 224, 3]`, RGB float32 values from 0 to 255.
- Preprocessing: bilinear stretch to 224 x 224; do not center-crop or normalize.
- Output: calibrated class probabilities in the exact order of `labels.json`.
- `deployment.json` contains the temperature, confidence threshold and model hashes.

The model classes are:

- `beef/fresh`, `beef/spoiled`
- `chicken/fresh`, `chicken/spoiled`
- `pork/fresh`, `pork/spoiled`
- `fish/eye-fresh`, `fish/eye-non-fresh`
- `fish/gill-fresh`, `fish/gill-non-fresh`

Fish `non-fresh` is a visual observation, not a direct `spoiled` pantry stage.
The scanner shows the eye/gill finding and asks the user what pantry stage to log.
All predictions are visual estimates, not food-safety certification.

The model is bundled for offline use. Use an Expo development build; Expo Go does
not include the TFLite native module. Metro bundles the model as an asset.
