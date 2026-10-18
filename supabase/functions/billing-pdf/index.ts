// GET/POST /billing-pdf {id} with the caller's JWT. RLS on billing_documents decides who can read it:
// a buyer gets their own quotes, invoices and receipts; an admin gets all. Returns application/pdf.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';

const cors = {
  'access-control-allow-origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'access-control-allow-headers': 'authorization, content-type, apikey',
};

const rand = (cents: number) => 'R ' + (cents / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const INK = rgb(0.12, 0.1, 0.08);
const CHILLI = rgb(0.66, 0.2, 0.12);
const GREY = rgb(0.45, 0.43, 0.4);

// deno-lint-ignore no-explicit-any
async function renderPdf(doc: any): Promise<Uint8Array> {
  const s = doc.snapshot ?? {};
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let y = 790;
  const text = (t: string, x: number, size = 10, f = font, color = INK) => page.drawText(String(t ?? ''), { x, y, size, font: f, color });
  const right = (t: string, xr: number, size = 10, f = font) => page.drawText(t, { x: xr - f.widthOfTextAtSize(t, size), y, size, font: f, color: INK });

  const company = s.company ?? {};
  text(company.name || "McCluckin's", 50, 20, bold, CHILLI);
  right((s.title ?? doc.kind).toUpperCase(), 545, 20, bold);
  y -= 16;
  for (const line of [company.address, company.email, company.phone, company.registration && `Reg: ${company.registration}`].filter(Boolean)) {
    text(String(line), 50, 9, font, GREY); y -= 12;
  }
  y -= 8;
  right(`No: ${doc.number}`, 545, 10, bold); y -= 13;
  right(`Date: ${new Date(doc.issued_at).toISOString().slice(0, 10)}`, 545); y -= 13;
  if (s.reference) { right(`Reference: ${s.reference}`, 545); y -= 13; }
  if (s.valid_until) { right(`Valid until: ${String(s.valid_until).slice(0, 10)}`, 545); y -= 13; }
  y -= 10;

  const c = s.customer ?? {};
  text('Billed to', 50, 9, font, GREY); y -= 13;
  for (const line of [c.business, c.name, c.address, c.email, c.phone].filter(Boolean)) { text(String(line), 50); y -= 13; }
  y -= 14;

  page.drawRectangle({ x: 50, y: y - 4, width: 495, height: 20, color: rgb(0.96, 0.94, 0.91) });
  text('Description', 56, 10, bold); right('Amount', 539, 10, bold); y -= 24;
  for (const l of s.lines ?? []) { text(l.label, 56); right(rand(l.cents), 539); y -= 16; }
  y -= 4;
  page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 0.5, color: GREY }); y -= 18;
  text('Total', 56, 12, bold); right(rand(s.total_cents ?? doc.amount_cents), 539, 12, bold); y -= 28;

  if (doc.kind === 'receipt') {
    text(`PAID ${rand(doc.amount_cents)} on ${String(s.paid_at ?? '').slice(0, 10)} by ${String(s.method ?? '').replace('_', ' ')}`, 50, 11, bold, CHILLI); y -= 15;
    if (s.payment_reference) { text(`Payment reference: ${s.payment_reference}`, 50); y -= 13; }
  } else if (doc.kind === 'invoice') {
    text(s.status === 'paid' ? 'PAID - see receipt' : 'PAYMENT DUE', 50, 11, bold, CHILLI); y -= 18;
    if (s.status !== 'paid' && (company.bank_name || company.account_number)) {
      text('Pay by EFT', 50, 10, bold); y -= 13;
      for (const [k, v] of [['Bank', company.bank_name], ['Account holder', company.account_holder], ['Account number', company.account_number],
        ['Branch code', company.branch_code], ['Account type', company.account_type], ['Payment reference', s.reference]]) {
        if (v) { text(`${k}: ${v}`, 50); y -= 13; }
      }
    }
  } else {
    text('This quote is not an invoice. No payment is due until an order is placed.', 50, 9, font, GREY); y -= 14;
  }
  text('No VAT charged - supplier is not VAT registered.', 50, 8, font, GREY);
  return await pdf.save();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const auth = req.headers.get('Authorization');
  if (!auth) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: cors });
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  const id = body.id ?? new URL(req.url).searchParams.get('id');
  if (!id) return new Response(JSON.stringify({ error: 'id_required' }), { status: 400, headers: cors });

  const user = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false },
  });
  const { data, error } = await user.from('billing_documents').select('*').eq('id', id).maybeSingle();
  if (error || !data) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: cors });
  const bytes = await renderPdf(data);
  return new Response(bytes, { headers: { ...cors, 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${data.number}.pdf"` } });
});
