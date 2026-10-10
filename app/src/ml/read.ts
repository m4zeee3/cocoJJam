/**
 * Reads the freshness model's 10 calibrated probabilities into something the
 * chat can say safely. Pure logic (no React Native) so it can be tested.
 *
 * The model is overconfident outside its training data (faces, fish piles) and
 * mixes up beef and pork, so the app never shows raw class guesses or
 * percentages: it names the most likely item, asks the user to confirm it, and
 * only uses the model's freshness when the item is confirmed.
 */

export type Item = 'beef' | 'pork' | 'chicken' | 'fish';
export const ITEMS: Item[] = ['beef', 'pork', 'chicken', 'fish'];

type Scored = { item: string; finding: 'fresh' | 'spoiled' | 'non-fresh'; view: 'eye' | 'gill' | null; confidence: number };

export type ItemRead = {
  item: Item;
  /** Sum of this item's class probabilities. */
  share: number;
  /** Share of this item's probability that is "fresh". */
  freshShare: number;
  /** Fish only: the view (eye or gill) the model leaned to. */
  view: 'eye' | 'gill' | null;
};

/** Per-item summary, most likely first. */
export function readItems(all: Scored[]): ItemRead[] {
  return ITEMS.map((item): ItemRead => {
    const rows = all.filter((g) => g.item === item);
    const share = rows.reduce((s, g) => s + g.confidence, 0);
    const fresh = rows.filter((g) => g.finding === 'fresh').reduce((s, g) => s + g.confidence, 0);
    const eye = rows.filter((g) => g.view === 'eye').reduce((s, g) => s + g.confidence, 0);
    const gill = rows.filter((g) => g.view === 'gill').reduce((s, g) => s + g.confidence, 0);
    return {
      item,
      share,
      freshShare: share > 0 ? fresh / share : 0,
      view: item === 'fish' ? (eye >= gill ? 'eye' : 'gill') : null,
    };
  }).sort((a, b) => b.share - a.share);
}

/** What the user said they were scanning on the camera screen. */
export type Kind = 'meat' | 'fish';

export type Verdict = {
  /** Most likely item, to pre-select in "Is this beef?". */
  best: ItemRead;
  /** Sure enough to say "This looks like beef". Otherwise "I can't tell for sure". */
  confident: boolean;
  /** Why it isn't confident, for logging. */
  reason?: 'low' | 'close_call' | 'fish_vs_meat' | 'kind_mismatch';
};

/**
 * `threshold` is the model's calibrated confidence threshold (deployment.json).
 * `fishLike` is how much the general model saw fish in the photo.
 * `kind` is the Meat/Fish choice on the camera, when the photo came from there.
 */
export function judgeItems(items: ItemRead[], topConfidence: number, threshold: number, fishLike: number, kind?: Kind): Verdict {
  const [best, second] = items;
  if (topConfidence < threshold) return { best, confident: false, reason: 'low' };
  // Two items nearly tied (e.g. beef 0.55 vs pork 0.45): don't pretend to know.
  if (second && best.share - second.share < 0.3) return { best, confident: false, reason: 'close_call' };
  // The general model clearly sees fish but this one says meat (or the reverse).
  if (best.item !== 'fish' && fishLike >= 0.3) return { best, confident: false, reason: 'fish_vs_meat' };
  // The user said Fish but the model says meat (or the reverse): fillets and slices read as pork.
  if (kind && (best.item === 'fish') !== (kind === 'fish')) return { best, confident: false, reason: 'kind_mismatch' };
  return { best, confident: true };
}

export type FreshRead = 'fresh' | 'spoiled' | 'unclear';

/**
 * Freshness for the item the user confirmed. Trusted only when the model was
 * confident, the user confirmed the item it named, and it's clear about fresh
 * vs spoiled. Otherwise "unclear": the app asks the user's own check, never guesses.
 * Fish "non-fresh" is a visual observation, not spoilage (assets/model/README.md),
 * so fish is only ever "fresh" or "unclear".
 *
 * Only "spoiled" is acted on straight away. "fresh" is a hint: the model has called
 * spoiled pork fresh, and a photo can't show smell or slime, so the user's own check
 * (components/freshness-check.tsx) always sets the stage. A false "spoiled" wastes food; a false "fresh" is unsafe.
 */
export function freshnessFor(items: ItemRead[], item: Item, verdict: Verdict): FreshRead {
  if (!verdict.confident || item !== verdict.best.item) return 'unclear';
  const r = items.find((i) => i.item === item);
  if (!r) return 'unclear';
  if (r.freshShare >= 0.8) return 'fresh';
  if (r.freshShare <= 0.2 && item !== 'fish') return 'spoiled';
  return 'unclear';
}

const FISH_NAMES = ['fish', 'bangus', 'tilapia', 'galunggong'];

/** Which of the four items a saved pantry name belongs to ("Pork liempo" → pork), or null. */
export function itemOf(name: string): Item | null {
  const n = name.toLowerCase();
  return (['beef', 'pork', 'chicken'] as Item[]).find((i) => n.includes(i)) ?? (FISH_NAMES.some((f) => n.includes(f)) ? 'fish' : null);
}
