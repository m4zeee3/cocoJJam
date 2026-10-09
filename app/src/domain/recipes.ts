import data from '@/data/recipes.json';
import type { PantryItem } from '@/db/pantry';
import type { Allergy, Diet, Profile } from '@/db/profile';
import { urgencyGroup } from '@/domain/cook-by';
import { ingredientsFor } from '@/domain/custom-terms';
import { costQty, NOTABLE_CHANGE, priceFor, priceInfo } from '@/domain/prices';

type Ingredient = { item: string; qty: number; unit: string; prep?: string; cost_qty?: number };
export type Recipe = Omit<(typeof data.recipes)[number], 'ingredients' | 'swap'> & {
  ingredients: Ingredient[];
  /** A cheaper recipe to suggest when the main ingredient is pricier than usual (UC-4.3). */
  swap?: string;
};

const RECIPES = data.recipes as Recipe[];

/** Every ingredient key the recipes use, for matching typed-in diets and allergies. */
export const INGREDIENT_KEYS = [...new Set(RECIPES.flatMap((r) => r.ingredients.map((i) => i.item)))];

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
  no_pork: ['pork'],
  halal: ['pork'],
  low_salt: ['salty'],
};
const ALLERGY_EXCLUDES: Record<Allergy, Tag[]> = {
  shellfish: ['shellfish'],
  fish: ['fish'],
  peanuts: ['peanuts'],
  egg: ['egg'],
};

/** A restriction the user can relax for one meal (R08). */
export type Restriction =
  | { kind: 'diet'; value: Diet }
  | { kind: 'allergy'; value: Allergy }
  | { kind: 'other'; value: string };

function blockedBy(recipe: Recipe, profile: Profile): Restriction[] {
  const tags = new Set(recipe.ingredients.flatMap((i) => TAGS[i.item] ?? []));
  const out: Restriction[] = [];
  for (const d of profile.diets) if (DIET_EXCLUDES[d].some((t) => tags.has(t))) out.push({ kind: 'diet', value: d });
  for (const a of profile.allergies) if (ALLERGY_EXCLUDES[a].some((t) => tags.has(t))) out.push({ kind: 'allergy', value: a });
  // Typed-in diets and allergies ("no beef", "walang baboy", "shrimp") rule out the ingredients they name.
  for (const o of [...profile.otherDiets, ...profile.otherAllergies]) {
    const banned = ingredientsFor(o, INGREDIENT_KEYS);
    if (recipe.ingredients.some((i) => banned.has(i.item))) out.push({ kind: 'other', value: o });
  }
  return out;
}

export type Line = {
  item: string;
  name: string;
  /** Rounded amount for the chosen servings, in `unit`. */
  qty: number;
  unit: string;
  amount: string;
  /** Estimated price for this line at the chosen servings; null when the table has no price. */
  cost: number | null;
  have: 'all' | 'some' | 'none';
  haveText?: string;
  /** Part of `cost` still to buy. */
  toBuy: number;
  /** "₱25 each", "₱200/kg midpoint": how the line was priced (E01). */
  unitPrice: string | null;
  /** This month vs the 12-month average (UC-4.2); null without price data. */
  change: number | null;
};

export type RecipeView = Recipe & {
  servingsShown: number;
  lines: Line[];
  cost: number;
  toBuy: number;
  partialCost: boolean;
  /** Ingredients left out of the estimate because they have no price (UC-4.5). */
  unpriced: number;
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
    const info = priceInfo(ing.item);
    const unitPrice = !info || cost == null
      ? null
      : ing.unit === info.unit
        ? `₱${Math.round(info.mid)}/${info.unit} midpoint`
        : `₱${Math.round(cost / qty)} each`;
    return {
      item: ing.item,
      name: NAMES[ing.item] ?? capitalize(ing.item),
      qty,
      unit: ing.unit,
      amount: [formatAmount(qty, ing.unit), ing.prep].filter(Boolean).join(', '),
      cost,
      have,
      haveText,
      toBuy: (cost ?? 0) * missing,
      unitPrice,
      change: info ? info.change : null,
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
    unpriced: lines.filter((l) => l.cost == null).length,
    uses,
    urgentUses: uses.filter((u) => urgent.has(u)).length,
  };
}

export function getRecipe(id: string) {
  return RECIPES.find((r) => r.id === id) ?? null;
}

export const DEFAULT_PROFILE: Profile = {
  diets: [],
  otherDiets: [],
  allergies: [],
  otherAllergies: [],
  household_size: 4,
  weekly_budget_php: null,
};

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
  if (r.kind === 'diet') return { ...profile, diets: profile.diets.filter((d) => d !== r.value) };
  if (r.kind === 'allergy') return { ...profile, allergies: profile.allergies.filter((a) => a !== r.value) };
  return {
    ...profile,
    otherDiets: profile.otherDiets.filter((o) => o !== r.value),
    otherAllergies: profile.otherAllergies.filter((o) => o !== r.value),
  };
}

/** R08 "Or cook it simply": plain methods for the most urgent item. */
export function simpleMethods(item: string) {
  const name = capitalize(item);
  return [
    { title: `Fried ${item} with garlic`, minutes: 15 },
    { title: `Inihaw na ${item} (grilled)`, minutes: 25 },
    { title: `${name} sinabawan (simple ginger soup)`, minutes: 30 },
  ];
}

/**
 * UC-4.3: when the main (first) ingredient is pricier than usual and the
 * recipe names a cheaper swap that fits the profile, how much it saves.
 */
export function swapFor(recipe: Recipe, pantry: PantryItem[], profile: Profile, servings: number) {
  if (!recipe.swap) return null;
  const main = recipe.ingredients[0]?.item;
  const info = main ? priceInfo(main) : null;
  const target = getRecipe(recipe.swap);
  if (!info || info.change < NOTABLE_CHANGE || !target || blockedBy(target, profile).length > 0) return null;
  const from = viewRecipe(recipe, pantry, servings);
  const to = viewRecipe(target, pantry, servings);
  const saves = from.cost - to.cost;
  if (saves < 20) return null;
  const shared = target.ingredients.map((i) => i.item).filter((i) => recipe.ingredients.some((r) => r.item === i));
  return { from, to, saves, main, change: info.change, shared, toMainInPantry: to.lines[0]?.have !== 'none' };
}
