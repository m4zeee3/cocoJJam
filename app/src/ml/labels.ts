import type { Stage } from '@/domain/types';

/**
 * Turns raw model scores into app guesses.
 *
 * The trained model's labels are "<item>/<state>":
 *   beef/fresh, beef/spoiled, chicken/fresh, chicken/spoiled, pork/fresh, pork/spoiled,
 *   fish/eye-fresh, fish/eye-non-fresh, fish/gill-fresh, fish/gill-non-fresh
 * It knows 2 states, the app has 4 stages, so the stage comes from how sure the
 * model is that the item is fresh. Fish is judged by its eye or gills; the
 * species (bangus, tilapia …) is asked separately because the model can't tell.
 *
 * Also accepted: "<item>__<stage>" (stage given directly), and plain labels with
 * no state (the ImageNet placeholder), which get no stage.
 */

export type FishView = 'eye' | 'gill';

export type Guess = {
  /** Item key: beef, chicken, pork, fish (or a placeholder label). */
  item: string;
  stage: Stage | null;
  /** How sure the model is about the item, 0–1 (sum of that item's classes). */
  confidence: number;
  /** How sure it is that the item is fresh, 0–1; null when the label has no state. */
  freshness: number | null;
  /** Fish only: which part the model looked at. */
  view?: FishView;
  /** The single top label, for debugging. */
  label: string;
};

/** Stage from P(fresh). Starting thresholds: tune them with the ML teammate. */
export const STAGE_THRESHOLDS = { fresh: 0.85, good: 0.65, use_soon: 0.4 } as const;

export function stageFromFreshness(p: number): Stage {
  if (p >= STAGE_THRESHOLDS.fresh) return 'fresh';
  if (p >= STAGE_THRESHOLDS.good) return 'good';
  if (p >= STAGE_THRESHOLDS.use_soon) return 'use_soon';
  return 'spoiled';
}

type Parsed = { item: string; fresh: boolean | null; stage?: Stage; view?: FishView };

function parse(label: string): Parsed {
  if (label.includes('/')) {
    const [item, state = ''] = label.split('/');
    const view = state.startsWith('eye') ? 'eye' : state.startsWith('gill') ? 'gill' : undefined;
    const fresh = !/(non-fresh|spoiled|not-fresh|stale)/.test(state) && /fresh/.test(state);
    return { item, fresh, view };
  }
  if (label.includes('__')) {
    const [item, stage] = label.split('__');
    return { item, fresh: null, stage: stage as Stage };
  }
  return { item: label, fresh: null };
}

/** Group scores by item and work out each item's stage. Best guess first. */
export function interpret(labels: string[], scores: number[], top = 3): Guess[] {
  const byItem = new Map<string, { total: number; fresh: number; hasState: boolean; best: { label: string; p: number; parsed: Parsed }; views: Record<FishView, number> }>();
  scores.forEach((p, i) => {
    const label = labels[i] ?? `class_${i}`;
    const parsed = parse(label);
    const entry = byItem.get(parsed.item) ?? {
      total: 0,
      fresh: 0,
      hasState: false,
      best: { label, p: -1, parsed },
      views: { eye: 0, gill: 0 },
    };
    entry.total += p;
    if (parsed.fresh !== null) {
      entry.hasState = true;
      if (parsed.fresh) entry.fresh += p;
    }
    if (parsed.view) entry.views[parsed.view] += p;
    if (p > entry.best.p) entry.best = { label, p, parsed };
    byItem.set(parsed.item, entry);
  });

  return [...byItem.entries()]
    .map(([item, e]): Guess => {
      const freshness = e.hasState && e.total > 0 ? e.fresh / e.total : null;
      const stage = freshness != null ? stageFromFreshness(freshness) : (e.best.parsed.stage ?? null);
      const view = e.views.eye + e.views.gill > 0 ? (e.views.eye >= e.views.gill ? 'eye' : 'gill') : undefined;
      return { item, stage, confidence: e.total, freshness, view, label: e.best.label };
    })
    .filter((g) => g.confidence > 0.005)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, top);
}

/** "Checked by the gills · looks fresh": the visual reason for a fish stage. */
export function viewNote(g: Pick<Guess, 'view' | 'stage'>) {
  if (!g.view || !g.stage) return null;
  const part = g.view === 'eye' ? 'the eye' : 'the gills';
  const looks = g.stage === 'fresh' || g.stage === 'good' ? 'looks fresh' : g.stage === 'use_soon' ? 'starting to dull' : 'looks spoiled';
  return `Checked by ${part} · ${looks}`;
}
