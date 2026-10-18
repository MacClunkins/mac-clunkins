import { useEffect, useRef } from 'react';
import { sendLocation } from './data';

/** Minimum time between two position updates sent to the server. */
export const LOCATION_MIN_GAP_MS = 20_000;

/** True when enough time has passed since the last send (or nothing was sent yet). */
export function dueToSend(lastSentAt: number | null, now: number, minGapMs = LOCATION_MIN_GAP_MS): boolean {
  return lastSentAt === null || now - lastSentAt >= minGapMs;
}

/**
 * While `tripId` is set (the driver has the birds on the vehicle), watches the device position and
 * sends it at most every 20 seconds. A failed send is dropped: the next fix replaces it, and the buyer
 * falls back to the delivery window if no recent position arrives.
 */
export function useShareLocation(tripId: string | null | undefined): void {
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (!tripId || typeof navigator === 'undefined' || !navigator.geolocation) return;
    last.current = null;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        if (!dueToSend(last.current, now)) return;
        last.current = now;
        void Promise.resolve(sendLocation(tripId, pos.coords.latitude, pos.coords.longitude)).catch(() => undefined);
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [tripId]);
}
