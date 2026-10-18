import { t } from './t';

export type InboxRole = 'buyer' | 'supplier' | 'driver';

export interface InboxRow {
  id: string; template: string; payload: Record<string, unknown> | null; created_at: string; read_at: string | null;
}

const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');
const rand = (cents: unknown) => (typeof cents === 'number' ? `R${(cents / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '');

/** The sentence for a notification, and where tapping it should go. Unknown templates still read sensibly. */
export function describeNotification(n: Pick<InboxRow, 'template' | 'payload'>, role: InboxRole): { text: string; to: string | null } {
  const p = n.payload ?? {};
  switch (n.template) {
    case 'order_paid': return { text: t('inbox.order_paid', { number: str(p.order_number) }), to: `/orders/${str(p.order_id)}` };
    case 'order_scheduled': return { text: t('inbox.order_scheduled', { number: str(p.order_number), date: str(p.delivery_date) }), to: `/orders/${str(p.order_id)}` };
    case 'order_on_the_way': return { text: t('inbox.order_on_the_way', { number: str(p.order_number) }), to: `/orders/${str(p.order_id)}/track` };
    case 'order_delivered': return { text: t('inbox.order_delivered', { number: str(p.order_number) }), to: `/orders/${str(p.order_id)}` };
    case 'order_cancelled': return { text: t('inbox.order_cancelled', { number: str(p.order_number) }), to: `/orders/${str(p.order_id)}` };
    case 'quote_ready': return { text: t('inbox.quote_ready', { amount: rand(p.total_cents) }), to: `/quotes/${str(p.quote_id)}` };
    case 'job_offered': return { text: t('inbox.job_offered', { count: str(p.quantity) }), to: '/supplier/jobs' };
    case 'trip_assigned': return { text: t('inbox.trip_assigned'), to: '/driver/trips' };
    case 'payout_paid': return { text: t('inbox.payout_paid', { amount: rand(p.amount_cents) }), to: role === 'driver' ? '/driver/earnings' : '/supplier/payouts' };
    case 'document_expiring': return { text: t('inbox.document_expiring'), to: role === 'driver' ? '/driver/onboarding' : '/supplier/onboarding' };
    default: return { text: t('inbox.generic'), to: null };
  }
}
