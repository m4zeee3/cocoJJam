import type { Item } from '@/ml/read';
import type { Stage } from '@/domain/types';

/**
 * Every scan reply in one place, worded safely (UC-1.4–1.9): no percentages,
 * no raw model labels, and freshness is always "a visual estimate, not a
 * food-safety check".
 */

export const ITEM_NAME: Record<Item, string> = { beef: 'beef', pork: 'pork', chicken: 'chicken', fish: 'fish' };

export const SCAN_TIPS = ['One item per photo, filling the frame', 'Good light, no strong shadows', 'For fish, a close-up of the eye or gills'];

export const MSG = {
  face: "I can see a face in this photo. I can only check raw beef, pork, chicken or fish. Please take a photo of the food itself.",
  notSupported: "Okay, I'll stop here. I can only check raw beef, pork, chicken or fish.",
  tryRaw: 'Try a photo of a raw item, like fish from the market or pork in your ref.',
  unsure: "I can't tell for sure what this is from the photo. Please try another photo.",
  /** The user said No to the model's item: loop back to a new photo. */
  notIt: "Okay, let's try another photo.",
  looksLike: (item: Item) => `This looks like ${ITEM_NAME[item]}. Is that right?`,
  confirmHint: 'Your answer sets the item. The photo only suggests it.',
  /** UC-1.11 (S15, S09b): freshness unclear, so the user retakes a close-up. */
  retake: (item: Item) =>
    item === 'fish'
      ? "I'm sure it's a fish, but the eyes and gills are too small or hidden to read freshness. Please retake the photo up close to the eye and gills so I can check its freshness."
      : `This is ${ITEM_NAME[item]}, but I can't read its freshness from this photo. Please retake it up close.`,
  unclearFreshness: "I can't judge its freshness reliably from this photo.",
  fishView: (view: 'eye' | 'gill') =>
    `The fish's ${view === 'eye' ? 'eye' : 'gills'} look less fresh in this photo. That alone doesn't mean it's spoiled.`,
  ownCheck: 'Based on your own check (smell, color, texture), how does it look?',
  disclaimer: 'Visual estimate on your phone, not a food-safety check.',
};

/** Choices for the user's own check when the photo can't settle freshness. */
export const OWN_CHECK: { value: Stage; label: string }[] = [
  { value: 'fresh', label: 'Looks and smells fresh' },
  { value: 'good', label: 'Looks okay' },
  { value: 'use_soon', label: 'Use it soon' },
  { value: 'spoiled', label: 'Smells off or slimy' },
];

/** "This looks like pork. Is that right?" → Yes goes on to freshness, No ('none') asks for another photo. */
export function itemChoices(item: Item): { value: Item | 'none'; label: string }[] {
  return [
    { value: item, label: `Yes, ${ITEM_NAME[item]}` },
    { value: 'none', label: 'No' },
  ];
}

export type Tip = { icon: 'scan-outline' | 'cut-outline' | 'sunny-outline' | 'eye-outline' | 'hand-left-outline' | 'contrast-outline' | 'bulb-outline'; text: string };

/** Directions shown on the camera while framing the shot, per kind of item. */
export const CAPTURE_TIPS: Record<'meat' | 'fish', Tip[]> = {
  meat: [
    { icon: 'scan-outline', text: 'Fill the frame with one piece of meat' },
    { icon: 'cut-outline', text: 'Show the cut surface, not just the fat or skin' },
    { icon: 'sunny-outline', text: 'Use good light, no harsh shadows' },
    { icon: 'contrast-outline', text: 'Avoid glare from plastic wrap' },
  ],
  fish: [
    { icon: 'eye-outline', text: 'Show the eye and gills' },
    { icon: 'scan-outline', text: 'Get close to the head, eye in focus' },
    { icon: 'hand-left-outline', text: 'Lift the gill cover if you can' },
    { icon: 'sunny-outline', text: 'Use good light, no harsh shadows' },
  ],
};

/** S15 / S09b: how to retake a close-up that shows freshness. */
export const RETAKE_TIPS: Record<'meat' | 'fish', Tip[]> = {
  meat: [
    { icon: 'scan-outline', text: 'Get close so the cut surface fills the frame' },
    { icon: 'sunny-outline', text: 'Bright light, no glare from plastic wrap' },
    { icon: 'hand-left-outline', text: 'Hold steady and tap to focus' },
  ],
  fish: [
    { icon: 'scan-outline', text: 'Fill the frame with the head' },
    { icon: 'eye-outline', text: 'Show the eye and lift the gill flap' },
    { icon: 'sunny-outline', text: 'Bright light, no flash glare' },
  ],
};
