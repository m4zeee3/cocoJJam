import { NativeModules } from 'react-native';

/**
 * Selfie / face check with Google ML Kit face detection (bundled model, fully
 * offline). The general image model has no "person" class and the freshness
 * model is overconfident on faces, so this runs before both.
 */

/** A face this large in the photo (share of its area) means it's a photo of a person. */
const MIN_FACE_AREA = 0.02;

type Face = { frame: { width: number; height: number } };
type Detector = { detect: (url: string, options?: object) => Promise<Face[]> };

let detector: Detector | null | undefined;

function getDetector(): Detector | null {
  if (detector !== undefined) return detector;
  // Missing in Expo Go or a build made before the library was added: skip the check.
  if (!NativeModules.FaceDetection) return (detector = null);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  detector = require('@react-native-ml-kit/face-detection').default as Detector;
  return detector;
}

/** True when the photo clearly shows a person's face. Never throws: a failed check returns false. */
export async function hasFace(uri: string, photoWidth: number, photoHeight: number): Promise<boolean> {
  const d = getDetector();
  if (!d) return false;
  try {
    const faces = await d.detect(uri, { performanceMode: 'accurate', minFaceSize: 0.1 });
    const area = photoWidth * photoHeight || 1;
    return faces.some((f) => (f.frame.width * f.frame.height) / area >= MIN_FACE_AREA);
  } catch {
    return false;
  }
}
