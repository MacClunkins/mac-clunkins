import { t } from './t';

/**
 * The database raises short codes ("need_count", "job_locked"). People should never see those, so each known
 * code is mapped to a sentence in the user's language; anything unknown is shown as it came.
 */
const KNOWN: [RegExp, string][] = [
  [/job_locked/, 'errors.job_locked'],
  [/delivered_more_than_collected/, 'errors.delivered_more_than_collected'],
  [/invalid_delivery_code/, 'driver.trips.code_rejected'],
  [/too_many_reports/, 'errors.too_many_reports'],
  [/trip_not_awaiting_pickup|trip_not_in_transit/, 'errors.trip_state'],
  [/need_count/, 'supplier.job.need_count'],
  [/need_crates/, 'supplier.job.need_crates'],
  [/need_welfare/, 'supplier.job.need_welfare'],
  [/need_photo/, 'supplier.job.need_photo'],
  [/need_permit/, 'supplier.job.need_permit'],
  [/permit_expired/, 'supplier.job.permit_expired'],
  [/disinfection_photo_required/, 'driver.pickup.block_photo'],
  [/permission denied|not authori[sz]ed|only an admin|suppliers only|drivers only/i, 'errors.denied'],
  [/job is already/, 'errors.already_answered'],
];

export function friendlyError(message: string | null | undefined): string {
  const m = message ?? '';
  for (const [pattern, key] of KNOWN) if (pattern.test(m)) return t(key);
  return m;
}
