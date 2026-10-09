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

## Sign-in and sync (optional)

Guests can use everything. Google sign-in adds backup, sync and community bookmark counts.

1. Start the backend (see [../backend/README.md](../backend/README.md)) with `--host 0.0.0.0`.
2. Copy `.env.example` to `.env` and set `EXPO_PUBLIC_API_URL` to your laptop's LAN IP, e.g. `http://192.168.1.20:8000`. Restart `npm start` after changing it.
3. Google sign-in needs a dev build, so it won't work in Expo Go. After changing native config, run `npx expo prebuild --clean` once.
4. Your Google account must be listed as a test user on the OAuth consent screen.

OAuth client IDs are in `src/constants/config.ts`. The Android client is tied to package `com.cocojjam.app` plus the debug keystore's SHA-1. An EAS build needs its own SHA-1 added in Google Cloud.

## Where things are

| Path | What |
|---|---|
| `src/app/(tabs)/` | Screens: Home, Pantry, Scan (center button), Palengke, Library |
| `src/ml/` | On-device model: photo preprocessing and `classify()` |
| `assets/model/` | `model.tflite` + `labels.json` (placeholder now; see its README) |
| `src/db/` | SQLite schema and migrations, pantry queries |
| `src/domain/` | Cook-by estimate and urgency groups |
| `src/data/` | Bundled tables: shelf life, prices, recipes |
| `src/sync/` | Google sign-in, push/pull sync with the backend, guest-data merge |

## Checks

```bash
npm run typecheck
npm run lint
```
