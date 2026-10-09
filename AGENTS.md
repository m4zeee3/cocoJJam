# Agent instructions

1-day hackathon build, theme "local AI". Ship a working offline demo over polish.

Read [ARCHITECTURE.md](ARCHITECTURE.md) before making structural changes.
Use cases are tagged UC-<module>.<n>, matching the plan doc and the FigJam board linked there. Reference the UC id in commit messages.

## Hard rules

- Every core feature must work in airplane mode: scan, pantry, recipes, prices, Palengke Mode, savings, notifications.
- SQLite on the phone is the source of truth. The backend is an optional mirror.
- The app talks only to the FastAPI backend, never to MongoDB, and no database credentials go into `app/`.
- Photos stay on the device. Never upload images.
- Synced rows use phone-made UUID ids, `updated_at` in ms, and soft deletes (`deleted: true`).
- Guests can use everything. Sign-in only adds sync and community bookmark counts.

## Commands

Backend (`backend/`, Python 3.11):

```bash
source .venv/bin/activate
uvicorn app.main:app --reload --host 0.0.0.0
TEST_MONGODB_URI=mongodb://localhost:27017 pytest
```

App (`app/`, Expo):

```bash
npx expo run:android    # or run:ios; a dev build is needed for TFLite and Google Sign-In, Expo Go will not work
```

ML (`ml/`, Python 3.11): training notebooks and the export script write `model.tflite` and `labels.json` to `app/assets/model/`.

## Conventions

- App code is TypeScript. Backend code uses type hints and Pydantic models.
- Keep chatbot replies short, in Taglish where natural.
- Prices are in PHP for the NCR region, labelled "as of" the price table's date.
- Never commit `.env` files or secrets.
