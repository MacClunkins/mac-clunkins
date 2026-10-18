import type { DriverTrip } from './types';

const ymd = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

export function earnedOn(trips: Pick<DriverTrip, 'status' | 'delivered_at' | 'driver_share_cents'>[], day: Date): number {
  return trips
    .filter((t) => t.status === 'delivered' && t.delivered_at && ymd(new Date(t.delivered_at)) === ymd(day))
    .reduce((n, t) => n + t.driver_share_cents, 0);
}

/** Last 7 calendar days ending `today`, oldest first, with earnings per day. */
export function earningsByDay(trips: Pick<DriverTrip, 'status' | 'delivered_at' | 'driver_share_cents'>[], today: Date) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (6 - i));
    const n = trips.filter((t) => t.status === 'delivered' && t.delivered_at && ymd(new Date(t.delivered_at)) === ymd(d)).length;
    return { date: d, cents: earnedOn(trips, d), trips: n };
  });
}

export function currentTrip<T extends Pick<DriverTrip, 'status' | 'created_at'>>(trips: T[]): T | null {
  const open = trips.filter((t) => t.status === 'assigned' || t.status === 'picked_up');
  const picked = open.find((t) => t.status === 'picked_up');
  if (picked) return picked;
  return [...open].sort((a, b) => a.created_at.localeCompare(b.created_at))[0] ?? null;
}

/** Finished trips, newest first: what the driver delivered and what they earned. */
export function pastTrips<T extends Pick<DriverTrip, 'status' | 'delivered_at' | 'updated_at' | 'created_at'>>(trips: T[]): T[] {
  const when = (t: T) => t.delivered_at ?? t.updated_at ?? t.created_at;
  return trips
    .filter((t) => t.status === 'delivered' || t.status === 'failed')
    .sort((a, b) => when(b).localeCompare(when(a)));
}
