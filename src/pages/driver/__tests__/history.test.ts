import { describe, expect, it } from 'vitest';
import { pastTrips } from '../earned';

const trip = (id: string, status: string, delivered_at: string | null, updated_at = '2026-10-01T00:00:00Z') =>
  ({ id, status, delivered_at, updated_at, created_at: '2026-09-30T00:00:00Z' }) as never;

describe('driver trip history', () => {
  it('lists finished trips, newest first, and leaves out open ones', () => {
    const rows = [
      trip('open', 'assigned', null),
      trip('old', 'delivered', '2026-10-10T08:00:00Z'),
      trip('moving', 'picked_up', null),
      trip('new', 'delivered', '2026-10-18T08:00:00Z'),
      trip('failed', 'failed', null, '2026-10-12T00:00:00Z'),
    ];
    expect(pastTrips(rows).map((t: { id: string }) => t.id)).toEqual(['new', 'failed', 'old']);
  });

  it('is empty when nothing is finished', () => {
    expect(pastTrips([trip('a', 'assigned', null)])).toEqual([]);
  });
});
