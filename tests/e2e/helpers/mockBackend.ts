import type { Page, Route } from '@playwright/test';

// A small in-browser-network fake of Supabase Auth + PostgREST + Edge Functions, so the whole UI can
// be exercised end to end without a database. It is deliberately dumb: tables are arrays, filters
// support eq/in only, and anything a test cares about (RPC results, errors, latency) is set per test.
// Real RLS/SQL behaviour is covered by tests/rls and tests/api; the live-backend specs cover wiring.

export type Json = Record<string, unknown>;
export type RpcHandler = (args: Json) => { data?: unknown; error?: { message: string; code?: string } } | Promise<{ data?: unknown; error?: { message: string; code?: string } }>;

export interface MockUser {
  id: string;
  email: string;
  password: string;
  profile: Json;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*',
  'access-control-expose-headers': '*',
};

function fakeJwt(sub: string): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
}

export class MockBackend {
  users: MockUser[] = [];
  tables: Record<string, Json[]> = {};
  rpcs: Record<string, RpcHandler> = {};
  /** Every RPC call, in order. */
  rpcCalls: { name: string; args: Json }[] = [];
  /** Every Edge Function call. */
  fnCalls: { name: string; body: unknown }[] = [];
  /** Every non-GET PostgREST call, e.g. inserts. */
  writes: { method: string; table: string; body: unknown }[] = [];
  /** Requests nobody handled (a test failing on this is a missing fixture). */
  unhandled: string[] = [];
  functions: Record<string, (body: unknown) => { status?: number; body?: unknown; pdf?: boolean }> = {};
  /** Artificial latency per RPC name, to widen double-click and race windows. */
  rpcDelayMs: Record<string, number> = {};
  /** Artificial latency per table read. */
  tableDelayMs: Record<string, number> = {};
  /** Tables whose reads fail with a 500. */
  tableErrors = new Set<string>();

  addUser(u: MockUser): this { this.users.push(u); this.tables.profiles = [...(this.tables.profiles ?? []), u.profile]; return this; }
  table(name: string, rows: Json[]): this { this.tables[name] = rows; return this; }
  rpc(name: string, h: RpcHandler): this { this.rpcs[name] = h; return this; }
  fn(name: string, h: MockBackend['functions'][string]): this { this.functions[name] = h; return this; }

  async install(page: Page): Promise<void> {
    await page.route(/\/auth\/v1\//, (r) => this.auth(r));
    await page.route(/\/rest\/v1\//, (r) => this.rest(r));
    await page.route(/\/functions\/v1\//, (r) => this.func(r));
    await page.route(/\/storage\/v1\//, (r) => r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: '[]' }));
  }

  private json(route: Route, status: number, body: unknown, extra: Record<string, string> = {}) {
    return route.fulfill({ status, headers: { ...CORS, ...extra }, contentType: 'application/json', body: JSON.stringify(body) });
  }

  private async auth(route: Route) {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    if (url.pathname.endsWith('/token') && url.searchParams.get('grant_type') === 'password') {
      const { email, password } = req.postDataJSON() as { email: string; password: string };
      const u = this.users.find((x) => x.email === email && x.password === password);
      if (!u) return this.json(route, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      const token = fakeJwt(u.id);
      return this.json(route, 200, {
        access_token: token, refresh_token: 'refresh-' + u.id, token_type: 'bearer', expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
      });
    }
    if (url.pathname.endsWith('/logout')) return route.fulfill({ status: 204, headers: CORS });
    return this.json(route, 200, {});
  }

  private match(rows: Json[], params: URLSearchParams): Json[] {
    let out = rows;
    params.forEach((val, key) => {
      if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(key)) return;
      const m = /^(eq|in|neq|is)\.(.*)$/.exec(val);
      if (!m) return;
      const [, op, rhs] = m;
      if (op === 'eq') out = out.filter((r) => String(r[key]) === rhs);
      else if (op === 'neq') out = out.filter((r) => String(r[key]) !== rhs);
      else if (op === 'in') {
        const set = rhs.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, ''));
        out = out.filter((r) => set.includes(String(r[key])));
      } else if (op === 'is' && rhs === 'null') out = out.filter((r) => r[key] == null);
    });
    return out;
  }

  private async rest(route: Route) {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const rel = url.pathname.split('/rest/v1/')[1] ?? '';
    if (rel.startsWith('rpc/')) {
      const name = rel.slice(4);
      const args = (req.postDataJSON() ?? {}) as Json;
      this.rpcCalls.push({ name, args });
      const h = this.rpcs[name];
      if (!h) { this.unhandled.push(`rpc ${name}`); return this.json(route, 404, { code: 'PGRST202', message: `no mock for rpc ${name}` }); }
      const delay = this.rpcDelayMs[name];
      if (delay) await new Promise((r) => setTimeout(r, delay));
      const res = await h(args);
      if (res.error) return this.json(route, 400, { code: res.error.code ?? 'P0001', message: res.error.message, details: null, hint: null });
      return this.json(route, 200, res.data ?? null);
    }
    const rows = this.tables[rel] ?? [];
    if (this.tableDelayMs[rel]) await new Promise((r) => setTimeout(r, this.tableDelayMs[rel]));
    if (this.tableErrors.has(rel)) return this.json(route, 500, { code: 'XX000', message: `mock failure on ${rel}` });
    if (req.method() !== 'GET' && req.method() !== 'HEAD') {
      this.writes.push({ method: req.method(), table: rel, body: req.postDataJSON() });
      return route.fulfill({ status: 201, headers: CORS, contentType: 'application/json', body: '[]' });
    }
    const filtered = this.match(rows, url.searchParams);
    const accept = req.headers()['accept'] ?? '';
    if (accept.includes('vnd.pgrst.object')) {
      if (filtered.length !== 1) {
        return this.json(route, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${filtered.length} rows`, hint: null });
      }
      return this.json(route, 200, filtered[0]);
    }
    return this.json(route, 200, filtered, { 'content-range': `0-${Math.max(filtered.length - 1, 0)}/${filtered.length}` });
  }

  private async func(route: Route) {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const name = new URL(req.url()).pathname.split('/functions/v1/')[1];
    const body = req.postDataJSON();
    this.fnCalls.push({ name, body });
    const h = this.functions[name];
    if (!h) { this.unhandled.push(`function ${name}`); return this.json(route, 404, { error: 'no mock' }); }
    const res = h(body);
    if (res.pdf) return route.fulfill({ status: 200, headers: CORS, contentType: 'application/pdf', body: Buffer.from('%PDF-1.4\n%%EOF\n') });
    return this.json(route, res.status ?? 200, res.body ?? {});
  }
}

const now = () => new Date().toISOString();
export function profile(id: string, role: string, status = 'active', extra: Json = {}): Json {
  return { id, role, status, full_name: `${role} tester`, business_name: null, business_type: null, whatsapp_phone: '+27820000000', email: `${role}@mock.test`, language: 'en', pdma_number: null, created_at: now(), updated_at: now(), ...extra };
}

export const USERS = {
  buyer: { id: 'b0000000-0000-4000-8000-000000000001', email: 'buyer@mock.test', password: 'Mock!Buyer1', role: 'buyer' },
  admin: { id: 'a0000000-0000-4000-8000-000000000001', email: 'admin@mock.test', password: 'Mock!Admin1', role: 'admin' },
  supplier: { id: 's0000000-0000-4000-8000-000000000001', email: 'supplier@mock.test', password: 'Mock!Supp1', role: 'supplier' },
  driver: { id: 'd0000000-0000-4000-8000-000000000001', email: 'driver@mock.test', password: 'Mock!Driv1', role: 'driver' },
  pending: { id: 'p0000000-0000-4000-8000-000000000001', email: 'pending@mock.test', password: 'Mock!Pend1', role: 'supplier', status: 'pending' },
  suspended: { id: 'x0000000-0000-4000-8000-000000000001', email: 'suspended@mock.test', password: 'Mock!Susp1', role: 'buyer', status: 'suspended' },
} as const;

export function backendWith(...which: (keyof typeof USERS)[]): MockBackend {
  const m = new MockBackend();
  for (const k of which) {
    const u = USERS[k];
    m.addUser({ id: u.id, email: u.email, password: u.password, profile: profile(u.id, u.role, 'status' in u ? u.status : 'active', { email: u.email }) });
  }
  m.table('settings', [{ key: 'payments_mode', value: 'manual' }]);
  return m;
}

export async function uiLogin(page: Page, u: { email: string; password: string }): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(u.email);
  await page.getByLabel('Password').fill(u.password);
  // Wait for the login to finish before the caller navigates. Returning straight after the click let a
  // following page.goto() abort the in-flight sign-in, which made tests land on /login at random.
  const tokenResponse = page.waitForResponse((r) => r.url().includes('/auth/v1/token') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Log in' }).click();
  await tokenResponse;
  await page.waitForLoadState('networkidle').catch(() => undefined);
}
