import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export type PaymentsMode = 'manual' | 'paystack';

export interface BillingDoc {
  id: string;
  kind: 'quote' | 'invoice' | 'receipt';
  number: string;
  amount_cents: number;
  issued_at: string;
}

export interface PaymentInstructions {
  reference: string;
  amount_cents: number;
  bank_name: string | null;
  account_holder: string | null;
  account_number: string | null;
  branch_code: string | null;
  account_type: string | null;
}

export type ManualMethod = 'eft' | 'cash' | 'card_machine' | 'other';

/** Reads the public `payments_mode` setting. Defaults to manual (MVP 1) until loaded or if it can't be read. */
export function usePaymentsMode(): { mode: PaymentsMode; ready: boolean } {
  const [mode, setMode] = useState<PaymentsMode>('manual');
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const { data } = await supabase.from('settings').select('value').eq('key', 'payments_mode').maybeSingle();
        const v = (data as { value?: unknown } | null)?.value;
        if (live) setMode(v === 'paystack' ? 'paystack' : 'manual');
      } catch {
        /* keep the manual default */
      }
      if (live) setReady(true);
    })();
    return () => { live = false; };
  }, []);
  return { mode, ready };
}

export async function listBillingDocs(orderId: string): Promise<BillingDoc[]> {
  const { data, error } = await supabase
    .from('billing_documents').select('id, kind, number, amount_cents, issued_at')
    .eq('order_id', orderId).order('issued_at');
  if (error) throw error;
  return (data ?? []) as BillingDoc[];
}

export async function getPaymentInstructions(orderId: string): Promise<PaymentInstructions | null> {
  const { data, error } = await supabase.rpc('get_payment_instructions', { p_order_id: orderId });
  if (error) throw error;
  return (data as PaymentInstructions | null) ?? null;
}

export async function issueQuoteDocument(quoteId: string): Promise<string> {
  const { data, error } = await supabase.rpc('issue_quote_document', { p_quote_id: quoteId });
  if (error) throw error;
  return data as string;
}

export async function adminMarkOrderPaid(args: {
  orderId: string; amountCents: number; method: ManualMethod; reference?: string; note?: string; bankFeeCents?: number | null;
}): Promise<{ error: { message: string; code?: string } | null }> {
  const { error } = await supabase.rpc('admin_mark_order_paid', {
    p_order_id: args.orderId, p_amount_cents: args.amountCents, p_method: args.method,
    p_reference: args.reference || null, p_note: args.note || null, p_bank_fee_cents: args.bankFeeCents ?? null,
  });
  return { error };
}

/** Fetches the PDF from the `billing-pdf` Edge Function (RLS applies under the caller's JWT) and opens it. */
export async function openBillingPdf(docId: string): Promise<void> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  const base = import.meta.env.VITE_SUPABASE_URL as string;
  const res = await fetch(`${base}/functions/v1/billing-pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token ?? ''}`, apikey: (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '') as string },
    body: JSON.stringify({ id: docId }),
  });
  if (!res.ok) throw new Error(`billing-pdf ${res.status}`);
  const url = URL.createObjectURL(await res.blob());
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
