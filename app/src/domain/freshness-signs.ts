import type { Item } from '@/ml/read';

/**
 * The user's own freshness check, per item (UC-1.11): what to look, smell and feel for when
 * the photo can't settle freshness. Each sign has a fresh and a spoiled answer, so the user
 * describes what they see instead of guessing a stage. Pure data and logic (no React Native).
 */
export type Sign = { id: string; label: string; fresh: string; spoiled: string };

const SMELL = (fresh: string, spoiled: string): Sign => ({ id: 'smell', label: 'Smell', fresh, spoiled });
const TEXTURE = (fresh: string, spoiled: string): Sign => ({ id: 'texture', label: 'Feel', fresh, spoiled });

export const SIGNS: Record<Item, Sign[]> = {
  pork: [
    { id: 'color', label: 'Color', fresh: 'Pinkish, white fat', spoiled: 'Grey, green or yellowed fat' },
    SMELL('Little or no smell', 'Sour or rotten'),
    TEXTURE('Firm, springs back', 'Slimy, or a dent stays'),
  ],
  beef: [
    { id: 'color', label: 'Color', fresh: 'Red to purplish-red', spoiled: 'Grey-green or dull all over' },
    SMELL('Little or no smell', 'Sour or rotten'),
    TEXTURE('Firm, slightly moist', 'Slimy or sticky'),
  ],
  chicken: [
    { id: 'color', label: 'Color', fresh: 'Light pink', spoiled: 'Grey, green or yellow-grey' },
    SMELL('Almost no smell', 'Sour, or like rotten eggs'),
    TEXTURE('Moist, springs back', 'Slimy or tacky'),
  ],
  fish: [
    { id: 'eyes', label: 'Eyes', fresh: 'Clear and bulging', spoiled: 'Cloudy or sunken' },
    { id: 'gills', label: 'Gills', fresh: 'Bright red', spoiled: 'Brown, grey or slimy' },
    SMELL('Mild, like the sea', 'Strong fishy, sour or ammonia'),
    TEXTURE('Firm, springs back', 'Soft, or a dent stays'),
  ],
};

/** For a pantry item whose name isn't one of the four. */
const GENERIC: Sign[] = [
  { id: 'color', label: 'Color', fresh: 'Its normal color', spoiled: 'Grey or green' },
  SMELL('Little or no smell', 'Sour or rotten'),
  TEXTURE('Firm, springs back', 'Slimy, or a dent stays'),
];

export function signsFor(item: Item | null): Sign[] {
  return item ? SIGNS[item] : GENERIC;
}

export type Answers = Record<string, 'fresh' | 'spoiled'>;

/**
 * Fresh only when every sign is fresh; any one spoiled sign means spoiled (when in doubt,
 * throw it out). Null until every sign is answered.
 */
export function stageFromSigns(signs: Sign[], answers: Answers): 'fresh' | 'spoiled' | null {
  if (signs.some((s) => !answers[s.id])) return null;
  return signs.some((s) => answers[s.id] === 'spoiled') ? 'spoiled' : 'fresh';
}

/** The spoiled signs the user picked, for the chat reply ("Smell: Sour or rotten"). */
export function spoiledSigns(signs: Sign[], answers: Answers): string[] {
  return signs.filter((s) => answers[s.id] === 'spoiled').map((s) => `${s.label}: ${s.spoiled}`);
}
