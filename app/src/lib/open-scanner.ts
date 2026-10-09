import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { ActionSheetIOS, Alert, Platform } from 'react-native';

type Source = 'camera' | 'gallery';

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

/** Pick a photo from the camera or gallery (asking which when `source` is omitted). */
export async function pickPhoto(source?: Source): Promise<string | null> {
  const picked = source ?? (await chooseSource());
  if (!picked) return null;
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.8 };
  if (picked === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return null;
    const result = await ImagePicker.launchCameraAsync(options);
    return result.canceled ? null : result.assets[0].uri;
  }
  const result = await ImagePicker.launchImageLibraryAsync(options);
  return result.canceled ? null : result.assets[0].uri;
}

/**
 * Every Scan entry point goes through here: pick a photo, then land on the
 * scanner chat with it. Cancelling the camera or gallery still opens the chat's
 * welcome message; cancelling the camera/gallery choice stays put.
 */
export async function openScanner(source?: Source) {
  if (!source) {
    const picked = await chooseSource();
    if (!picked) return;
    source = picked;
  }
  const uri = await pickPhoto(source);
  router.navigate(uri ? { pathname: '/scan', params: { photo: uri } } : '/scan');
}
