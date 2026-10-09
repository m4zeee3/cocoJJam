import prices from '@/data/prices.json';
import type { Stage } from '@/domain/types';

type Variant = { label: string; sub: string; low: number; high: number };
type Row = { unit: string; low: number; high: number; piece_qty: number; variants?: Record<string, Variant> };
const TABLE = prices.items as Record<string, Row>;

/** "Oct 7": the date of the reference prices. */
export const REFERENCE_DATE = (() => {
  const [y, m, d] = prices.updated.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
})();

/** Units a meat or fish vendor may quote. A tumpok is a small pile of fish; a tray is a pre-packed tray. */
export type VendorUnit = 'kg' | 'pc' | 'tumpok' | 'tray';
export const VENDOR_UNIT_LABEL: Record<VendorUnit, string> = { kg: 'per kg', pc: 'per piece', tumpok: 'per tumpok', tray: 'per tray' };
// tali/bundle: older checks saved before the meat-and-fish scope.
const SHORT_UNIT: Record<string, string> = { kg: 'kg', pc: 'pc', tumpok: 'tumpok', tray: 'tray', tali: 'tali', bundle: 'bundle', pack: 'pack', bottle: 'bottle' };

/**
 * About how many kg one tumpok or tray holds, to turn a vendor's price into a per-kg price (UC-6.5).
 * Sample values: piles and trays vary, so the tip always says to ask the vendor.
 */
const UNIT_KG: Record<'tumpok' | 'tray', Record<string, number>> = {
  tumpok: { galunggong: 0.4, tilapia: 1, bangus: 1, default: 0.5 },
  tray: { chicken: 1, pork: 0.5, beef: 0.5, default: 0.5 },
};

/** Typical kg in one `unit` of `item` (piece weight from the price table), or null when unknown. */
export function unitKg(item: string, unit: VendorUnit): number | null {
  if (unit === 'kg') return 1;
  if (unit === 'pc') return TABLE[item]?.piece_qty ?? null;
  const w = UNIT_KG[unit];
  return w ? (w[item] ?? w.default) : null;
}

const UNIT_NOUN: Record<VendorUnit, string> = { kg: 'kilo', pc: 'piece', tumpok: 'tumpok', tray: 'tray' };

export function unitShort(u: string) {
  return SHORT_UNIT[u] ?? u;
}

/** UC-6.4: cuts with their own price range, or null when the item has none. */
export function variantsOf(item: string) {
  const v = TABLE[item]?.variants;
  return v ? Object.entries(v).map(([id, x]) => ({ id, ...x })) : null;
}

export type Reference = { low: number; high: number; unit: string };

/** M03b "Not sure": generic fish spans every fish species in the table. */
function generalFishRange(): Reference | null {
  const rows = Object.values(TABLE).filter((r) => (r as { category?: string }).category === 'fish' && r.unit === 'kg');
  if (!rows.length) return null;
  return { low: Math.min(...rows.map((r) => r.low)), high: Math.max(...rows.map((r) => r.high)), unit: 'kg' };
}

/** This month's usual range for the item (and cut), in the table's unit. Null when not in the table. */
export function usualRange(item: string, cut?: string | null): Reference | null {
  const row = TABLE[item];
  if (!row) return item === 'fish' ? generalFishRange() : null;
  const v = cut ? row.variants?.[cut] : undefined;
  return { low: v?.low ?? row.low, high: v?.high ?? row.high, unit: row.unit };
}

const sameUnit = (vendor: VendorUnit, table: string) => vendor === table;

export type VerdictKind = 'good_buy' | 'haggle' | 'cook_today' | 'skip' | 'dont_buy' | 'no_reference';
export type PriceBand = 'below' | 'within' | 'above';

export type Verdict = {
  kind: VerdictKind;
  band: PriceBand | null;
  title: string;
  body: string;
  /** e.g. "Pwede po bang ₱220 na lang?" */
  haggleLine?: string;
  /** UC-6.5 tip when the vendor's unit has no reference. */
  unitTip?: string;
};

/**
 * UC-6.1–6.5: one buy verdict from the vendor's price and the freshness stage.
 * A spoiled item is always "Don't buy", whatever the price.
 */
export function judge(item: string, cut: string | null, stage: Stage, price: number, unit: VendorUnit): Verdict {
  const fresh = stage === 'fresh' || stage === 'good';
  if (stage === 'spoiled') {
    return { kind: 'dont_buy', band: null, title: "Don't buy", body: 'This looks spoiled. Try another stall.' };
  }
  const ref = usualRange(item, cut);
  if (!ref || !sameUnit(unit, ref.unit)) {
    let unitTip: string | undefined;
    const kg = unitKg(item, unit);
    if (ref && ref.unit === 'kg' && kg) {
      const perKg = Math.round(price / kg);
      const grams = Math.round(kg * 1000);
      const inRange = perKg >= ref.low && perKg <= ref.high ? 'within' : perKg > ref.high ? 'above' : 'below';
      const size = grams >= 1000 ? `${kg} kg` : `${grams} g`;
      unitTip = `Ask the vendor how heavy one ${UNIT_NOUN[unit]} is. At about ${size}, ₱${price} works out to roughly ₱${perKg}/kg, which is ${inRange} the usual range.`;
    } else if (ref) {
      unitTip = `Ask how much it weighs to compare with the usual ₱${ref.low}–₱${ref.high} per ${unitShort(ref.unit)}.`;
    }
    return {
      kind: 'no_reference',
      band: null,
      title: `No price check for “${VENDOR_UNIT_LABEL[unit]}”`,
      body: ref
        ? `I only have a per ${unitShort(ref.unit)} reference for ${item}. Freshness looks ${fresh ? 'good' : 'so-so'}.`
        : `I don't have a reference price for ${item} yet. Freshness looks ${fresh ? 'good' : 'so-so'}.`,
      unitTip,
    };
  }

  const band: PriceBand = price > ref.high ? 'above' : price < ref.low ? 'below' : 'within';
  if (band === 'above' && fresh) {
    return {
      kind: 'haggle',
      band,
      title: 'Try to haggle',
      body: `₱${price - ref.high} above the usual range, but it looks fresh. Aim for ₱${ref.high} or less.`,
      haggleLine: `Try: “Pwede po bang ₱${ref.high} na lang?”`,
    };
  }
  if (band === 'above') {
    return { kind: 'skip', band, title: 'Skip this one', body: 'Above the usual range and not very fresh. Try another stall.' };
  }
  if (!fresh) {
    return { kind: 'cook_today', band, title: 'Fair price, cook it today', body: "Only buy if you're cooking tonight. It's already soft." };
  }
  return {
    kind: 'good_buy',
    band,
    title: 'Good buy',
    body: band === 'below' ? 'Below the usual price and it looks fresh.' : 'Fair price and it looks fresh.',
  };
}

export const VERDICT_LABEL: Record<VerdictKind, string> = {
  good_buy: 'Good buy',
  haggle: 'Above usual',
  cook_today: 'Cook today',
  skip: 'Skipped',
  dont_buy: "Don't buy",
  no_reference: 'No reference',
};

// --- UC-6.7 compare stalls ---------------------------------------------------

export type StallCheck = { id: string; stall: string; stage: Stage; price: number; unit: VendorUnit; created_at: number };

const STAGE_RANK: Record<Stage, number> = { fresh: 0, good: 1, use_soon: 2, spoiled: 3 };

/**
 * Up to 4 stalls: spoiled ones dropped, freshest stage first, then lowest price.
 * Returns the ranking plus a one-line verdict, or a fresher-vs-cheaper trade-off
 * when the runner-up is cheaper but less fresh.
 */
export function rankStalls(checks: StallCheck[]) {
  const ranked = checks
    .filter((c) => c.stage !== 'spoiled')
    .sort((a, b) => STAGE_RANK[a.stage] - STAGE_RANK[b.stage] || a.price - b.price)
    .slice(0, 4);
  const [best, ...rest] = ranked;
  if (!best) return { ranked, best: null, tradeOff: null, title: 'No good stall yet', body: 'Every stall so far looks spoiled.' };

  const cheaper = rest.find((c) => c.price < best.price);
  if (cheaper) {
    return {
      ranked,
      best,
      tradeOff: cheaper,
      title: 'Fresher vs cheaper',
      body: `${best.stall} is fresher. ${cheaper.stall} is ₱${best.price - cheaper.price}/${unitShort(best.unit)} cheaper but needs cooking ${cheaper.stage === 'use_soon' ? 'today' : 'sooner'}.`,
    };
  }
  const next = rest[0];
  const saving = next ? next.price - best.price : 0;
  const freshest = !next || STAGE_RANK[best.stage] < STAGE_RANK[next.stage];
  const reasons = [freshest ? "It's the freshest" : 'Just as fresh', saving > 0 ? `₱${saving}/${unitShort(best.unit)} cheaper than the next best` : null]
    .filter(Boolean)
    .join(' and ');
  return { ranked, best, tradeOff: null, title: `Buy at ${best.stall}`, body: `${reasons}.` };
}
