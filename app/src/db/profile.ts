import { randomUUID } from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

export type Diet = 'no_pork' | 'vegetarian' | 'halal' | 'low_salt';
export type Allergy = 'shellfish' | 'fish' | 'peanuts' | 'egg';

export type Profile = {
  /** Empty = no restrictions. Pick all that apply (H01). */
  diets: Diet[];
  allergies: Allergy[];
  /** Typed-in allergies ("Other", H02), matched against ingredient names. */
  otherAllergies: string[];
  household_size: number;
  weekly_budget_php: number | null;
};

export const DIET_INFO: Record<Diet, { label: string; hint: string }> = {
  no_pork: { label: 'No pork', hint: 'Hides lechon, liempo, sisig and more' },
  vegetarian: { label: 'Vegetarian', hint: 'No meat or fish' },
  halal: { label: 'Halal', hint: 'No pork or alcohol' },
  low_salt: { label: 'Low-salt', hint: 'Less patis, toyo and bagoong' },
};

export const ALLERGY_INFO: Record<Allergy, { label: string; hint?: string }> = {
  shellfish: { label: 'Shellfish', hint: 'Shrimp, crab, alamang, bagoong' },
  fish: { label: 'Fish', hint: 'Including patis' },
  peanuts: { label: 'Peanuts', hint: 'Kare-kare sauce, some sweets' },
  egg: { label: 'Egg' },
};

/** Short tags: ["4 people", "No pork", "No shellfish", "₱1,500 / week"]. */
export function profileTags(p: Profile, withBudget = false) {
  const tags = [`${p.household_size} ${p.household_size === 1 ? 'person' : 'people'}`];
  for (const d of p.diets) tags.push(DIET_INFO[d].label);
  for (const a of p.allergies) tags.push(`No ${ALLERGY_INFO[a].label.toLowerCase()}`);
  for (const o of p.otherAllergies) tags.push(`No ${o}`);
  if (withBudget && p.weekly_budget_php) tags.push(`₱${p.weekly_budget_php.toLocaleString('en-US')} / week`);
  return tags;
}

/** "For 4 · No pork · No shellfish" */
export function profileSummary(p: Profile) {
  const [, ...rest] = profileTags(p);
  return [`For ${p.household_size}`, ...rest].join(' · ');
}

type Row = { diet: string; allergies_json: string; household_size: number; weekly_budget_php: number | null };

const KNOWN_ALLERGIES = new Set(Object.keys(ALLERGY_INFO));

function fromRow(row: Row): Profile {
  // `diet` holds a JSON array; profiles saved before multi-select hold one word ('none', 'no_pork' …).
  const diets = row.diet.startsWith('[') ? (JSON.parse(row.diet) as Diet[]) : row.diet === 'none' ? [] : [row.diet as Diet];
  const stored = JSON.parse(row.allergies_json) as string[];
  return {
    diets,
    allergies: stored.filter((a) => KNOWN_ALLERGIES.has(a)) as Allergy[],
    otherAllergies: stored.filter((a) => a.startsWith('other:')).map((a) => a.slice(6)),
    household_size: row.household_size,
    weekly_budget_php: row.weekly_budget_php,
  };
}

/** Module 5: the one household profile on this phone, or null before setup (UC-5.1). */
export async function getProfile(db: SQLiteDatabase): Promise<Profile | null> {
  const row = await db.getFirstAsync<Row>(
    `SELECT diet, allergies_json, household_size, weekly_budget_php FROM profiles WHERE deleted = 0 ORDER BY updated_at DESC LIMIT 1`,
  );
  return row ? fromRow(row) : null;
}

export async function saveProfile(db: SQLiteDatabase, p: Profile) {
  const allergies = [...p.allergies, ...p.otherAllergies.map((o) => `other:${o.trim().toLowerCase()}`)];
  const values = [JSON.stringify(p.diets), JSON.stringify(allergies), p.household_size, p.weekly_budget_php, Date.now()] as const;
  const existing = await db.getFirstAsync<{ id: string }>(`SELECT id FROM profiles WHERE deleted = 0 LIMIT 1`);
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

// --- small local flags (app_state) ---------------------------------------------

export async function getFlag(db: SQLiteDatabase, key: string) {
  const row = await db.getFirstAsync<{ value: string }>(`SELECT value FROM app_state WHERE key = ?`, key);
  return row?.value ?? null;
}

export async function setFlag(db: SQLiteDatabase, key: string, value: string) {
  await db.runAsync(`INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, value);
}
