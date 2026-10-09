/**
 * Photo validation gate (pure logic, no React Native).
 *
 * The freshness model only knows 10 classes, so a selfie or a laptop can still
 * come out as a confident "beef/fresh" (see assets/model/README.md: confidence
 * is not an out-of-distribution detector). Before it runs, a general ImageNet
 * MobileNet (assets/model/gate/) says what the photo looks like; when it is
 * confident the photo shows a person, a live animal, an object, produce or a
 * cooked dish, the scanner stops with a message and the user retakes the photo.
 */

export type GateCategory = 'ok' | 'person' | 'animal' | 'object' | 'produce' | 'cooked';

export type GateReject = {
  category: Exclude<GateCategory, 'ok'>;
  /** The ImageNet label that triggered it, e.g. "laptop". */
  label: string;
  confidence: number;
};

/** How sure the general model must be before a photo is rejected. Tune with real photos. */
export const GATE_MIN: Record<GateReject['category'], number> = {
  person: 0.3,
  animal: 0.35,
  produce: 0.35,
  cooked: 0.4,
  object: 0.45,
};

// Indexes are into the 1001-label file (0 = "background", 1 = "tench" …).
const FISH = new Set([1, 2, 3, 4, 5, 6, 7, 390, 391, 392, 393, 394, 395, 396, 397, 398]);
/** Crabs, lobsters, shrimp-like animals, octopus, snails…: seafood a market photo may show; not rejected. */
const SEAFOOD = new Set([119, 120, 121, 122, 123, 124, 125, 126, 127, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118]);
const ANIMALS_END = 398;

/** Things that sit around raw meat and fish: never a reason to reject. */
const NEUTRAL = new Set([
  'butcher shop', 'plate', 'tray', 'meat loaf', 'frying pan', 'wok', 'Dutch oven', 'caldron', 'mixing bowl',
  'refrigerator', 'grocery store', 'shopping basket', 'shopping cart', 'paper towel', 'packet', 'plastic bag',
  'cleaver', 'wooden spoon', 'spatula', 'ladle', 'chain mail', 'dishrag', 'stove', 'microwave', 'crock pot',
  'hot pot', 'soup bowl', 'bucket', 'tub', 'washbasin', 'bathtub', 'pot', 'mortar', 'scale',
  // A whole dressed chicken is often labelled as a live hen or rooster.
  'hen', 'cock',
  // A pile of whole dead fish is often labelled as a sea mammal.
  'dugong', 'grey whale', 'killer whale', 'sea lion',
]);

const PRODUCE = new Set([
  'guacamole', 'head cabbage', 'broccoli', 'cauliflower', 'zucchini', 'spaghetti squash', 'acorn squash',
  'butternut squash', 'cucumber', 'artichoke', 'bell pepper', 'cardoon', 'mushroom', 'Granny Smith', 'strawberry',
  'orange', 'lemon', 'fig', 'pineapple', 'banana', 'jackfruit', 'custard apple', 'pomegranate', 'corn', 'ear',
  'acorn', 'hip', 'buckeye', 'rapeseed', 'daisy', "yellow lady's slipper",
]);

const COOKED = new Set([
  'consomme', 'trifle', 'ice cream', 'ice lolly', 'French loaf', 'bagel', 'pretzel', 'cheeseburger', 'hotdog',
  'mashed potato', 'carbonara', 'chocolate sauce', 'dough', 'pizza', 'potpie', 'burrito', 'red wine', 'espresso',
  'cup', 'eggnog', 'bakery', 'confectionery', 'pop bottle', 'beer bottle', 'wine bottle', 'water bottle',
]);

/** Items a selfie or a photo of someone tends to be labelled as (ImageNet has no "person" class). */
const PERSON = new Set([
  'wig', 'lipstick', 'sunglasses', 'sunglass', 'mask', 'ski mask', 'gasmask', 'neck brace', 'bow tie',
  'Windsor tie', 'bolo tie', 'jersey', 'sweatshirt', 'suit', 'cardigan', 'lab coat', 'abaya', 'kimono',
  'military uniform', 'bulletproof vest', 'trench coat', 'fur coat', 'cowboy hat', 'sombrero', 'bonnet',
  'shower cap', 'swimming trunks', 'bikini', 'maillot', 'brassiere', 'pajama', 'poncho', 'stole', 'feather boa',
  'hair spray', 'face powder', 'band aid', 'groom', 'scuba diver', 'ballplayer', 'jean', 'miniskirt',
  'cloak', 'academic gown', 'vestment', 'mortarboard', 'hook', 'necklace', 'chain', 'hair slide', 'seat belt',
]);

export function categorize(index: number, label: string): GateCategory {
  if (index === 0) return 'ok';
  if (FISH.has(index) || SEAFOOD.has(index) || NEUTRAL.has(label)) return 'ok';
  if (index <= ANIMALS_END) return 'animal';
  if (PERSON.has(label)) return 'person';
  if (PRODUCE.has(label)) return 'produce';
  if (COOKED.has(label)) return 'cooked';
  return 'object';
}

/**
 * Decide from the general model's scores. Sums each category over the top 5 so
 * "laptop 0.3 + notebook 0.3" counts as a confident object.
 */
export function judgeGate(labels: string[], scores: number[]): GateReject | null {
  const top = scores
    .map((p, i) => ({ i, p }))
    .sort((a, b) => b.p - a.p)
    .slice(0, 5);
  const sums = new Map<GateCategory, { p: number; label: string }>();
  for (const { i, p } of top) {
    const cat = categorize(i, labels[i] ?? '');
    const cur = sums.get(cat);
    sums.set(cat, { p: (cur?.p ?? 0) + p, label: cur?.label ?? labels[i] ?? '' });
  }
  if ((sums.get('ok')?.p ?? 0) >= 0.25) return null; // looks like fish, meat or a kitchen scene
  let worst: GateReject | null = null;
  for (const [cat, { p, label }] of sums) {
    if (cat === 'ok') continue;
    if (p >= GATE_MIN[cat] && (!worst || p > worst.confidence)) worst = { category: cat, label, confidence: p };
  }
  return worst;
}

/** Only name what the photo shows when the general model is this sure; it often mislabels objects. */
const NAME_IT_AT = 0.6;

/** Fish-like share of the general model's top 5 (fish, sea mammals): used to catch fish/meat mix-ups. */
export function fishLikeShare(labels: string[], scores: number[]) {
  const sea = new Set(['dugong', 'grey whale', 'killer whale', 'sea lion']);
  return scores
    .map((p, i) => ({ i, p }))
    .sort((a, b) => b.p - a.p)
    .slice(0, 5)
    .filter(({ i }) => FISH.has(i) || sea.has(labels[i] ?? ''))
    .reduce((s, { p }) => s + p, 0);
}

/**
 * The validation message for a rejected photo (UC-1.7). Plain by default; it
 * says what the photo looks like only when the general model is very sure.
 */
export function gateMessage(r: GateReject) {
  const base = "This doesn't look like raw beef, pork, chicken or fish, so I can't check it.";
  if (r.confidence < NAME_IT_AT) return base;
  const what = {
    person: 'a person',
    animal: 'a live animal',
    object: `${/^[aeiou]/i.test(r.label) ? 'an' : 'a'} ${r.label}`,
    produce: 'fruit or vegetables',
    cooked: 'food that is already cooked or packaged',
  }[r.category];
  return `${base} It looks more like ${what}.`;
}
