/**
 * Google OAuth client IDs (not secrets). The backend accepts ID tokens issued
 * for these, see GOOGLE_CLIENT_IDS in backend/.env.
 */
export const GOOGLE = {
  webClientId: '1045250307755-841e5stdd0uhvjc02dkstrpis74j5hq9.apps.googleusercontent.com',
  iosClientId: '1045250307755-iduldkk34c7ku5sp1pd80cmr4bbhm4qv.apps.googleusercontent.com',
};

/**
 * Sync backend (backend/). Set EXPO_PUBLIC_API_URL in app/.env, e.g.
 * http://192.168.1.20:8000 for a laptop on the same Wi-Fi. Only a URL goes
 * here: anything EXPO_PUBLIC_ is readable by anyone with the app.
 */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/$/, '');
