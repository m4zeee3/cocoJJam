import type { ImageSource } from 'expo-image';

/**
 * Dish photos, keyed by recipe id from recipes.json. Recipes without an entry
 * show the peach placeholder tile. Metro bundles images only through a literal
 * require(), so each photo needs its own line here: add the file to
 * assets/images/recipes/, then uncomment its line.
 */
export const RECIPE_IMAGES: Record<string, ImageSource> = {
  'sinigang-na-bangus': require('@/assets/images/recipes/sinigang-na-bangus.jpg'),
  'paksiw-na-bangus': require('@/assets/images/recipes/paksiw-na-bangus.jpg'),
  'daing-na-bangus': require('@/assets/images/recipes/daing-na-bangus.jpg'),
  'tinolang-manok': require('@/assets/images/recipes/tinolang-manok.jpg'),
  'pork-adobo': require('@/assets/images/recipes/pork-adobo.jpg'),
  'pritong-tilapia': require('@/assets/images/recipes/pritong-tilapia.jpg'),
  'chicken-adobo': require('@/assets/images/recipes/chicken-adobo.jpg'),
  'bistek-tagalog': require('@/assets/images/recipes/bistek-tagalog.jpg'),
  'nilagang-baka': require('@/assets/images/recipes/nilagang-baka.jpg'),
  'pritong-galunggong': require('@/assets/images/recipes/pritong-galunggong.jpg'),
  // 'sinigang-na-baboy': require('@/assets/images/recipes/sinigang-na-baboy.jpg'),
};
