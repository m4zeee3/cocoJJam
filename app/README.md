# cocoJJAM app

Expo (SDK 57) app. Every core feature runs offline: the model runs on the phone and data lives in SQLite.
See [../ARCHITECTURE.md](../ARCHITECTURE.md) for how it fits with the backend and the model.

## Run it

TFLite needs native code, so **Expo Go will not work**. Build a development build once, then iterate with fast refresh.

```bash
npm install
npm run android     # needs Android Studio + JDK 17, and a phone with USB debugging or an emulator
npm run ios         # needs Xcode; a real iPhone needs a signing team
```

No local toolchain? Build in the cloud instead: `npx eas-cli@latest build --profile development --platform android`, then install the APK on the phone.

After the first build, `npm start` is enough until you add another native package.

## Where things are

| Path | What |
|---|---|
| `src/app/(tabs)/` | Screens: Home, Pantry, Scan (center button), Palengke, Library |
| `src/ml/` | On-device model: photo preprocessing and `classify()` |
| `assets/model/` | `model.tflite` + `labels.json` (placeholder now; see its README) |
| `src/db/` | SQLite schema and migrations, pantry queries |
| `src/domain/` | Cook-by estimate and urgency groups |
| `src/data/` | Bundled tables: shelf life (prices and recipes go here too) |

## Checks

```bash
npm run typecheck
npm run lint
```
