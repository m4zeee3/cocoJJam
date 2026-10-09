import { randomUUID } from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

/** UC-3.5: bookmarks live on the phone; signed-in users also sync them to the community count. */
export async function isBookmarked(db: SQLiteDatabase, recipeId: string) {
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM bookmarks WHERE recipe_id = ? AND deleted = 0`,
    recipeId,
  );
  return (row?.n ?? 0) > 0;
}

/** Returns the new state. Removing is a soft delete so other devices learn about it. */
export async function toggleBookmark(db: SQLiteDatabase, recipeId: string): Promise<boolean> {
  const existing = await db.getFirstAsync<{ id: string; deleted: number }>(
    `SELECT id, deleted FROM bookmarks WHERE recipe_id = ? ORDER BY updated_at DESC LIMIT 1`,
    recipeId,
  );
  if (!existing) {
    await db.runAsync(`INSERT INTO bookmarks (id, recipe_id, updated_at) VALUES (?, ?, ?)`, randomUUID(), recipeId, Date.now());
    return true;
  }
  const deleted = existing.deleted ? 0 : 1;
  await db.runAsync(`UPDATE bookmarks SET deleted = ?, updated_at = ?, dirty = 1 WHERE id = ?`, deleted, Date.now(), existing.id);
  return deleted === 0;
}

/** UC-7.2: saved recipes, most recently saved first. */
export function listBookmarks(db: SQLiteDatabase) {
  return db.getAllAsync<{ recipe_id: string; updated_at: number }>(
    `SELECT recipe_id, MAX(updated_at) AS updated_at FROM bookmarks WHERE deleted = 0 GROUP BY recipe_id ORDER BY updated_at DESC`,
  );
}

export async function removeBookmark(db: SQLiteDatabase, recipeId: string) {
  await db.runAsync(`UPDATE bookmarks SET deleted = 1, updated_at = ?, dirty = 1 WHERE recipe_id = ? AND deleted = 0`, Date.now(), recipeId);
}
