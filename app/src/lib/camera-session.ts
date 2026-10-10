import { requireOptionalNativeModule } from 'expo';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';

import type { Kind } from '@/ml/read';

/**
 * Opens the in-app camera (src/app/camera.tsx) and resolves with the photos taken,
 * or null when the user closes it. One session at a time: a new one cancels the old.
 */
type Done = (uris: string[] | null) => void;
let pending: Done | null = null;

export function capturePhotos({ multiple }: { multiple: boolean }): Promise<string[] | null> {
  // A dev build made before expo-camera was added has no native camera module: use the system camera.
  if (!requireOptionalNativeModule('ExpoCamera')) return systemCamera();
  pending?.(null);
  return new Promise((resolve) => {
    pending = resolve;
    router.push({ pathname: '/camera', params: { multiple: multiple ? '1' : '0' } });
  });
}

/** One photo from the phone's own camera app (no framing guide or directions). */
async function systemCamera(): Promise<string[] | null> {
  const { granted } = await ImagePicker.requestCameraPermissionsAsync();
  if (!granted) return null;
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
  return result.canceled ? null : result.assets.map((a) => a.uri);
}

// The Meat/Fish choice each camera photo was taken with, so the scan can catch fish read as pork.
const kinds = new Map<string, Kind>();

/** Called by the camera screen as photos are added, with the Meat/Fish choice at that moment. */
export function tagCapture(uris: string[], kind: Kind) {
  for (const uri of uris) kinds.set(uri, kind);
}

/** Meat or Fish, for a photo from the in-app camera; undefined for the system camera or gallery. */
export function capturedKind(uri: string): Kind | undefined {
  return kinds.get(uri);
}

/** Called by the camera screen once, when it finishes or closes. */
export function finishCapture(uris: string[] | null) {
  const done = pending;
  pending = null;
  done?.(uris && uris.length > 0 ? uris : null);
}
