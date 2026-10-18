import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const send = vi.fn(async () => ({ data: null, error: null }));
vi.mock('../data', () => ({ sendLocation: (...a: unknown[]) => send(...(a as [])) }));

import { dueToSend, useShareLocation } from '../useShareLocation';

describe('dueToSend', () => {
  it('sends the first fix and then at most once per gap', () => {
    expect(dueToSend(null, 1000)).toBe(true);
    expect(dueToSend(1000, 10_000)).toBe(false);
    expect(dueToSend(1000, 21_000)).toBe(true);
  });
});

describe('useShareLocation', () => {
  let cb: ((p: GeolocationPosition) => void) | null = null;
  const clearWatch = vi.fn();
  beforeEach(() => {
    send.mockClear(); clearWatch.mockClear(); cb = null;
    Object.defineProperty(globalThis.navigator, 'geolocation', {
      configurable: true,
      value: { watchPosition: (ok: (p: GeolocationPosition) => void) => { cb = ok; return 7; }, clearWatch },
    });
  });
  afterEach(() => vi.useRealTimers());
  const fix = (lat: number, lng: number) => ({ coords: { latitude: lat, longitude: lng } }) as GeolocationPosition;

  it('does nothing without a trip', () => {
    renderHook(() => useShareLocation(null));
    expect(cb).toBeNull();
  });

  it('sends a position, throttles the next one, and stops watching on unmount', () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const { unmount } = renderHook(() => useShareLocation('trip-1'));
    cb?.(fix(-26.2, 27.9));
    cb?.(fix(-26.3, 27.9));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('trip-1', -26.2, 27.9);
    vi.setSystemTime(1_000_000 + 25_000);
    cb?.(fix(-26.4, 27.9));
    expect(send).toHaveBeenCalledTimes(2);
    unmount();
    expect(clearWatch).toHaveBeenCalledWith(7);
  });
});
