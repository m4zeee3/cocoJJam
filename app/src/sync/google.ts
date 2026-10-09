import Constants, { ExecutionEnvironment } from 'expo-constants';

import { GOOGLE } from '@/constants/config';

/** Expo Go has no Google Sign-In native module; sign-in needs the dev build. */
export const GOOGLE_AVAILABLE = Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;

export class SignInCancelled extends Error {}

type Module = typeof import('@react-native-google-signin/google-signin');
let mod: Module | null = null;

function google(): Module {
  if (!GOOGLE_AVAILABLE) throw new Error('Google sign-in needs the development build. Expo Go can’t load it.');
  if (!mod) {
    // Loaded lazily so the app still opens in Expo Go.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('@react-native-google-signin/google-signin') as Module;
    mod.GoogleSignin.configure({ webClientId: GOOGLE.webClientId, iosClientId: GOOGLE.iosClientId });
  }
  return mod;
}

/** Shows the Google account picker and returns an ID token for the backend (UC-11.2). */
export async function googleIdToken(): Promise<{ idToken: string; photo: string | null }> {
  const { GoogleSignin, isSuccessResponse, statusCodes } = google();
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  try {
    const res = await GoogleSignin.signIn();
    if (!isSuccessResponse(res)) throw new SignInCancelled();
    if (!res.data.idToken) throw new Error('Google did not return an ID token. Check the web client ID.');
    return { idToken: res.data.idToken, photo: res.data.user.photo };
  } catch (e) {
    if ((e as { code?: string }).code === statusCodes.SIGN_IN_CANCELLED) throw new SignInCancelled();
    throw e;
  }
}

export async function googleSignOut() {
  if (!GOOGLE_AVAILABLE) return;
  await google().GoogleSignin.signOut().catch(() => {});
}
