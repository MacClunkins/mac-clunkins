import { supabase } from '../../lib/supabase';

// ASSUMPTION: a private storage bucket named `documents` exists with RLS that
// only lets a user write under `<their uid>/...`. Confirm against the storage
// migration before merging.
export const DOCUMENTS_BUCKET = 'documents';

export async function uploadFile(
  file: Blob,
  userId: string,
  folder: string,
): Promise<{ path: string | null; error: string | null }> {
  const ext = (file.type.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '');
  const path = `${userId}/${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(path, file, { contentType: file.type || undefined });
  return { path: error ? null : path, error: error?.message ?? null };
}

/**
 * Opens one of the caller's own uploaded documents in a new tab through a short-lived signed link.
 * The bucket is private, and storage policy only lets the owner (or an admin) read it.
 */
export async function openDocument(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(DOCUMENTS_BUCKET).createSignedUrl(path, 300);
  if (error || !data?.signedUrl) return error?.message ?? 'Could not open the document.';
  window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  return null;
}
