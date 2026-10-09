import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { ActionSheetIOS, Alert, Platform } from 'react-native';

import { capturePhotos } from '@/lib/camera-session';

type Source = 'camera' | 'gallery';

let chatOpen = false;

/** The scanner chat has been shown: from now on the Scan tab goes back to it instead of asking for photos. */
export function markScanChatOpen() {
  chatOpen = true;
}

export function isScanChatOpen() {
  return chatOpen;
}

/** Most photos one scan takes (UC-1.2). */
export const MAX_PHOTOS = 10;

/** Ask whether to take a photo or upload one; resolves null on cancel. */
function chooseSource(): Promise<Source | null> {
  return new Promise((resolve) => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { title: 'Scan your food', options: ['Take photo', 'Upload from gallery', 'Cancel'], cancelButtonIndex: 2 },
        (i) => resolve(i === 0 ? 'camera' : i === 1 ? 'gallery' : null),
      );
    } else {
      Alert.alert(
        'Scan your food',
        undefined,
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
          { text: 'Upload from gallery', onPress: () => resolve('gallery') },
          { text: 'Take photo', onPress: () => resolve('camera') },
        ],
        { cancelable: true, onDismiss: () => resolve(null) },
      );
    }
  });
}

/**
 * Gallery picker. With `limit` > 1 the user can pick several photos (Android, iOS 14+),
 * numbered in the order picked on iOS 15+.
 */
export async function pickFromGallery(limit = 1): Promise<string[] | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.8,
    allowsMultipleSelection: limit > 1,
    selectionLimit: limit,
    orderedSelection: limit > 1,
  });
  return result.canceled ? null : result.assets.slice(0, limit).map((a) => a.uri);
}

/** One photo from the in-app camera or the gallery (asking which when `source` is omitted). */
export async function pickPhoto(source?: Source): Promise<string | null> {
  const picked = source ?? (await chooseSource());
  if (!picked) return null;
  const uris = picked === 'camera' ? await capturePhotos({ multiple: false }) : await pickFromGallery(1);
  return uris?.[0] ?? null;
}

/**
 * Every Scan entry point goes through here: take or pick up to MAX_PHOTOS photos,
 * then land on the scanner chat with them. Cancelling the camera or gallery still
 * opens the chat's welcome message; cancelling the camera/gallery choice stays put.
 */
export async function openScanner(source?: Source) {
  if (!source) {
    const picked = await chooseSource();
    if (!picked) return;
    source = picked;
  }
  const uris = source === 'camera' ? await capturePhotos({ multiple: true }) : await pickFromGallery(MAX_PHOTOS);
  router.navigate(uris ? { pathname: '/scan', params: { photos: JSON.stringify(uris) } } : '/scan');
}
