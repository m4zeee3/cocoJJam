# Architecture

Offline-first, on-device AI kitchen assistant. Every core feature runs on the phone with no network.
The cloud is used only for optional sign-in, sync and community bookmark counts.

- Product plan and use cases (UC-x.x): [Final Module Plan & Use Cases](https://claude.ai/code/artifact/d8d5b152-79ed-43ab-9f66-231523b4649a)
- User flows: [FigJam board](https://www.figma.com/board/eAlR4NtS1nZyFr3ckun6dz/Untitled?node-id=0-1)

## System

```
┌──────────────── Phone (Expo / React Native) ────────────────┐
│  Camera / gallery ─► TFLite model (MobileNetV3 Small)        │
│                         │ item + freshness stage             │
│                         ▼                                    │
│  Rules: shelf-life table, seasonal price table (bundled)     │
│                         ▼                                    │
│  SQLite  ◄── source of truth for all app data                │
│  Local notifications (expiry)                                │
└───────────────┬──────────────────────────────────────────────┘
                │ only when signed in + online
                ▼
        FastAPI (backend/)  ──►  MongoDB Atlas
```

The phone never connects to MongoDB directly.

## Repo layout

| Folder | What | Stack |
|---|---|---|
| `app/` | Mobile app | Expo (dev build), TypeScript, `expo-sqlite`, `react-native-fast-tflite` |
| `backend/` | Sync API | Python 3.11, FastAPI, PyMongo async, MongoDB Atlas |
| `ml/` | Model training and export | Python 3.11, TensorFlow + Keras, TFLite converter |

## On-device AI (`ml/` → `app/`)

1. Fine-tune Keras `MobileNetV3Small` (ImageNet weights) on freshness classes.
2. Export with the TFLite converter using float16 or int8 quantization. Target size is under 5 MB.
3. Copy `model.tflite` and `labels.json` into `app/assets/model/`.
4. In the app, resize the photo to 224×224 RGB and run it with `react-native-fast-tflite`.

Preprocessing must match training. Keras `MobileNetV3Small` rescales inside the model, so the app feeds raw 0–255 pixel values and must not normalize them itself.

The model returns a class and a confidence. A low confidence triggers "show top 2–3 guesses" (UC-1.4).
Cook-by dates come from the shelf-life rules table, not from the model.

## Local data (SQLite)

Tables mirror the synced collections: `pantry_items`, `scan_history`, `bookmarks`, `profiles`.
The price table and shelf-life rules ship as bundled read-only data.
Savings totals are computed from pantry items marked Used or Wasted.

Every synced row has:

- `id`: a UUID made on the phone
- `updated_at`: edit time in ms
- `deleted`: soft-delete flag, never a hard delete
- `owner_id`: null for guests

## Sync (`backend/`)

- Changes queue locally. When signed in and online, the app calls `POST /sync/push`, then `GET /sync/pull?since=<cursor>`.
- The newer `updated_at` wins. Pulled records may repeat, so apply them by `id`.
- On first sign-in, the app asks whether to upload local guest data (UC-11.3), then restores the server data (UC-11.4).
- Bookmark counts come from `GET /recipes/counts`, counted from synced bookmarks.

Full contract: [backend/README.md](backend/README.md).
