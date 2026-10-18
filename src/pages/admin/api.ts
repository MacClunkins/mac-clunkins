/* eslint-disable @typescript-eslint/no-explicit-any */
// Admin data layer. Every read goes through RLS (is_admin()) or the admin_* views; every write that
// is not a plain table update goes through an RPC. RPCs marked TODO(backend) do not exist yet:
// the contracts below are what the UI calls, so the backend agent can implement them verbatim.
import { supabase } from '../../lib/supabase';
import { isForwardTransition, validateResolution } from './logic/cases';
import { canRetry } from './logic/payouts';
import { defFor, sameValue, validateSetting } from './logic/settings';
import type {
  AllocationRow, AreaRow, CaseCostOwner, CaseEventRow, CaseResolution, CaseRow, CaseStatus,
  DeliverySlot, DocumentRow, DocumentStatus, DriverDetails, JsonValue, MatchCandidate, NameRef,
  OrderEventRow, OrderRow, PaymentRow, SettingsMap, SupplierDetails, SupplierRequirements,
  TransferRow, TransferStatus, TripRow,
} from './types';

export interface ApiError { message: string; code?: string }
export interface Result<T> { data: T | null; error: ApiError | null }
export interface DbClient {
  from(table: string): any;
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: ApiError | null }>;
}
const db = supabase as unknown as DbClient;

const ok = <T>(data: T): Result<T> => ({ data, error: null });
const fail = <T>(error: ApiError): Result<T> => ({ data: null, error });
const firstError = (...rs: { error: ApiError | null }[]): ApiError | null => rs.find((r) => r.error)?.error ?? null;

async function namesFor(ids: (string | null)[], client: DbClient = db): Promise<Map<string, NameRef>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  const map = new Map<string, NameRef>();
  if (!unique.length) return map;
  const { data } = await client.from('profiles').select('id, full_name, business_name').in('id', unique);
  for (const p of (data ?? []) as any[]) map.set(p.id, { full_name: p.full_name, business_name: p.business_name });
  return map;
}

const ORDER_SELECT =
  '*, buyer:profiles(full_name, business_name), address:addresses(town, province), slot:delivery_slots(label)';

/* ------------------------------------------------------------------ dashboard */

export interface DashboardData {
  todayOrders: OrderRow[];
  pipeline: Record<string, number>;
  needsAction: { key: 'unscheduled' | 'pending_accounts' | 'documents_to_review' | 'cases_overdue' | 'transfers_failed'; count: number; to: string }[];
  transfersQueued: { count: number; cents: number };
  allocations: AllocationRow[];
  trips: TripRow[];
  payments: PaymentRow[];
}

export function startOfTodayIso(now = new Date()): string {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function loadDashboard(): Promise<Result<DashboardData>> {
  const today = startOfTodayIso();
  const head = (table: string) => db.from(table).select('id', { count: 'exact', head: true });
  const [orders, statuses, unscheduled, pending, docs, overdue, failed, queued] = await Promise.all([
    db.from('orders').select(ORDER_SELECT).gte('placed_at', today).order('placed_at', { ascending: false }),
    db.from('orders').select('status'),
    head('orders').eq('status', 'paid').is('delivery_date', null),
    head('profiles').eq('status', 'pending'),
    head('documents').eq('status', 'uploaded'),
    head('cases').in('status', ['open', 'in_review', 'awaiting_info']).lt('reply_due_at', new Date().toISOString()),
    head('transfers').eq('status', 'failed'),
    db.from('transfers').select('amount_cents').eq('status', 'queued'),
  ]);
  const err = firstError(orders, statuses, unscheduled, pending, docs, overdue, failed, queued);
  if (err) return fail(err);
  const todayOrders = (orders.data ?? []) as OrderRow[];
  const ids = todayOrders.map((o) => o.id);
  let allocations: AllocationRow[] = [];
  let trips: TripRow[] = [];
  let payments: PaymentRow[] = [];
  if (ids.length) {
    const [a, p] = await Promise.all([
      db.from('admin_allocations').select('*').in('order_id', ids),
      db.from('payments').select('*').in('order_id', ids),
    ]);
    allocations = (a.data ?? []) as AllocationRow[];
    payments = (p.data ?? []) as PaymentRow[];
    if (allocations.length) {
      const t = await db.from('admin_trips').select('*').in('allocation_id', allocations.map((x) => x.id));
      trips = (t.data ?? []) as TripRow[];
    }
  }
  const pipeline: Record<string, number> = {};
  for (const r of (statuses.data ?? []) as { status: string }[]) pipeline[r.status] = (pipeline[r.status] ?? 0) + 1;
  const queuedRows = (queued.data ?? []) as { amount_cents: number }[];
  return ok({
    todayOrders, pipeline, allocations, trips, payments,
    needsAction: [
      { key: 'unscheduled', count: unscheduled.count ?? 0, to: '/admin/schedule' },
      { key: 'pending_accounts', count: pending.count ?? 0, to: '/admin/users' },
      { key: 'documents_to_review', count: docs.count ?? 0, to: '/admin/users' },
      { key: 'cases_overdue', count: overdue.count ?? 0, to: '/admin/cases' },
      { key: 'transfers_failed', count: failed.count ?? 0, to: '/admin/payouts' },
    ],
    transfersQueued: { count: queuedRows.length, cents: queuedRows.reduce((s, r) => s + r.amount_cents, 0) },
  });
}

/* --------------------------------------------------------------------- orders */

export async function loadOrders(): Promise<Result<OrderRow[]>> {
  const r = await db.from('orders').select(ORDER_SELECT).order('placed_at', { ascending: false }).limit(1000);
  return r.error ? fail(r.error) : ok((r.data ?? []) as OrderRow[]);
}

/** TODO(backend): rpc admin_cancel_orders(p_order_ids uuid[]) cancels `placed` (unpaid) orders only, writes order_events + audit_log. */
export async function cancelOrders(ids: string[], client: DbClient = db): Promise<Result<null>> {
  const r = await client.rpc('admin_cancel_orders', { p_order_ids: ids });
  return r.error ? fail(r.error) : ok(null);
}

export interface OrderDetail {
  order: OrderRow;
  allocations: AllocationRow[];
  trips: TripRow[];
  payments: PaymentRow[];
  events: OrderEventRow[];
  requirements: Record<string, SupplierRequirements>;
  supplierDetails: Record<string, SupplierDetails>;
}

export async function loadOrderDetail(id: string): Promise<Result<OrderDetail>> {
  const [o, a, p, e] = await Promise.all([
    db.from('orders').select(ORDER_SELECT).eq('id', id).single(),
    db.from('admin_allocations').select('*').eq('order_id', id).order('created_at'),
    db.from('payments').select('*').eq('order_id', id).order('created_at'),
    db.from('order_events').select('*, actor:profiles(full_name)').eq('order_id', id).order('created_at'),
  ]);
  const err = firstError(o, a, p, e);
  if (err) return fail(err);
  const allocations = (a.data ?? []) as AllocationRow[];
  const supplierIds = allocations.map((x) => x.supplier_id);
  const [t, req, sd] = await Promise.all([
    allocations.length ? db.from('admin_trips').select('*').in('allocation_id', allocations.map((x) => x.id)) : Promise.resolve({ data: [], error: null }),
    supplierIds.length ? db.from('supplier_requirements').select('*').in('supplier_id', supplierIds) : Promise.resolve({ data: [], error: null }),
    supplierIds.length ? db.from('supplier_details').select('*').in('profile_id', supplierIds) : Promise.resolve({ data: [], error: null }),
  ]);
  const trips = (t.data ?? []) as TripRow[];
  const names = await namesFor([...supplierIds, ...trips.map((x) => x.driver_id)]);
  return ok({
    order: o.data as OrderRow,
    allocations: allocations.map((x) => ({ ...x, supplier: names.get(x.supplier_id) ?? null })),
    trips: trips.map((x) => ({ ...x, driver: x.driver_id ? names.get(x.driver_id) ?? null : null })),
    payments: (p.data ?? []) as PaymentRow[],
    events: (e.data ?? []) as OrderEventRow[],
    requirements: Object.fromEntries(((req.data ?? []) as SupplierRequirements[]).map((r) => [r.supplier_id, r])),
    supplierDetails: Object.fromEntries(((sd.data ?? []) as SupplierDetails[]).map((r) => [r.profile_id, r])),
  });
}

export async function loadSlots(): Promise<Result<DeliverySlot[]>> {
  const r = await db.from('delivery_slots').select('*').eq('active', true).order('start_time');
  return r.error ? fail(r.error) : ok((r.data ?? []) as DeliverySlot[]);
}

/**
 * TODO(backend): rpc match_suppliers(p_order_id uuid) returns setof MatchCandidate (see types.ts).
 * Must exclude nothing itself: paused / bird-flu suppliers come back flagged so admin can see why.
 */
export async function matchSuppliers(orderId: string, client: DbClient = db): Promise<Result<MatchCandidate[]>> {
  const r = await client.rpc('match_suppliers', { p_order_id: orderId });
  return r.error ? fail(r.error) : ok((r.data ?? []) as MatchCandidate[]);
}

/** TODO(backend): rpc admin_assign_supplier(p_order_id, p_supplier_id, p_quantity) creates the allocation + audit_log. */
export async function assignSupplier(orderId: string, supplierId: string, quantity: number, client: DbClient = db): Promise<Result<null>> {
  const r = await client.rpc('admin_assign_supplier', { p_order_id: orderId, p_supplier_id: supplierId, p_quantity: quantity });
  return r.error ? fail(r.error) : ok(null);
}

/** TODO(backend): rpc admin_schedule_order(p_order_id, p_delivery_date date, p_slot_id uuid) sets date+slot, status scheduled, notifies buyer. */
export async function scheduleOrder(orderId: string, date: string, slotId: string, client: DbClient = db): Promise<Result<null>> {
  const r = await client.rpc('admin_schedule_order', { p_order_id: orderId, p_delivery_date: date, p_slot_id: slotId });
  return r.error ? fail(r.error) : ok(null);
}

export interface DriverOption { driver: DriverDetails; requirements: SupplierRequirements | null }
export async function loadDriverOptions(supplierId: string): Promise<Result<DriverOption[]>> {
  const [d, r] = await Promise.all([
    db.from('driver_details').select('*, profile:profiles(full_name, business_name)'),
    db.from('supplier_requirements').select('*').eq('supplier_id', supplierId).maybeSingle(),
  ]);
  const err = firstError(d, r);
  if (err) return fail(err);
  return ok(((d.data ?? []) as DriverDetails[]).map((driver) => ({ driver, requirements: (r.data as SupplierRequirements) ?? null })));
}

/** TODO(backend): rpc admin_assign_driver(p_allocation_id, p_driver_id) creates/updates the trip; re-checks requirements + capacity server-side. */
export async function assignDriver(allocationId: string, driverId: string, client: DbClient = db): Promise<Result<null>> {
  const r = await client.rpc('admin_assign_driver', { p_allocation_id: allocationId, p_driver_id: driverId });
  return r.error ? fail(r.error) : ok(null);
}

/**
 * TODO(backend): rpc admin_rematch(p_order_id, p_new_supplier_id, p_expected_outcome text).
 * Server recomputes the outcome from live margin and rejects if it differs from p_expected_outcome:
 * cheaper_keep_price | absorb (margin >= 0) | full_refund (margin < 0, triggers Paystack refund).
 */
export async function rematchOrder(orderId: string, supplierId: string, expectedOutcome: string, client: DbClient = db): Promise<Result<null>> {
  const r = await client.rpc('admin_rematch', { p_order_id: orderId, p_new_supplier_id: supplierId, p_expected_outcome: expectedOutcome });
  return r.error ? fail(r.error) : ok(null);
}

/* ------------------------------------------------------------------- schedule */

export interface ScheduleData {
  toSchedule: (OrderRow & { allocations: AllocationRow[] })[];
  scheduled: OrderRow[];
  allocations: AllocationRow[];
  trips: TripRow[];
  drivers: { id: string; name: string }[];
  slots: DeliverySlot[];
  stock: { supplier_id: string; supplier: string; bird_type: string; birds_available: number }[];
  supplierDetails: Record<string, SupplierDetails>;
}

export function weekStart(d: Date): string {
  const x = new Date(d);
  const diff = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - diff);
  return x.toISOString().slice(0, 10);
}

export async function loadSchedule(date: string): Promise<Result<ScheduleData>> {
  const [paid, sched, slots, drivers, stock] = await Promise.all([
    db.from('orders').select(ORDER_SELECT).eq('status', 'paid').is('delivery_date', null).order('paid_at'),
    db.from('orders').select(ORDER_SELECT).eq('delivery_date', date),
    db.from('delivery_slots').select('*').eq('active', true).order('start_time'),
    db.from('driver_details').select('profile_id, profile:profiles(full_name, business_name)').eq('paused', false),
    db.from('stock').select('supplier_id, bird_type, birds_available').eq('week_start', weekStart(new Date(date))),
  ]);
  const err = firstError(paid, sched, slots, drivers, stock);
  if (err) return fail(err);
  const orders = [...((paid.data ?? []) as OrderRow[]), ...((sched.data ?? []) as OrderRow[])];
  const a = orders.length ? await db.from('admin_allocations').select('*').in('order_id', orders.map((o) => o.id)) : { data: [], error: null };
  const allocations = (a.data ?? []) as AllocationRow[];
  const t = allocations.length ? await db.from('admin_trips').select('*').in('allocation_id', allocations.map((x) => x.id)) : { data: [], error: null };
  const stockRows = (stock.data ?? []) as { supplier_id: string; bird_type: string; birds_available: number }[];
  const supplierIds = [...new Set([...allocations.map((x) => x.supplier_id), ...stockRows.map((s) => s.supplier_id)])];
  const sd = supplierIds.length ? await db.from('supplier_details').select('*').in('profile_id', supplierIds) : { data: [], error: null };
  const names = await namesFor(supplierIds);
  return ok({
    toSchedule: ((paid.data ?? []) as OrderRow[]).map((o) => ({ ...o, allocations: allocations.filter((x) => x.order_id === o.id) })),
    scheduled: (sched.data ?? []) as OrderRow[],
    allocations: allocations.map((x) => ({ ...x, supplier: names.get(x.supplier_id) ?? null })),
    trips: (t.data ?? []) as TripRow[],
    slots: (slots.data ?? []) as DeliverySlot[],
    drivers: ((drivers.data ?? []) as any[]).map((d) => ({ id: d.profile_id, name: d.profile?.business_name ?? d.profile?.full_name ?? d.profile_id })),
    stock: stockRows.map((s) => ({ ...s, supplier: names.get(s.supplier_id)?.business_name ?? names.get(s.supplier_id)?.full_name ?? s.supplier_id })),
    supplierDetails: Object.fromEntries(((sd.data ?? []) as SupplierDetails[]).map((r) => [r.profile_id, r])),
  });
}

/* ---------------------------------------------------------------------- users */

export type UserTab = 'pending' | 'buyer' | 'supplier' | 'driver' | 'admin';
export async function loadUsers(tab: UserTab): Promise<Result<any[]>> {
  let q = db.from('profiles').select('*').order('created_at', { ascending: false });
  q = tab === 'pending' ? q.eq('status', 'pending') : q.eq('role', tab);
  const r = await q;
  return r.error ? fail(r.error) : ok(r.data ?? []);
}

export async function loadUserCounts(): Promise<Record<UserTab, number>> {
  const r = await db.from('profiles').select('role, status');
  const c: Record<UserTab, number> = { pending: 0, buyer: 0, supplier: 0, driver: 0, admin: 0 };
  for (const p of (r.data ?? []) as { role: UserTab; status: string }[]) {
    c[p.role] += 1;
    if (p.status === 'pending') c.pending += 1;
  }
  return c;
}

export interface UserReview { documents: DocumentRow[]; supplier: SupplierDetails | null; driver: DriverDetails | null }
export async function loadUserReview(profileId: string): Promise<Result<UserReview>> {
  const [d, s, v] = await Promise.all([
    db.from('documents').select('*').eq('profile_id', profileId).order('kind'),
    db.from('supplier_details').select('*').eq('profile_id', profileId).maybeSingle(),
    db.from('driver_details').select('*').eq('profile_id', profileId).maybeSingle(),
  ]);
  const err = firstError(d, s, v);
  return err ? fail(err) : ok({ documents: (d.data ?? []) as DocumentRow[], supplier: s.data ?? null, driver: v.data ?? null });
}

/** Existing RPC from the signup/approval migration. */
export async function setProfileStatus(profileId: string, status: 'active' | 'suspended', client: DbClient = db): Promise<Result<null>> {
  const r = await client.rpc('set_profile_status', { p_profile_id: profileId, p_status: status, p_note: null });
  return r.error ? fail(r.error) : ok(null);
}

/** TODO(backend): rpc admin_set_document_status(p_document_id, p_status document_status, p_note text) stamps reviewed_by/at + audit_log. */
export async function setDocumentStatus(documentId: string, status: Extract<DocumentStatus, 'approved' | 'rejected'>, note: string | null, client: DbClient = db): Promise<Result<null>> {
  const r = await client.rpc('admin_set_document_status', { p_document_id: documentId, p_status: status, p_note: note });
  return r.error ? fail(r.error) : ok(null);
}

/** TODO(backend): confirm the storage bucket name for documents.file_path; 'documents' assumed. */
export async function documentUrl(path: string): Promise<string | null> {
  const r = await (supabase as any).storage.from('documents').createSignedUrl(path, 300);
  return r.data?.signedUrl ?? null;
}

/* ---------------------------------------------------------------------- cases */

const CASE_SELECT =
  '*, order:orders(number, quantity), raiser:profiles!cases_raised_by_fkey(full_name, business_name)';

export async function loadCases(): Promise<Result<CaseRow[]>> {
  const r = await db.from('cases').select(CASE_SELECT).order('created_at', { ascending: false });
  return r.error ? fail(r.error) : ok((r.data ?? []) as CaseRow[]);
}

export interface CaseDetail {
  events: CaseEventRow[];
  allocations: AllocationRow[];
  trips: TripRow[];
}
export async function loadCaseDetail(c: CaseRow): Promise<Result<CaseDetail>> {
  const ev = await db.from('case_events').select('*, actor:profiles(full_name)').eq('case_id', c.id).order('created_at');
  if (ev.error) return fail(ev.error);
  let allocations: AllocationRow[] = [];
  let trips: TripRow[] = [];
  if (c.order_id) {
    const a = await db.from('admin_allocations').select('*').eq('order_id', c.order_id);
    allocations = (a.data ?? []) as AllocationRow[];
    if (allocations.length) {
      const t = await db.from('admin_trips').select('*').in('allocation_id', allocations.map((x) => x.id));
      trips = (t.data ?? []) as TripRow[];
    }
  }
  return ok({ events: (ev.data ?? []) as CaseEventRow[], allocations, trips });
}

export interface AdvanceCaseInput {
  caseId: string;
  from: CaseStatus;
  to: CaseStatus;
  resolution?: CaseResolution | '';
  amountCents?: number | null;
  costTo?: CaseCostOwner | '';
  note?: string | null;
}
/**
 * TODO(backend): rpc admin_advance_case(p_case_id, p_status, p_resolution, p_amount_cents, p_cost_to, p_note)
 * writes cases + a case_events 'status' row (visible_to_buyer) + audit_log; refund resolutions queue a Paystack refund.
 * Forward-only is enforced here AND must be enforced server-side.
 */
export async function advanceCase(i: AdvanceCaseInput, client: DbClient = db): Promise<Result<null>> {
  if (!isForwardTransition(i.from, i.to)) return fail({ message: 'not_forward', code: 'not_forward' });
  if (i.to === 'resolved') {
    const problem = validateResolution({ resolution: i.resolution ?? '', amountCents: i.amountCents ?? null, costOwner: i.costTo ?? '' });
    if (problem) return fail({ message: problem, code: problem });
  }
  const r = await client.rpc('admin_advance_case', {
    p_case_id: i.caseId, p_status: i.to, p_resolution: i.resolution || null,
    p_amount_cents: i.amountCents ?? null, p_cost_to: i.costTo || null, p_note: i.note ?? null,
  });
  return r.error ? fail(r.error) : ok(null);
}

/** TODO(backend): rpc admin_add_case_event(p_case_id, p_kind, p_body, p_visible_to_buyer). */
export async function addCaseEvent(caseId: string, kind: CaseEventRow['kind'], body: string, visible: boolean, client: DbClient = db): Promise<Result<null>> {
  const r = await client.rpc('admin_add_case_event', { p_case_id: caseId, p_kind: kind, p_body: body, p_visible_to_buyer: visible });
  return r.error ? fail(r.error) : ok(null);
}

/* -------------------------------------------------------------------- payouts */

export async function loadTransfers(): Promise<Result<TransferRow[]>> {
  const r = await db.from('transfers').select('*, party:profiles(full_name, business_name)').order('created_at', { ascending: false }).limit(500);
  return r.error ? fail(r.error) : ok((r.data ?? []) as TransferRow[]);
}

/** TODO(backend): rpc admin_retry_transfer(p_transfer_id) re-queues a FAILED transfer only (server must also refuse other states). */
export async function retryTransfer(t: { id: string; status: TransferStatus }, client: DbClient = db): Promise<Result<null>> {
  if (!canRetry(t.status)) return fail({ message: 'not_failed', code: 'not_failed' });
  const r = await client.rpc('admin_retry_transfer', { p_transfer_id: t.id });
  return r.error ? fail(r.error) : ok(null);
}

/* ----------------------------------------------------------------- compliance */

export interface ComplianceData {
  reports: { id: string; month: string; status: 'draft' | 'submitted'; submitted_at: string | null }[];
  expiringDocs: (DocumentRow & { owner?: NameRef | null })[];
  expiringPermits: (AllocationRow & { order_number?: string })[];
  pausedInZones: { details: SupplierDetails; name: string }[];
  crossingTrips: (AllocationRow & { order_number?: string })[];
}

export async function loadCompliance(): Promise<Result<ComplianceData>> {
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 864e5).toISOString().slice(0, 10);
  const in24h = new Date(now.getTime() + 24 * 36e5).toISOString();
  const [rep, docs, permits, zones, cross] = await Promise.all([
    db.from('pdma_reports').select('id, month, status, submitted_at').order('month', { ascending: false }).limit(6),
    db.from('documents').select('*, owner:profiles!documents_profile_id_fkey(full_name, business_name)').lte('expires_on', in30).in('status', ['approved', 'uploaded']).order('expires_on'),
    db.from('admin_allocations').select('*').not('permit_valid_until', 'is', null).lte('permit_valid_until', in24h).in('status', ['accepted', 'ready']).order('permit_valid_until'),
    db.from('supplier_details').select('*').neq('avian_flu_zone', 'none'),
    db.from('admin_allocations').select('*').eq('crosses_province', true).neq('status', 'collected'),
  ]);
  const err = firstError(rep, docs, permits, zones, cross);
  if (err) return fail(err);
  const permitRows = (permits.data ?? []) as AllocationRow[];
  const crossRows = (cross.data ?? []) as AllocationRow[];
  const zoneRows = (zones.data ?? []) as SupplierDetails[];
  const orderIds = [...new Set([...permitRows, ...crossRows].map((x) => x.order_id))];
  const [orders, names] = await Promise.all([
    orderIds.length ? db.from('orders').select('id, number').in('id', orderIds) : Promise.resolve({ data: [] }),
    namesFor(zoneRows.map((z) => z.profile_id)),
  ]);
  const num = new Map(((orders.data ?? []) as { id: string; number: string }[]).map((o) => [o.id, o.number]));
  const tag = (x: AllocationRow) => ({ ...x, order_number: num.get(x.order_id) });
  return ok({
    reports: (rep.data ?? []) as ComplianceData['reports'],
    expiringDocs: (docs.data ?? []) as ComplianceData['expiringDocs'],
    expiringPermits: permitRows.map(tag),
    pausedInZones: zoneRows.filter((z) => z.paused).map((details) => ({ details, name: names.get(details.profile_id)?.business_name ?? names.get(details.profile_id)?.full_name ?? details.profile_id })),
    crossingTrips: crossRows.map(tag),
  });
}

/* -------------------------------------------------------------------- reports */

export interface ReportData {
  orders: OrderRow[];
  allocations: AllocationRow[];
  trips: TripRow[];
  payments: PaymentRow[];
  supplierRatings: Record<string, number | null>;
  driverRatings: Record<string, number | null>;
}
export async function loadReportData(days: number): Promise<Result<ReportData>> {
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const o = await db.from('orders').select(ORDER_SELECT)
    .in('status', ['paid', 'scheduled', 'ready', 'on_the_way', 'delivered', 'settled']).gte('placed_at', since);
  if (o.error) return fail(o.error);
  const orders = (o.data ?? []) as OrderRow[];
  const ids = orders.map((x) => x.id);
  if (!ids.length) return ok({ orders, allocations: [], trips: [], payments: [], supplierRatings: {}, driverRatings: {} });
  const [a, p] = await Promise.all([
    db.from('admin_allocations').select('*').in('order_id', ids),
    db.from('payments').select('*').in('order_id', ids),
  ]);
  const allocations = (a.data ?? []) as AllocationRow[];
  const t = allocations.length ? await db.from('admin_trips').select('*').in('allocation_id', allocations.map((x) => x.id)) : { data: [] };
  const trips = (t.data ?? []) as TripRow[];
  const [names, sd, dd] = await Promise.all([
    namesFor([...allocations.map((x) => x.supplier_id), ...trips.map((x) => x.driver_id)]),
    db.from('supplier_details').select('profile_id, rating_avg'),
    db.from('driver_details').select('profile_id, rating_avg'),
  ]);
  return ok({
    orders,
    allocations: allocations.map((x) => ({ ...x, supplier: names.get(x.supplier_id) ?? null })),
    trips: trips.map((x) => ({ ...x, driver: x.driver_id ? names.get(x.driver_id) ?? null : null })),
    payments: (p.data ?? []) as PaymentRow[],
    supplierRatings: Object.fromEntries(((sd.data ?? []) as any[]).map((r) => [r.profile_id, r.rating_avg])),
    driverRatings: Object.fromEntries(((dd.data ?? []) as any[]).map((r) => [r.profile_id, r.rating_avg])),
  });
}

/* ------------------------------------------------------------------- settings */

export async function loadSettings(): Promise<Result<SettingsMap>> {
  const r = await db.from('settings').select('key, value');
  if (r.error) return fail(r.error);
  return ok(Object.fromEntries(((r.data ?? []) as { key: string; value: JsonValue }[]).map((s) => [s.key, s.value])));
}

export async function loadAreas(): Promise<Result<AreaRow[]>> {
  const [a, p] = await Promise.all([
    db.from('areas_served').select('province, active, launch_order'),
    db.from('provinces').select('code, name'),
  ]);
  const err = firstError(a, p);
  if (err) return fail(err);
  const names = new Map(((p.data ?? []) as { code: string; name: string }[]).map((x) => [x.code, x.name]));
  return ok(((a.data ?? []) as AreaRow[]).map((x) => ({ ...x, name: names.get(x.province) ?? x.province })).sort((x, y) => (x.launch_order ?? 999) - (y.launch_order ?? 999)));
}

export interface UpdateSettingsResult { error: ApiError | null; changed: string[] }

/**
 * Validates the changed keys, then sends them to `admin_update_settings`, which checks the caller is
 * an admin, writes one audit_log row per key (before/after) and updates settings in one transaction.
 * Admins have no direct write grant on settings or audit_log. Values apply to new quotes only.
 */
export async function updateSettings(
  _actorId: string,
  current: SettingsMap,
  next: SettingsMap,
  client: DbClient = db,
): Promise<UpdateSettingsResult> {
  const changed = Object.keys(next).filter((k) => !sameValue(current[k], next[k]));
  for (const key of changed) {
    const def = defFor(key);
    if (def) {
      const v = next[key];
      const res = validateSetting(def, v === null ? '' : String(v));
      if (!res.ok) return { error: { message: res.error, code: res.error }, changed: [] };
    }
  }
  if (!changed.length) return { error: null, changed };
  const r = await client.rpc('admin_update_settings', {
    p_changes: Object.fromEntries(changed.map((k) => [k, next[k]])),
  });
  return r.error ? { error: r.error, changed: [] } : { error: null, changed };
}

export async function updateArea(
  _actorId: string,
  before: Pick<AreaRow, 'province' | 'active' | 'launch_order'>,
  after: Pick<AreaRow, 'active' | 'launch_order'>,
  client: DbClient = db,
): Promise<Result<null>> {
  if (after.launch_order !== null && (!Number.isInteger(after.launch_order) || after.launch_order < 1)) {
    return fail({ message: 'not_integer', code: 'not_integer' });
  }
  const r = await client.rpc('admin_update_area', {
    p_province: before.province, p_active: after.active, p_launch_order: after.launch_order,
  });
  return r.error ? fail(r.error) : ok(null);
}

/* --------------------------------------------------------------------- quotes */

export interface QuoteRequestRow {
  id: string; buyer_id: string; kind: 'instant' | 'requested'; status: 'open' | 'accepted' | 'expired' | 'declined';
  bird_type: string; weight_band: string; quantity: number; total_cents: number | null;
  expires_at: string | null; created_at: string;
  buyer?: NameRef | null; address?: { town: string | null; province: string | null } | null;
}

export type CandidateReason =
  | 'not_active' | 'paused' | 'no_location' | 'no_price' | 'flu_zone' | 'docs' | 'stock' | 'no_driver';

export interface QuoteCandidate {
  supplier_id: string; supplier_name: string; phone: string | null; eligible: boolean; reasons: CandidateReason[];
  price_cents: number | null; distance_km: number | null; same_province: boolean | null;
  stock_available: number | null; rating_avg: number | null;
}

export async function loadQuotes(): Promise<Result<QuoteRequestRow[]>> {
  const r = await db.from('admin_quotes')
    .select('id, buyer_id, kind, status, bird_type, weight_band, quantity, total_cents, expires_at, created_at, address_id')
    .order('created_at', { ascending: false }).limit(200);
  if (r.error) return fail(r.error);
  const rows = (r.data ?? []) as (QuoteRequestRow & { address_id: string })[];
  const names = await namesFor(rows.map((x) => x.buyer_id));
  const ids = [...new Set(rows.map((x) => x.address_id))];
  const addr = ids.length ? await db.from('addresses').select('id, town, province').in('id', ids) : { data: [] };
  const addrMap = new Map(((addr.data ?? []) as any[]).map((a) => [a.id, { town: a.town, province: a.province }]));
  return ok(rows.map((x) => ({ ...x, buyer: names.get(x.buyer_id) ?? null, address: addrMap.get(x.address_id) ?? null })));
}

export async function loadQuoteCandidates(quoteId: string, client: DbClient = db): Promise<Result<QuoteCandidate[]>> {
  const r = await client.rpc('admin_quote_candidates', { p_quote_id: quoteId });
  if (r.error) return fail(r.error);
  const rows = (r.data ?? []) as Omit<QuoteCandidate, 'supplier_name'>[];
  const names = await namesFor(rows.map((x) => x.supplier_id), client);
  const ph = rows.length ? await client.from('profiles').select('id, whatsapp_phone').in('id', rows.map((x) => x.supplier_id)) : { data: [] };
  const phones = new Map(((ph.data ?? []) as { id: string; whatsapp_phone: string | null }[]).map((p) => [p.id, p.whatsapp_phone]));
  return ok(rows.map((x) => ({ ...x, supplier_name: displayNameOf(names.get(x.supplier_id)), phone: phones.get(x.supplier_id) ?? null })));
}

function displayNameOf(n?: NameRef | null): string {
  return n ? (n.business_name || n.full_name) : '';
}

export interface QuoteAllocation { supplier_id: string; birds: number; price_cents: number }

/** Prices an open requested quote. The database checks the birds add up to the quote quantity. */
export async function priceQuote(quoteId: string, allocations: QuoteAllocation[], client: DbClient = db): Promise<Result<null>> {
  const total = allocations.reduce((a, x) => a + x.birds, 0);
  if (!allocations.length || allocations.some((x) => !Number.isInteger(x.birds) || x.birds < 1)) {
    return fail({ message: 'allocation_invalid', code: 'allocation_invalid' });
  }
  if (total < 1) return fail({ message: 'allocation_invalid', code: 'allocation_invalid' });
  const r = await client.rpc('admin_price_quote', { p_quote_id: quoteId, p_allocations: allocations });
  return r.error ? fail(r.error) : ok(null);
}

export interface DriverParty {
  id: string; name: string; phone: string | null; status: string; paused: boolean;
  capacity_birds: number | null; covered: boolean;
}

/** Every driver and what is missing from their vehicle setup, so an admin can chase the right one. */
export async function loadDriverParties(client: DbClient = db): Promise<Result<DriverParty[]>> {
  const r = await client.from('driver_details')
    .select('profile_id, paused, capacity_birds, covered, profile:profiles(full_name, business_name, whatsapp_phone, status)');
  if (r.error) return fail(r.error);
  return ok(((r.data ?? []) as any[]).map((d) => ({
    id: d.profile_id, name: d.profile?.business_name || d.profile?.full_name || '', phone: d.profile?.whatsapp_phone ?? null,
    status: d.profile?.status ?? 'unknown', paused: !!d.paused, capacity_birds: d.capacity_birds ?? null, covered: !!d.covered,
  })));
}

/* ------------------------------------------------------------------ incidents */

export interface IncidentRow {
  id: string; number: string; kind: string; severity: 'info' | 'warn' | 'critical';
  status: 'open' | 'in_review' | 'resolved' | 'dismissed'; source: 'auto' | 'user' | 'admin';
  raised_by: string | null; raised_role: string | null; order_id: string | null; allocation_id: string | null; trip_id: string | null;
  title: string; details: string | null; data: Record<string, unknown> | null; resolution_note: string | null;
  resolved_at: string | null; created_at: string;
  raiser?: NameRef | null; order_number?: string | null;
}
export interface IncidentEvent {
  id: string; incident_id: string; actor_id: string | null; kind: 'comment' | 'status' | 'correction';
  body: string; visible_to_raiser: boolean; created_at: string; actor?: NameRef | null;
}

export async function loadIncidents(): Promise<Result<IncidentRow[]>> {
  const r = await db.from('incidents').select('*').order('created_at', { ascending: false }).limit(300);
  if (r.error) return fail(r.error);
  const rows = (r.data ?? []) as IncidentRow[];
  const names = await namesFor(rows.map((x) => x.raised_by));
  const orderIds = [...new Set(rows.map((x) => x.order_id).filter((x): x is string => !!x))];
  const orders = orderIds.length ? await db.from('orders').select('id, number').in('id', orderIds) : { data: [] };
  const numbers = new Map(((orders.data ?? []) as { id: string; number: string }[]).map((o) => [o.id, o.number]));
  return ok(rows.map((x) => ({ ...x, raiser: x.raised_by ? names.get(x.raised_by) ?? null : null, order_number: x.order_id ? numbers.get(x.order_id) ?? null : null })));
}

export async function loadIncidentEvents(incidentId: string): Promise<Result<IncidentEvent[]>> {
  const r = await db.from('incident_events').select('*').eq('incident_id', incidentId).order('created_at');
  if (r.error) return fail(r.error);
  const rows = (r.data ?? []) as IncidentEvent[];
  const names = await namesFor(rows.map((x) => x.actor_id));
  return ok(rows.map((x) => ({ ...x, actor: x.actor_id ? names.get(x.actor_id) ?? null : null })));
}

export async function updateIncident(id: string, status: IncidentRow['status'], note: string, visible: boolean, client: DbClient = db): Promise<Result<null>> {
  const r = await client.rpc('admin_update_incident', { p_id: id, p_status: status, p_note: note, p_visible: visible });
  return r.error ? fail(r.error) : ok(null);
}

export async function correctPickupCount(allocationId: string, count: number, reason: string, incidentId: string | null, client: DbClient = db): Promise<Result<null>> {
  if (!Number.isInteger(count) || count < 0) return fail({ message: 'not_integer', code: 'not_integer' });
  const r = await client.rpc('admin_correct_pickup_count', { p_allocation_id: allocationId, p_count: count, p_reason: reason, p_incident_id: incidentId });
  return r.error ? fail(r.error) : ok(null);
}

export async function forceDelivery(tripId: string, count: number | null, reason: string, client: DbClient = db): Promise<Result<null>> {
  const r = await client.rpc('admin_force_delivery', { p_trip_id: tripId, p_count: count, p_reason: reason });
  return r.error ? fail(r.error) : ok(null);
}
