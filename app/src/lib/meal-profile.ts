import type { Profile } from '@/db/profile';

/**
 * A profile used for this meal only: answers given without "Save to my
 * household profile", or a filter relaxed on R08 (UC-3.6, 5.3). Shared by the
 * Dishes list and Recipe detail; cleared when the app restarts.
 */
let mealProfile: Profile | null = null;

export const getMealProfile = () => mealProfile;
export const setMealProfile = (p: Profile | null) => {
  mealProfile = p;
};
