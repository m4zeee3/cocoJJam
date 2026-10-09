import { randomUUID } from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

export type Diet = 'none' | 'no_pork' | 'vegetarian' | 'halal' | 'low_salt';
export type Allergy = 'shellfish' | 'fish' | 'peanuts' | 'egg' | 'other';

export type Profile = {
  diet: Diet;
  allergies: Allergy[];
  household_size: number;
  weekly_budget_php: number | null;
};

export const DIET_LABEL: Record<Diet, string> = {
  none: 'None',
  no_pork: 'No pork',
  vegetarian: 'Vegetarian',
  halal: 'Halal',
  low_salt: 'Low-salt',
};

export const ALLERGY_LABEL: Record<Allergy, string> = {
  shellfish: 'Shellfish',
  fish: 'Fish',
  peanuts: 'Peanuts',
  egg: 'Egg',
  other: 'Other',
};

/** "For 4 · No pork · No shellfish" */
export function profileSummary(p: Profile) {
  const parts = [`For ${p.household_size}`];
  if (p.diet !== 'none') parts.push(DIET_LABEL[p.diet]);
  for (const a of p.allergies) if (a !== 'other') parts.push(`No ${ALLERGY_LABEL[a].toLowerCase()}`);
  return parts.join(' · ');
}

/** Module 5: the one household profile on this phone, or null before setup (UC-5.1). */
export async function getProfile(db: SQLiteDatabase): Promise<Profile | null> {
  const row = await db.getFirstAsync<{ diet: Diet; allergies_json: string; household_size: number; weekly_budget_php: number | null }>(
    `SELECT diet, allergies_json, household_size, weekly_budget_php FROM profiles WHERE deleted = 0 ORDER BY updated_at DESC LIMIT 1`,
  );
  if (!row) return null;
  return {
    diet: row.diet,
    allergies: JSON.parse(row.allergies_json) as Allergy[],
    household_size: row.household_size,
    weekly_budget_php: row.weekly_budget_php,
  };
}

export async function saveProfile(db: SQLiteDatabase, p: Profile) {
  const existing = await db.getFirstAsync<{ id: string }>(`SELECT id FROM profiles WHERE deleted = 0 LIMIT 1`);
  const values = [p.diet, JSON.stringify(p.allergies), p.household_size, p.weekly_budget_php, Date.now()] as const;
  if (existing) {
    await db.runAsync(
      `UPDATE profiles SET diet = ?, allergies_json = ?, household_size = ?, weekly_budget_php = ?, updated_at = ?, dirty = 1 WHERE id = ?`,
      ...values, existing.id,
    );
  } else {
    await db.runAsync(
      `INSERT INTO profiles (id, diet, allergies_json, household_size, weekly_budget_php, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      randomUUID(), ...values,
    );
  }
}
