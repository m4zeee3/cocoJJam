import data from '@/data/recipes.json';
import type { PantryItem } from '@/db/pantry';
import type { Allergy, Diet, Profile } from '@/db/profile';
import { urgencyGroup } from '@/domain/cook-by';
import { costQty, priceFor } from '@/domain/prices';

type Ingredient = { item: string; qty: number; unit: string; prep?: string; cost_qty?: number };
export type Recipe = Omit<(typeof data.recipes)[number], 'ingredients'> & { ingredients: Ingredient[] };

const RECIPES = data.recipes as Recipe[];

// What each ingredient means for diets and allergies (UC-3.3).
type Tag = 'pork' | 'meat' | 'fish' | 'shellfish' | 'egg' | 'peanuts' | 'salty';
const TAGS: Record<string, Tag[]> = {
  pork: ['pork', 'meat'],
  chicken: ['meat'],
  beef: ['meat'],
  bangus: ['fish'],
  tilapia: ['fish'],
  galunggong: ['fish'],
  tamban: ['fish'],
  patis: ['fish', 'salty'],
  bagoong: ['shellfish', 'salty'],
  shrimp: ['shellfish'],
  hipon: ['shellfish'],
  pusit: ['shellfish'],
  egg: ['egg'],
  peanut: ['peanuts'],
  'soy sauce': ['salty'],
};

const DIET_EXCLUDES: Record<Diet, Tag[]> = {
  none: [],
  no_pork: ['pork'],
  halal: ['pork'],
  vegetarian: ['meat', 'fish', 'shellfish'],
  low_salt: ['salty'],
};
const ALLERGY_EXCLUDES: Record<Allergy, Tag[]> = {
  shellfish: ['shellfish'],
  fish: ['fish'],
  peanuts: ['peanuts'],
  egg: ['egg'],
  other: [],
};

/** A restriction the user can relax for one meal (R08). */
export type Restriction = { kind: 'diet'; value: Diet } | { kind: 'allergy'; value: Allergy };

function blockedBy(recipe: Recipe, profile: Profile): Restriction[] {
  const tags = new Set(recipe.ingredients.flatMap((i) => TAGS[i.item] ?? []));
  const out: Restriction[] = [];
  if (DIET_EXCLUDES[profile.diet].some((t) => tags.has(t))) out.push({ kind: 'diet', value: profile.diet });
  for (const a of profile.allergies) if (ALLERGY_EXCLUDES[a].some((t) => tags.has(t))) out.push({ kind: 'allergy', value: a });
  return out;
}

export type Line = {
  item: string;
  name: string;
  amount: string;
  /** Estimated price for this line at the chosen servings; null when the table has no price. */
  cost: number | null;
  have: 'all' | 'some' | 'none';
  haveText?: string;
  /** Part of `cost` still to buy. */
  toBuy: number;
};

export type RecipeView = Recipe & {
  servingsShown: number;
  lines: Line[];
  cost: number;
  toBuy: number;
  partialCost: boolean;
  uses: string[];
  urgentUses: number;
};

const NAMES: Record<string, string> = { radish: 'Radish (labanos)', tomato: 'Tomatoes', egg: 'Eggs' };
const PLURAL: Record<string, string> = { pc: 'pcs', bundle: 'bundles', pack: 'packs', cup: 'cups' };

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function roundFor(unit: string, n: number) {
  // Whole pieces past 2 ("5 pcs", not "4½ pcs"); halves below that.
  const step = unit === 'g' ? 50 : unit === 'kg' || unit === 'cup' || unit === 'tbsp' ? 0.25 : n >= 2 ? 1 : 0.5;
  return Math.max(step, Math.round(n / step) * step);
}

/** 1.5 -> "1½", 0.25 -> "¼", 2 -> "2". */
function fraction(n: number) {
  let whole = Math.floor(n);
  let rest = Math.round((n - whole) * 4) / 4;
  if (rest === 1) {
    whole += 1;
    rest = 0;
  }
  const glyph = rest === 0.25 ? '¼' : rest === 0.5 ? '½' : rest === 0.75 ? '¾' : '';
  return whole === 0 && glyph ? glyph : `${whole}${glyph}`;
}

export function formatAmount(qty: number, unit: string) {
  const unitText = qty > 1 && PLURAL[unit] ? PLURAL[unit] : unit;
  return `${fraction(qty)} ${unitText}`;
}

/** One recipe priced and checked against the pantry at `servings` (UC-3.4, 3.7, 4.1). */
export function viewRecipe(recipe: Recipe, pantry: PantryItem[], servings = recipe.servings): RecipeView {
  const factor = servings / recipe.servings;
  const byName = new Map(pantry.map((p) => [p.name, p]));
  const lines: Line[] = recipe.ingredients.map((ing) => {
    const qty = roundFor(ing.unit, ing.qty * factor);
    const cost = priceFor(ing.item, (ing.cost_qty ?? costQty(ing.item, ing.qty, ing.unit)) * factor);
    const own = byName.get(ing.item);
    let have: Line['have'] = 'none';
    let haveText: string | undefined;
    let missing = 1;
    if (own) {
      if (own.unit === ing.unit && own.quantity < qty) {
        have = 'some';
        haveText = `You have ${fraction(own.quantity)} of ${fraction(qty)}`;
        missing = (qty - own.quantity) / qty;
      } else {
        have = 'all';
        missing = 0;
      }
    }
    return {
      item: ing.item,
      name: NAMES[ing.item] ?? capitalize(ing.item),
      amount: [formatAmount(qty, ing.unit), ing.prep].filter(Boolean).join(', '),
      cost,
      have,
      haveText,
      toBuy: (cost ?? 0) * missing,
    };
  });
  const urgent = new Set(pantry.filter((p) => urgencyGroup(p.cook_by) !== 'Fresh').map((p) => p.name));
  const uses = lines.filter((l) => l.have !== 'none').map((l) => l.item);
  return {
    ...recipe,
    servingsShown: servings,
    lines,
    cost: lines.reduce((s, l) => s + (l.cost ?? 0), 0),
    toBuy: lines.reduce((s, l) => s + l.toBuy, 0),
    partialCost: lines.some((l) => l.cost == null),
    uses,
    urgentUses: uses.filter((u) => urgent.has(u)).length,
  };
}

export function getRecipe(id: string) {
  return RECIPES.find((r) => r.id === id) ?? null;
}

export const DEFAULT_PROFILE: Profile = { diet: 'none', allergies: [], household_size: 4, weekly_budget_php: null };

export type Recommendation = {
  matches: RecipeView[];
  /** When nothing matches: restrictions that, relaxed for this meal, would unlock dishes (R08). */
  relax: { restriction: Restriction; count: number; example: string }[];
};

/**
 * UC-3.1 / 3.3: dishes that use pantry items and fit the profile, ranked by how
 * many urgent items they use, then by total items used. `focus` keeps only
 * dishes that use that item ("Cook with this", UC-2.7). Max 6.
 */
export function recommend(pantry: PantryItem[], profile: Profile, focus?: string, max = 6): Recommendation {
  const candidates = RECIPES.map((r) => viewRecipe(r, pantry, profile.household_size)).filter(
    (r) => r.uses.length > 0 && (!focus || r.uses.includes(focus)),
  );
  const matches = candidates
    .filter((r) => blockedBy(r, profile).length === 0)
    .sort((a, b) => b.urgentUses - a.urgentUses || b.uses.length - a.uses.length)
    .slice(0, max);

  const relax = new Map<string, { restriction: Restriction; count: number; example: string }>();
  if (matches.length === 0) {
    for (const r of candidates) {
      const blocks = blockedBy(r, profile);
      if (blocks.length !== 1) continue; // only offer single, simple relaxations
      const key = `${blocks[0].kind}:${blocks[0].value}`;
      const entry = relax.get(key) ?? { restriction: blocks[0], count: 0, example: r.title };
      entry.count++;
      relax.set(key, entry);
    }
  }
  return { matches, relax: [...relax.values()] };
}

/** Drop one restriction from a profile for this meal only (UC-3.6). */
export function relaxProfile(profile: Profile, r: Restriction): Profile {
  return r.kind === 'diet'
    ? { ...profile, diet: 'none' }
    : { ...profile, allergies: profile.allergies.filter((a) => a !== r.value) };
}

/** R08 "Or cook it simply": plain methods for the most urgent item. */
export function simpleMethods(item: string) {
  const name = capitalize(item);
  return [
    { title: `Steamed ${item} with tomato and onion`, minutes: 15 },
    { title: `${name} salad (ensalada)`, minutes: 10 },
    { title: `Stir-fried ${item} with garlic`, minutes: 12 },
  ];
}
