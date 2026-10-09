export type Stage = 'fresh' | 'good' | 'use_soon' | 'spoiled';
export type Storage = 'ref' | 'freezer' | 'counter';
export type Confidence = 'high' | 'medium' | 'low';

/** UC-2.2 urgency groups. */
export type Urgency = 'Check now' | 'Use today' | 'Use soon' | 'Fresh';

/** UC-1.3 purchase-date answers. */
export type Purchase = 'today' | 'this_week' | 'over_a_week' | 'not_sure';

export const STAGE_LABEL: Record<Stage, string> = {
  fresh: 'Fresh',
  good: 'Good',
  use_soon: 'Use soon',
  spoiled: 'Spoiled',
};

export const STORAGE_LABEL: Record<Storage, string> = {
  ref: 'Ref',
  freezer: 'Freezer',
  counter: 'Counter',
};

export const PURCHASE_LABEL: Record<Purchase, string> = {
  today: 'Today',
  this_week: 'This week',
  over_a_week: 'Over a week ago',
  not_sure: 'Not sure',
};

/** Units the user can pick; stored as the value, shown as the label. */
export const UNIT_LABEL: Record<string, string> = { pc: 'pcs', kg: 'kg', g: 'g', bundle: 'bundle' };
