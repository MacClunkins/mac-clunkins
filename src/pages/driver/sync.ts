import { PermanentSyncError, type QueuedAction } from './offlineQueue';
import { confirmDelivery, confirmPickup } from './data';
import { uploadFile } from '../supplier-driver-shared/storage';

const looksOffline = (msg: string) => !navigator.onLine || /failed to fetch|network|load failed|timeout/i.test(msg);

/** Sender for OfflineQueue.flush: uploads the photo, then calls the RPC. */
export async function sendQueued(a: QueuedAction, userId: string): Promise<void> {
  let photoPath = (a.payload.photo_path as string | null | undefined) ?? null;
  if (a.photo && !photoPath) {
    const up = await uploadFile(a.photo, userId, a.kind === 'pickup' ? 'disinfection' : 'pod');
    if (!up.path) throw new Error(up.error ?? 'upload failed'); // transient: retried next flush
    photoPath = up.path;
  }
  const res =
    a.kind === 'pickup'
      ? await confirmPickup({ p_trip_id: a.tripId, p_count: Number(a.payload.count), p_photo_path: photoPath, p_short_reason: (a.payload.short_reason as string | null | undefined) ?? null })
      : await confirmDelivery({
          p_trip_id: a.tripId,
          p_code: String(a.payload.code),
          p_count: Number(a.payload.count),
          p_photo_path: photoPath,
        });
  if (res.error) {
    if (looksOffline(res.error.message)) throw new Error(res.error.message);
    throw new PermanentSyncError(res.error.message);
  }
}

export { looksOffline };
