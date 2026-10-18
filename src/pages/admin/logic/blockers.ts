import type { CandidateReason, DriverParty, QuoteCandidate } from '../api';

export type DriverIssue = 'not_active' | 'paused' | 'no_capacity';

/** What is stopping this driver from being offered work. Empty means the driver is ready. */
export function driverIssues(d: DriverParty): DriverIssue[] {
  const out: DriverIssue[] = [];
  if (d.status !== 'active') out.push('not_active');
  if (d.paused) out.push('paused');
  if (d.capacity_birds === null) out.push('no_capacity');
  return out;
}

export interface SupplierBlocker { supplier: QuoteCandidate; reasons: CandidateReason[] }

export interface QuoteBlockers {
  /** True when at least one supplier can fill the quote, so it can be priced now. */
  ready: boolean;
  eligibleCount: number;
  suppliers: SupplierBlocker[];
  /** Drivers that need something done. Only relevant when `no_driver` is among the reasons. */
  drivers: { driver: DriverParty; issues: DriverIssue[] }[];
  noDriversAtAll: boolean;
}

export function summariseBlockers(cands: QuoteCandidate[], drivers: DriverParty[]): QuoteBlockers {
  const eligibleCount = cands.filter((c) => c.eligible).length;
  const suppliers = cands.filter((c) => !c.eligible).map((supplier) => ({ supplier, reasons: supplier.reasons }));
  const driverMatters = suppliers.some((s) => s.reasons.includes('no_driver'));
  return {
    ready: eligibleCount > 0,
    eligibleCount,
    suppliers,
    drivers: driverMatters
      ? drivers.map((driver) => ({ driver, issues: driverIssues(driver) })).filter((d) => d.issues.length > 0)
      : [],
    noDriversAtAll: driverMatters && drivers.length === 0,
  };
}

/** wa.me link with a ready-written message, or null when there is no usable number. South African numbers
 *  starting 0 are converted to +27. */
export function whatsappLink(phone: string | null, text: string): string | null {
  if (!phone) return null;
  let digits = phone.replace(/[^\d]/g, '');
  if (digits.startsWith('0')) digits = `27${digits.slice(1)}`;
  if (digits.length < 9) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
