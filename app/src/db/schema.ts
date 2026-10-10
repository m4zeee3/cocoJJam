import type { SQLiteDatabase } from 'expo-sqlite';

// Every synced table carries the same sync columns, matching backend/README.md:
//   id          UUID made on the phone
//   owner_id    null for guests
//   updated_at  edit time in ms; the newer edit wins
//   deleted     soft delete, never a hard DELETE
//   dirty       1 = changed since the last push
const SYNC_COLUMNS = `
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  dirty INTEGER NOT NULL DEFAULT 1`;

// Append new migrations to the end; never edit one that has shipped.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE pantry_items (${SYNC_COLUMNS},
    name TEXT NOT NULL,
    category TEXT,
    quantity REAL NOT NULL DEFAULT 1,
    unit TEXT NOT NULL DEFAULT 'pc',
    storage TEXT NOT NULL,            -- ref | freezer | counter
    stage TEXT NOT NULL,              -- fresh | good | use_soon | spoiled
    confidence TEXT NOT NULL,         -- high | medium | low
    date_added TEXT NOT NULL,         -- ISO date
    cook_by TEXT NOT NULL,            -- ISO date
    rescan_tomorrow INTEGER NOT NULL DEFAULT 0,
    thumbnail_uri TEXT,
    paid_price_php REAL,              -- set by Palengke Mode
    status TEXT NOT NULL DEFAULT 'active'  -- active | used | wasted
  );
  CREATE INDEX pantry_active ON pantry_items (status, deleted, cook_by);

  CREATE TABLE scan_history (${SYNC_COLUMNS},
    title TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    messages_json TEXT NOT NULL
  );

  CREATE TABLE bookmarks (${SYNC_COLUMNS},
    recipe_id TEXT NOT NULL
  );

  CREATE TABLE profiles (${SYNC_COLUMNS},
    diet TEXT NOT NULL DEFAULT 'none',
    allergies_json TEXT NOT NULL DEFAULT '[]',
    household_size INTEGER NOT NULL DEFAULT 4,
    weekly_budget_php REAL
  );

  -- Local-only key/value store: sync cursor, signed-in session, flags.
  CREATE TABLE app_state (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
  `,
  // 2: keep the purchase answer so storage/date edits can recompute cook-by (UC-2.3, 2.8),
  // and count scans for the item detail's Scan history (UC-2.4).
  `
  ALTER TABLE pantry_items ADD COLUMN purchase TEXT NOT NULL DEFAULT 'today';
  ALTER TABLE pantry_items ADD COLUMN scan_count INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE pantry_items ADD COLUMN added_at INTEGER NOT NULL DEFAULT 0;
  UPDATE pantry_items SET added_at = updated_at WHERE added_at = 0;
  `,
  // 3: Palengke Mode checks, kept on the phone only (UC-6.1–6.7).
  `
  CREATE TABLE palengke_checks (
    id TEXT PRIMARY KEY NOT NULL,
    created_at INTEGER NOT NULL,
    item TEXT NOT NULL,
    cut TEXT,
    stage TEXT NOT NULL,
    price REAL NOT NULL,
    unit TEXT NOT NULL,           -- kg | pc | tumpok | tray (older rows: tali | bundle)
    verdict TEXT NOT NULL,
    stall TEXT NOT NULL,
    photo_uri TEXT,
    bought INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX palengke_by_day ON palengke_checks (created_at);
  `,
  // 4: Auto Shopping List (UC-9.1), kept on the phone only.
  `
  CREATE TABLE shopping_items (
    id TEXT PRIMARY KEY NOT NULL,
    created_at INTEGER NOT NULL,
    item TEXT NOT NULL,             -- price-table key, e.g. bangus, sitaw
    name TEXT NOT NULL,             -- display name
    qty REAL NOT NULL,
    unit TEXT NOT NULL,
    amount TEXT NOT NULL,           -- "1½ bundles, sliced"
    price REAL,                     -- estimate at this month's prices; null = no price data
    recipe_id TEXT,
    recipe_title TEXT,
    checked INTEGER NOT NULL DEFAULT 0,
    checked_at INTEGER,
    moved_pantry_id TEXT,           -- set when moved to the pantry (its paid price counts there)
    deleted INTEGER NOT NULL DEFAULT 0
  );
  `,
  // 5: a stall keeps its number ("Stall 1") and gets an optional name ("Aling Nena") (M10, M11).
  `
  ALTER TABLE palengke_checks ADD COLUMN stall_name TEXT;
  `,
  // 6: why an item was finished, for the Savings item log (N02): the dish it went into, or why it was wasted.
  `
  ALTER TABLE pantry_items ADD COLUMN finish_note TEXT;
  `,
  // 7: Cook with this plans (UC-2.10, 3.10), kept on the phone only. A plan links a pantry item to the
  // recipe picked for it and to the list rows bought for it; when none are left to buy it shows Done cooking.
  `
  CREATE TABLE cook_plans (
    id TEXT PRIMARY KEY NOT NULL,
    created_at INTEGER NOT NULL,
    pantry_id TEXT NOT NULL,        -- the main ingredient, locked as ticked on the recipe
    recipe_id TEXT NOT NULL,
    recipe_title TEXT NOT NULL,
    uses_json TEXT NOT NULL,        -- [{ id, qty, unit }]: pantry items ticked on the recipe, main first
    status TEXT NOT NULL DEFAULT 'active'  -- active | cooked | cancelled
  );
  CREATE INDEX cook_plans_by_item ON cook_plans (pantry_id, status);

  CREATE TABLE plan_items (
    plan_id TEXT NOT NULL,
    shopping_id TEXT NOT NULL,
    PRIMARY KEY (plan_id, shopping_id)
  );
  `,
];

export async function migrate(db: SQLiteDatabase) {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;
  while (version < MIGRATIONS.length) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(MIGRATIONS[version]);
      await db.execAsync(`PRAGMA user_version = ${version + 1}`);
    });
    version++;
  }
}
