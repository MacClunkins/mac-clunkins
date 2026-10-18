import { supabase } from './supabase';

/** Private bucket for EFT slips, bank statements and proof of payment to suppliers and drivers. */
export const PROOFS_BUCKET = 'payment-proofs';

export interface ProofRow { id: string; file_path: string; note?: string | null; created_at: string; reference?: string; bank_fee_cents?: number | null; transfer_id?: string }

const extOf = (file: Blob) => (file.type.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '');

/** Uploads under `${folder}/${uuid}.${ext}` and returns the path. Storage policy decides who may write where. */
export async function uploadProof(file: Blob, folder: string): Promise<{ path: string | null; error: string | null }> {
  const path = `${folder}/${crypto.randomUUID()}.${extOf(file)}`;
  const { error } = await supabase.storage.from(PROOFS_BUCKET).upload(path, file, { contentType: file.type || undefined });
  return { path: error ? null : path, error: error?.message ?? null };
}

/** Opens a proof through a short-lived signed link. Returns an error message, or null when it opened. */
export async function openProof(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(PROOFS_BUCKET).createSignedUrl(path, 300);
  if (error || !data?.signedUrl) return error?.message ?? 'Could not open the file.';
  window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  return null;
}

export async function submitBuyerProof(orderId: string, userId: string, file: Blob, note?: string): Promise<{ error: string | null }> {
  const up = await uploadProof(file, `buyer/${userId}`);
  if (!up.path) return { error: up.error ?? 'upload failed' };
  const { error } = await supabase.rpc('submit_payment_proof', { p_order_id: orderId, p_file_path: up.path, p_note: note ?? null });
  return { error: error?.message ?? null };
}

export async function listOrderProofs(orderId: string): Promise<ProofRow[]> {
  const { data, error } = await supabase.from('payment_proofs').select('id, file_path, note, created_at').eq('order_id', orderId).order('created_at');
  if (error) throw error;
  return (data ?? []) as ProofRow[];
}

/** Proof the admin attached to the caller's own payouts (a supplier or driver sees only their own). */
export async function listTransferProofs(): Promise<ProofRow[]> {
  const { data, error } = await supabase.from('transfer_proofs').select('id, transfer_id, file_path, reference, created_at').order('created_at');
  if (error) throw error;
  return (data ?? []) as ProofRow[];
}

export async function markTransferPaid(args: { transferId: string; reference: string; bankFeeCents: number | null; file: Blob }): Promise<{ error: string | null }> {
  const up = await uploadProof(args.file, `payout/${args.transferId}`);
  if (!up.path) return { error: up.error ?? 'upload failed' };
  const { error } = await supabase.rpc('admin_mark_transfer_paid', {
    p_transfer_id: args.transferId, p_reference: args.reference, p_bank_fee_cents: args.bankFeeCents, p_proof_path: up.path,
  });
  return { error: error?.message ?? null };
}

export async function addBankStatement(args: { file: Blob; from: string | null; to: string | null; note: string }): Promise<{ error: string | null }> {
  const up = await uploadProof(args.file, 'statement');
  if (!up.path) return { error: up.error ?? 'upload failed' };
  const { error } = await supabase.rpc('admin_add_bank_statement', { p_file_path: up.path, p_from: args.from, p_to: args.to, p_note: args.note || null });
  return { error: error?.message ?? null };
}

export interface StatementRow { id: string; file_path: string; period_from: string | null; period_to: string | null; note: string | null; created_at: string }
export async function listBankStatements(): Promise<StatementRow[]> {
  const { data, error } = await supabase.from('bank_statements').select('id, file_path, period_from, period_to, note, created_at').order('created_at', { ascending: false }).limit(50);
  if (error) throw error;
  return (data ?? []) as StatementRow[];
}

/** "123.45" (rands) to cents; empty means "no fee recorded". NaN or negative gives undefined (invalid). */
export function randsToCents(text: string): number | null | undefined {
  const s = text.trim().replace(',', '.');
  if (s === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return undefined;
  return Math.round(Number(s) * 100);
}
