import shelfLife from '@/data/shelf-life.json';
import type { Confidence, Purchase, Stage, Storage, Urgency } from '@/domain/types';

type Range = [number, number];
const RULES = shelfLife as unknown as Record<string, Record<Storage, Range>>;

const DAYS_AGO: Record<Exclude<Purchase, 'not_sure'>, number> = {
  today: 0,
  this_week: 3,
  over_a_week: 8,
};

export type CookByEstimate = {
  daysLeft: number;
  cookBy: Date;
  confidence: Confidence;
  rescanTomorrow: boolean;
};

/**
 * Suggested cook-by window from the shelf-life table, visual stage and storage.
 * Known purchase date (UC-1.1): count down from the table range, capped by stage.
 * "Not sure" (UC-1.3): use the stage alone, take the shorter end, lower confidence,
 * and tag the item to rescan tomorrow.
 */
export function estimateCookBy(
  item: string,
  storage: Storage,
  stage: Stage,
  purchase: Purchase,
  now = new Date(),
): CookByEstimate {
  const [min, max] = (RULES[item] ?? RULES.default)[storage];
  const stageCap: Record<Stage, number> = {
    fresh: max,
    good: Math.max(1, Math.floor(max / 2)),
    use_soon: 1,
    spoiled: 0,
  };

  let daysLeft: number;
  let confidence: Confidence;
  if (purchase === 'not_sure') {
    daysLeft = Math.min(min, stageCap[stage]);
    confidence = 'low';
  } else {
    daysLeft = Math.min(max - DAYS_AGO[purchase], stageCap[stage]);
    confidence = stage === 'fresh' || stage === 'good' ? 'high' : 'medium';
  }
  daysLeft = Math.max(0, daysLeft);

  const cookBy = new Date(now);
  cookBy.setDate(cookBy.getDate() + daysLeft);
  return { daysLeft, cookBy, confidence, rescanTomorrow: purchase === 'not_sure' };
}

/** UC-2.2 urgency groups. */
export function urgencyGroup(cookBy: string, now = new Date()): Urgency {
  const days = daysUntil(cookBy, now);
  if (days < 0) return 'Check now';
  if (days <= 1) return 'Use today';
  if (days <= 3) return 'Use soon';
  return 'Fresh';
}

export function toIsoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "YYYY-MM-DD" as a local date (new Date(iso) would read it as UTC midnight). */
export function parseIsoDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Whole days from today until `cookBy` (negative = past the estimate). */
export function daysUntil(cookBy: string, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((parseIsoDate(cookBy).getTime() - today.getTime()) / 86_400_000);
}

/** Short countdown for list rows: Today, 1 day, 10 days, 3 wks, 2 mos, Check. */
export function shortCountdown(days: number) {
  if (days < 0) return 'Check';
  if (days === 0) return 'Today';
  if (days < 14) return `${days} day${days === 1 ? '' : 's'}`;
  if (days < 60) return `${Math.round(days / 7)} wks`;
  return `${Math.round(days / 30)} mos`;
}

/** Long countdown for the item detail: Today, 2 days, 3 weeks, 3 months. */
export function longCountdown(days: number) {
  if (days <= 0) return 'Today';
  if (days < 14) return `${days} day${days === 1 ? '' : 's'}`;
  if (days < 60) return `${Math.round(days / 7)} weeks`;
  return `${Math.round(days / 30)} months`;
}
