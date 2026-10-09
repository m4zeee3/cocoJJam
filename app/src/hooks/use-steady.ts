import { Accelerometer } from 'expo-sensors';
import { useEffect, useState } from 'react';

/** Change in g between readings (every 100 ms) that counts as the phone moving. */
const MOVE_G = 0.04;
/** How long the phone has to stay still before we call it steady. */
const STILL_MS = 600;

/**
 * True when the phone has been still for a moment (sharper photos), false while it
 * moves, null when there's no accelerometer. Used for the camera's "Hold steady" hint.
 */
export function useSteady(): boolean | null {
  const [steady, setSteady] = useState<boolean | null>(null);

  useEffect(() => {
    let sub: { remove: () => void } | null = null;
    let cancelled = false;
    let last: { x: number; y: number; z: number } | null = null;
    let movedAt = Date.now();

    Accelerometer.isAvailableAsync()
      .then((ok) => {
        if (!ok || cancelled) return;
        Accelerometer.setUpdateInterval(100);
        sub = Accelerometer.addListener(({ x, y, z }) => {
          const now = Date.now();
          if (last && Math.hypot(x - last.x, y - last.y, z - last.z) > MOVE_G) movedAt = now;
          last = { x, y, z };
          const still = now - movedAt > STILL_MS;
          setSteady((prev) => (prev === still ? prev : still));
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, []);

  return steady;
}
