/**
 * Turns a typed-in diet or allergy ("no beef", "walang baboy", "seafood") into
 * the recipe ingredients it rules out. Works offline: a fixed word list plus a
 * plain name match. Text it can't map is still saved and shown, but filters nothing.
 */

const FISH = ['bangus', 'tilapia', 'galunggong', 'patis'];
const SHELLFISH = ['shrimp', 'hipon', 'pusit', 'bagoong', 'alamang'];

/** English and Filipino words → ingredient keys used in recipes.json. */
const ALIASES: Record<string, string[]> = {
  pork: ['pork'], baboy: ['pork'], liempo: ['pork'], kasim: ['pork'],
  chicken: ['chicken'], manok: ['chicken'],
  beef: ['beef'], baka: ['beef'],
  'red meat': ['pork', 'beef'],
  meat: ['pork', 'chicken', 'beef'], karne: ['pork', 'chicken', 'beef'],
  fish: FISH, isda: FISH, milkfish: ['bangus'], 'round scad': ['galunggong'],
  seafood: [...FISH, ...SHELLFISH], shellfish: SHELLFISH, shrimp: SHELLFISH, hipon: SHELLFISH,
  egg: ['egg'], eggs: ['egg'], itlog: ['egg'],
  peanut: ['peanut'], peanuts: ['peanut'], mani: ['peanut'],
  'soy sauce': ['soy sauce'], soy: ['soy sauce'], toyo: ['soy sauce'],
  'fish sauce': ['patis'],
  onion: ['onion'], onions: ['onion'], sibuyas: ['onion'],
  garlic: ['garlic'], bawang: ['garlic'],
  tomato: ['tomato'], tomatoes: ['tomato'], kamatis: ['tomato'],
  ginger: ['ginger'], luya: ['ginger'],
  chili: ['siling haba'], sili: ['siling haba'], spicy: ['siling haba'],
  vinegar: ['vinegar'], suka: ['vinegar'],
  calamansi: ['kalamansi'], kalamansi: ['kalamansi'],
  tamarind: ['sampalok mix'], sampalok: ['sampalok mix'],
};

/** "No beef", "walang baboy", "allergic to shrimp" → "beef", "baboy", "shrimp". */
export function normalizeTerm(text: string) {
  return text
    .trim()
    .toLowerCase()
    .replace(/^(no|not|avoid|without|walang|wala|bawal|hindi|allergic to|allergy to|allergic sa)\s+/, '')
    .replace(/\s+/g, ' ');
}

/**
 * Ingredient keys a typed term rules out. `known` is every ingredient key the
 * recipes use, for a plain name match ("radish" → radish).
 */
export function ingredientsFor(text: string, known: Iterable<string>): Set<string> {
  const term = normalizeTerm(text);
  const out = new Set<string>();
  if (!term) return out;
  // Longest phrases first, and each match is used up, so "red meat" doesn't also count as "meat".
  let rest = ` ${term} `;
  for (const word of Object.keys(ALIASES).sort((x, y) => y.length - x.length)) {
    const re = new RegExp(`\\b${word}\\b`);
    if (re.test(rest)) {
      ALIASES[word].forEach((k) => out.add(k));
      rest = rest.replace(re, ' ');
    }
  }
  for (const k of known) if (term === k || rest.includes(k) || (k.includes(term) && term.length >= 4)) out.add(k);
  return out;
}

/** Whether the app can filter by this term at all (shown as a hint when it can't). */
export function understands(text: string, known: Iterable<string>) {
  return ingredientsFor(text, known).size > 0;
}
