import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as jpeg from 'jpeg-js';

/**
 * Photo URI -> RGB bytes (0-255), center-cropped to a square and resized.
 * Expo has no raw-pixel API, so we re-encode a tiny JPEG and decode it in JS.
 */
export async function imageToRgb(uri: string, size: number): Promise<Uint8Array> {
  const original = await ImageManipulator.manipulate(uri).renderAsync();
  const side = Math.min(original.width, original.height);
  const square = await ImageManipulator.manipulate(uri)
    .crop({
      originX: Math.floor((original.width - side) / 2),
      originY: Math.floor((original.height - side) / 2),
      width: side,
      height: side,
    })
    .resize({ width: size, height: size })
    .renderAsync();
  const { base64 } = await square.saveAsync({ format: SaveFormat.JPEG, compress: 1, base64: true });
  if (!base64) throw new Error('Image encode failed');

  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const { data, width, height } = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });

  const rgb = new Uint8Array(width * height * 3);
  for (let src = 0, dst = 0; src < data.length; src += 4) {
    rgb[dst++] = data[src];
    rgb[dst++] = data[src + 1];
    rgb[dst++] = data[src + 2];
  }
  return rgb;
}
