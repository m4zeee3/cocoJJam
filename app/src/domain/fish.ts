/**
 * The model says "fish" but can't tell the species, and price and shelf life
 * depend on it, so the app asks. "fish" (Other fish) uses the generic rules
 * and has no reference price.
 */
export const FISH_SPECIES: { value: string; label: string }[] = [
  { value: 'bangus', label: 'Bangus' },
  { value: 'tilapia', label: 'Tilapia' },
  { value: 'galunggong', label: 'Galunggong' },
  { value: 'fish', label: 'Other fish' },
];

export const isGenericFish = (item: string) => item === 'fish';
