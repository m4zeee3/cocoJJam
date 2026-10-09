# On-device model

`model.tflite` and `labels.json` are loaded by `src/ml/classifier.ts`.

**Current files are a placeholder.** They are Google's stock MobileNet v1 (uint8, 1001 ImageNet classes), here only to prove the camera → TFLite pipeline on a phone.

Replace both with the trained MobileNetV3 Small export:

- `model.tflite`: input `[1, 224, 224, 3]`, float32 raw 0–255 pixels (do not normalize) or uint8; output is one score per label.
- `labels.json`: a JSON array in output order, each label `"<item>__<stage>"` with stage one of `fresh`, `good`, `use_soon`, `spoiled`. Example: `["tilapia__fresh", "tilapia__use_soon", ...]`. The item part must match a key in `src/data/shelf-life.json`.

Swapping the files doesn't need a new dev build. Metro bundles them as assets, so reloading the app is enough.
