# On-device model

`model.tflite` and `labels.json` are loaded by `src/ml/classifier.ts`. Labels are read in `src/ml/labels.ts`.

**The current files are a placeholder:** Google's stock MobileNet v1 (uint8, 1001 ImageNet classes), here only to prove the camera → TFLite pipeline works.

## Replacing them with the trained model

- **`model.tflite`:** input `[1, 224, 224, 3]` as raw 0–255 pixels (don't normalize; Keras MobileNetV3 rescales inside the model), float32 or uint8. Output is one score per label, softmax.
- **`labels.json`:** a JSON array **in the model's output order**, using the training run's labels as they are:

```json
["beef/fresh", "beef/spoiled", "chicken/fresh", "chicken/spoiled",
 "fish/eye-fresh", "fish/eye-non-fresh", "fish/gill-fresh", "fish/gill-non-fresh",
 "pork/fresh", "pork/spoiled"]
```

Copy the training run's own `labels.json` so the order is guaranteed to match.

## How the app reads the output

| Model output | App |
|---|---|
| `<item>/…` with item `beef`, `chicken`, `pork` or `fish` | The item is the group with the highest summed score |
| `fresh` vs `spoiled` / `non-fresh` | **P(fresh)** within that group maps to the app's 4 stages: ≥ 0.85 Fresh, ≥ 0.65 Good, ≥ 0.40 Use soon, otherwise Spoiled (`STAGE_THRESHOLDS` in `src/ml/labels.ts`; tune these) |
| `fish/eye-…` vs `fish/gill-…` | Shown as the reason ("Checked by the gills · looks fresh") |
| `fish` | The app asks "Which fish is it?" (Bangus, Tilapia, Galunggong, Other fish), since price and shelf life depend on the species |

The app covers beef, pork, chicken and fish only. A new item class needs a matching key in `src/data/shelf-life.json` and `src/data/prices.json`.

Swapping these files doesn't need a new dev build. Metro bundles them as assets, so reloading the app is enough. A standalone APK must be rebuilt to include them.
