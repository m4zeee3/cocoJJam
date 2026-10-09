/**
 * The model says "fish" but can't tell the species, and price and shelf life
 * depend on it, so the app asks. "fish" (Other fish) uses the generic rules
 * and has no reference price.
 */
export const FISH_SPECIES: { value: string; label: string; sub?: string }[] = [
  { value: 'bangus', label: 'Bangus', sub: 'Milkfish' },
  { value: 'tilapia', label: 'Tilapia', sub: 'Freshwater' },
  { value: 'galunggong', label: 'Galunggong', sub: 'Round scad' },
  { value: 'fish', label: 'Other fish' },
];

export const isGenericFish = (item: string) => item === 'fish';
