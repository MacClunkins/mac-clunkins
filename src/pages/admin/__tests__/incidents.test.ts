import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/supabase', () => ({ supabase: {} }));

import { correctPickupCount, forceDelivery, updateIncident, type DbClient } from '../api';

function client(error: { message: string } | null = null) {
  const calls: { fn: string; args: unknown }[] = [];
  const c = {
    from() { throw new Error('incidents must be changed through the RPCs'); },
    rpc: async (fn: string, args: unknown) => { calls.push({ fn, args }); return { data: null, error }; },
  } as unknown as DbClient;
  return { c, calls };
}

describe('incident actions go through the database functions', () => {
  it('updateIncident sends the status, note and whether the reporter sees it', async () => {
    const { c, calls } = client();
    const r = await updateIncident('i1', 'resolved', 'Count corrected', true, c);
    expect(r.error).toBeNull();
    expect(calls).toEqual([{ fn: 'admin_update_incident', args: { p_id: 'i1', p_status: 'resolved', p_note: 'Count corrected', p_visible: true } }]);
  });

  it('correctPickupCount sends the allocation, count, reason and incident', async () => {
    const { c, calls } = client();
    await correctPickupCount('a1', 1000, 'Crate cap entered by mistake', 'i1', c);
    expect(calls).toEqual([{ fn: 'admin_correct_pickup_count', args: { p_allocation_id: 'a1', p_count: 1000, p_reason: 'Crate cap entered by mistake', p_incident_id: 'i1' } }]);
  });

  it('correctPickupCount refuses a count that is not a whole number without calling the database', async () => {
    const { c, calls } = client();
    expect((await correctPickupCount('a1', 10.5, 'because', null, c)).error?.code).toBe('not_integer');
    expect((await correctPickupCount('a1', -1, 'because', null, c)).error?.code).toBe('not_integer');
    expect(calls).toEqual([]);
  });

  it('forceDelivery and database errors come back as errors', async () => {
    const { c, calls } = client({ message: 'only an admin' });
    const r = await forceDelivery('t1', null, 'Buyer confirmed by phone', c);
    expect(r.error?.message).toBe('only an admin');
    expect(calls[0]).toEqual({ fn: 'admin_force_delivery', args: { p_trip_id: 't1', p_count: null, p_reason: 'Buyer confirmed by phone' } });
  });
});
