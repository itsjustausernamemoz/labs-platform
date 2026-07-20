// Replaces `shared/lib/supabase.ts`. Exposes a `supabase`-shaped object so
// the ~150 existing `supabase.from(...)`/`supabase.auth.*` call sites across
// all 4 apps only need an import-path swap, not a rewrite — see the plan at
// the top of this migration for why. A handful of call sites that don't fit
// this shape cleanly (the student login flow, the ExamRoom realtime
// subscription, the AI-grading edge-function calls) were hand-rewritten
// instead of forced through here — see those files directly.

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const TOKEN_KEY = 'mashoke_token';

// ---------------------------------------------------------------------------
// Low-level request helper
// ---------------------------------------------------------------------------

interface ApiError {
  message: string;
  status: number;
  code?: string;
}

function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

async function request<T = any>(
  path: string,
  { method = 'GET', body, auth = true }: { method?: string; body?: unknown; auth?: boolean } = {}
): Promise<{ data: T | null; error: ApiError | null }> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = auth ? getToken() : null;
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (res.status === 204) return { data: null, error: null };

    const text = await res.text();
    const json = text ? JSON.parse(text) : null;

    if (!res.ok) {
      return { data: null, error: { message: json?.error || res.statusText, status: res.status } };
    }
    return { data: json, error: null };
  } catch (err: any) {
    return { data: null, error: { message: err.message || 'Network error', status: 0 } };
  }
}

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined);
  if (!entries.length) return '';
  return '?' + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
}

// ---------------------------------------------------------------------------
// Query builder — mimics the subset of supabase-js's fluent API this
// codebase actually uses (.select/.insert/.update/.upsert/.delete, .eq/.in/
// .is, .order, .limit, .single/.maybeSingle). Each table has its own adapter
// below, since the real API exposes hand-written routes, not a generic
// PostgREST-style proxy — this class just accumulates the chain, then hands
// the accumulated state to the right adapter in `.then()`.
// ---------------------------------------------------------------------------

type FilterOp = 'eq' | 'neq' | 'in' | 'is' | 'gte' | 'lte' | 'gt' | 'lt';
interface Filter {
  op: FilterOp;
  value: any;
}
// A column can carry more than one filter at once (e.g. `.gte('created_at',
// a).lt('created_at', b)` for a date range), so each column maps to a list,
// not a single filter.
type Filters = Record<string, Filter[]>;

class QueryBuilder<T = any> implements PromiseLike<{ data: T | null; error: ApiError | null; count?: number | null }> {
  table: string;
  filters: Filters = {};
  _order: { col: string; ascending: boolean } | null = null;
  _limit: number | null = null;
  _single = false;
  _maybeSingle = false;
  _op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
  _payload: any = null;
  _opts: any = null;
  _countOnly = false;

  constructor(table: string) {
    this.table = table;
  }

  private addFilter(col: string, op: FilterOp, value: any) {
    (this.filters[col] ??= []).push({ op, value });
  }

  select(_columns?: string, opts?: { count?: string; head?: boolean }) {
    if (opts?.head) this._countOnly = true;
    return this;
  }
  eq(col: string, value: any) {
    this.addFilter(col, 'eq', value);
    return this;
  }
  neq(col: string, value: any) {
    this.addFilter(col, 'neq', value);
    return this;
  }
  in(col: string, values: any[]) {
    this.addFilter(col, 'in', values);
    return this;
  }
  is(col: string, value: any) {
    this.addFilter(col, 'is', value);
    return this;
  }
  gte(col: string, value: any) {
    this.addFilter(col, 'gte', value);
    return this;
  }
  /** Only `not(col, 'eq', value)` (→ neq) is used anywhere in this codebase. */
  not(col: string, operator: string, value: any) {
    if (operator === 'eq') this.addFilter(col, 'neq', value);
    return this;
  }
  lte(col: string, value: any) {
    this.addFilter(col, 'lte', value);
    return this;
  }
  gt(col: string, value: any) {
    this.addFilter(col, 'gt', value);
    return this;
  }
  lt(col: string, value: any) {
    this.addFilter(col, 'lt', value);
    return this;
  }
  /** supabase-js v2 type-only helper — no runtime behavior. */
  returns<U>() {
    return this as unknown as QueryBuilder<U>;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this._order = { col, ascending: opts?.ascending ?? true };
    return this;
  }
  limit(n: number) {
    this._limit = n;
    return this;
  }
  single() {
    this._single = true;
    return this;
  }
  maybeSingle() {
    this._maybeSingle = true;
    return this;
  }
  insert(rows: any) {
    this._op = 'insert';
    this._payload = rows;
    return this;
  }
  update(patch: any) {
    this._op = 'update';
    this._payload = patch;
    return this;
  }
  upsert(rows: any, opts?: any) {
    this._op = 'upsert';
    this._payload = rows;
    this._opts = opts;
    return this;
  }
  delete(_opts?: { count?: string }) {
    this._op = 'delete';
    return this;
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: { data: T | null; error: ApiError | null; count?: number | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return this._execute().then(onfulfilled as any, onrejected as any);
  }

  private async _execute(): Promise<{ data: T | null; error: ApiError | null; count?: number | null }> {
    const adapter = TABLE_ADAPTERS[this.table];
    if (!adapter) {
      return { data: null, error: { message: `No API adapter configured for table "${this.table}"`, status: 0 } };
    }
    return adapter(this);
  }
}

/** Without `op`, returns the first filter set on that column (the common
 *  case — most columns only ever get one filter). Pass `op` to pick a
 *  specific one when a column carries more than one (e.g. a date range). */
function filterValue(f: Filters, col: string, op?: FilterOp): any {
  const list = f[col];
  if (!list || !list.length) return undefined;
  if (op) return list.find((x) => x.op === op)?.value;
  return list[0].value;
}

// ---------------------------------------------------------------------------
// Per-table adapters — translate the accumulated QueryBuilder state into a
// real request against the Express API. Only the filter/operation shapes
// actually used by this codebase are supported; anything else falls back to
// a best-effort generic GET/POST/PATCH/DELETE against `/<table>`.
// ---------------------------------------------------------------------------

function finishList(data: any, error: ApiError | null, qb: QueryBuilder) {
  if (error) return { data: null, error, count: null };
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  if (qb._single) {
    return { data: rows[0] ?? null, error: rows[0] ? null : { message: 'Not found', status: 404 }, count: null };
  }
  if (qb._maybeSingle) return { data: rows[0] ?? null, error: null, count: null };
  if (qb._countOnly) return { data: null, error: null, count: rows.length };
  return { data: rows as any, error: null, count: null };
}

type Adapter = (qb: QueryBuilder) => Promise<{ data: any; error: ApiError | null; count?: number | null }>;

const TABLE_ADAPTERS: Record<string, Adapter> = {
  // ---- institutions -------------------------------------------------------
  institutions: async (qb) => {
    if (qb._op === 'insert') {
      const { data, error } = await request('/institutions', { method: 'POST', body: firstRow(qb._payload) });
      return { data, error };
    }
    if (qb._op === 'update') {
      const id = filterValue(qb.filters, 'id');
      const { data, error } = await request(`/institutions/${id}`, { method: 'PATCH', body: qb._payload });
      return { data, error };
    }
    if (qb._op === 'delete') {
      const id = filterValue(qb.filters, 'id');
      const { error } = await request(`/institutions/${id}`, { method: 'DELETE' });
      return { data: null, error };
    }
    const id = filterValue(qb.filters, 'id');
    if (id && (qb._single || qb._maybeSingle)) {
      const { data, error } = await request(`/institutions/${id}`);
      return finishList(data, error, qb);
    }
    const status = filterValue(qb.filters, 'status');
    const createdAtGte = filterValue(qb.filters, 'created_at', 'gte');
    const createdAtLt = filterValue(qb.filters, 'created_at', 'lt');
    const { data, error } = await request(
      `/institutions${qs({
        status: status ? `eq.${status}` : undefined,
        created_at_gte: createdAtGte,
        created_at_lt: createdAtLt,
      })}`
    );
    return finishList(data, error, qb);
  },

  institution_stats: async (qb) => {
    const institutionId = filterValue(qb.filters, 'institution_id');
    if (institutionId) {
      const { data, error } = await request(`/institutions/${institutionId}/stats`);
      return finishList(data, error, qb);
    }
    const { data, error } = await request('/institutions/stats');
    return finishList(data, error, qb);
  },

  // ---- institution_admins --------------------------------------------------
  institution_admins: async (qb) => {
    if (qb._op === 'insert') {
      const { data, error } = await request('/institution-admins', { method: 'POST', body: firstRow(qb._payload) });
      return { data, error };
    }
    if (qb._op === 'update') {
      const id = filterValue(qb.filters, 'id');
      const { data, error } = await request(`/institution-admins/${id}`, { method: 'PATCH', body: qb._payload });
      return { data, error };
    }
    if (qb._op === 'delete') {
      const id = filterValue(qb.filters, 'id');
      const { error } = await request(`/institution-admins/${id}`, { method: 'DELETE' });
      return { data: null, error };
    }
    const id = filterValue(qb.filters, 'id');
    const institutionId = filterValue(qb.filters, 'institution_id');
    if (id && !institutionId) {
      const { data, error } = await request(`/institution-admins/${id}`);
      return finishList(data, error, qb);
    }
    const { data, error } = await request(`/institution-admins${qs({ institution_id: institutionId })}`);
    return finishList(data, error, qb);
  },

  // ---- platform_admins ------------------------------------------------------
  platform_admins: async (qb) => {
    if (qb._op === 'insert') {
      const { data, error } = await request('/platform-admins', { method: 'POST', body: firstRow(qb._payload) });
      return { data, error };
    }
    if (qb._op === 'update') {
      const id = filterValue(qb.filters, 'id');
      const { data, error } = await request(`/platform-admins/${id}`, { method: 'PATCH', body: qb._payload });
      return { data, error };
    }
    const id = filterValue(qb.filters, 'id');
    if (id) {
      const { data, error } = await request(`/platform-admins/${id}`);
      return finishList(data, error, qb);
    }
    const { data, error } = await request('/platform-admins');
    return finishList(data, error, qb);
  },

  // ---- lecturer_profiles -----------------------------------------------------
  lecturer_profiles: async (qb) => {
    if (qb._op === 'insert') {
      // Self-provisioning is now handled atomically by /auth/signup — this
      // branch should be unreachable, kept only so a stray call fails soft.
      return { data: null, error: { message: 'lecturer_profiles is created via /auth/signup', status: 400 } };
    }
    if (qb._op === 'update') {
      const id = filterValue(qb.filters, 'id');
      const { data, error } = await request(`/lecturer-profiles/${id}`, { method: 'PATCH', body: qb._payload });
      return { data, error };
    }
    const id = filterValue(qb.filters, 'id');
    if (id && !('institution_id' in qb.filters)) {
      const { data, error } = await request(`/lecturer-profiles/${id}`);
      return finishList(data, error, qb);
    }
    const isNullFilter = filterValue(qb.filters, 'institution_id', 'is');
    const institutionParam = isNullFilter === null ? 'null' : filterValue(qb.filters, 'institution_id');
    const { data, error } = await request(`/lecturer-profiles${qs({ institution_id: institutionParam })}`);
    return finishList(data, error, qb);
  },

  // ---- students ---------------------------------------------------------
  students: async (qb) => {
    // The student login/signup flow and roster bulk-upsert use dedicated
    // helpers (see `api.students.*` below) instead of this generic path.
    if (qb._op === 'insert') {
      const rows = Array.isArray(qb._payload) ? qb._payload : [qb._payload];
      const { data, error } = await request('/students/bulk-insert', { method: 'POST', body: { students: rows } });
      return { data, error };
    }
    if (qb._op === 'upsert') {
      const rows = Array.isArray(qb._payload) ? qb._payload : [qb._payload];
      const { data, error } = await request('/students/bulk-upsert', { method: 'POST', body: { students: rows } });
      return { data, error };
    }
    if (qb._op === 'update') {
      const id = filterValue(qb.filters, 'id');
      const { data, error } = await request(`/students/${id}`, { method: 'PATCH', body: qb._payload, auth: false });
      return { data, error };
    }
    const id = filterValue(qb.filters, 'id');
    if (id) {
      const { data, error } = await request(`/students/${id}`, { auth: false });
      return finishList(data, error, qb);
    }
    // Unfiltered — platform-admin-only cross-tenant count/list (overview stats).
    const { data, error } = await request('/students');
    return finishList(data, error, qb);
  },

  // ---- cohorts ------------------------------------------------------------
  cohorts: async (qb) => {
    if (qb._op === 'insert') {
      const { data, error } = await request('/cohorts', { method: 'POST', body: firstRow(qb._payload) });
      return { data, error };
    }
    const institutionId = filterValue(qb.filters, 'institution_id');
    const { data, error } = await request(`/cohorts${qs({ institution_id: institutionId })}`, { auth: false });
    return finishList(data, error, qb);
  },

  // ---- issues ---------------------------------------------------------------
  issues: async (qb) => {
    if (qb._op === 'insert') {
      const { data, error } = await request('/issues', { method: 'POST', body: firstRow(qb._payload) });
      return { data, error };
    }
    if (qb._op === 'update') {
      const id = filterValue(qb.filters, 'id');
      const { data, error } = await request(`/issues/${id}`, { method: 'PATCH', body: qb._payload });
      return { data, error };
    }
    const institutionId = filterValue(qb.filters, 'institution_id');
    if (institutionId) {
      const { data, error } = await request(`/issues${qs({ institution_id: institutionId })}`);
      return finishList(data, error, qb);
    }
    const statusIn = filterValue(qb.filters, 'status', 'in');
    const statusEq = filterValue(qb.filters, 'status', 'eq');
    const statusParam = statusIn ? `in.${statusIn.join(',')}` : statusEq ? `eq.${statusEq}` : undefined;
    const { data, error } = await request(`/issues${qs({ status: statusParam })}`);
    return finishList(data, error, qb);
  },

  // ---- subscriptions / invoices (mounted under /billing) --------------------
  subscriptions: async (qb) => {
    if (qb._op === 'upsert' || qb._op === 'update') {
      const institutionId = filterValue(qb.filters, 'institution_id') ?? firstRow(qb._payload)?.institution_id;
      const { data, error } = await request(`/billing/subscriptions/${institutionId}`, {
        method: 'PUT',
        body: firstRow(qb._payload),
      });
      return { data, error };
    }
    const institutionId = filterValue(qb.filters, 'institution_id');
    const { data, error } = await request(`/billing/subscriptions${qs({ institution_id: institutionId })}`);
    return finishList(data, error, qb);
  },

  invoices: async (qb) => {
    if (qb._op === 'insert') {
      const { data, error } = await request('/billing/invoices', { method: 'POST', body: firstRow(qb._payload) });
      return { data, error };
    }
    const institutionId = filterValue(qb.filters, 'institution_id');
    const { data, error } = await request(`/billing/invoices${qs({ institution_id: institutionId })}`);
    return finishList(data, error, qb);
  },

  // ---- platform_settings / feature_flags (mounted under /settings) ---------
  platform_settings: async (qb) => {
    if (qb._op === 'update') {
      const { data, error } = await request('/settings/platform', { method: 'PUT', body: qb._payload });
      return { data, error };
    }
    const { data, error } = await request('/settings/platform', { auth: false });
    return finishList(data, error, qb);
  },

  feature_flags: async (qb) => {
    if (qb._op === 'update') {
      const key = filterValue(qb.filters, 'key');
      const { data, error } = await request(`/settings/feature-flags/${key}`, { method: 'PATCH', body: qb._payload });
      return { data, error };
    }
    const { data, error } = await request('/settings/feature-flags', { auth: false });
    return finishList(data, error, qb);
  },

  // ---- audit_log (read-only) -------------------------------------------------
  audit_log: async (qb) => {
    const { data, error } = await request(`/audit-log${qs({ limit: qb._limit ?? undefined })}`);
    return finishList(data, error, qb);
  },

  // ---- exams --------------------------------------------------------------
  exams: async (qb) => {
    if (qb._op === 'insert') {
      const { data, error } = await request('/exams', { method: 'POST', body: firstRow(qb._payload) });
      return { data, error };
    }
    if (qb._op === 'update') {
      const id = filterValue(qb.filters, 'id');
      const { data, error } = await request(`/exams/${id}`, { method: 'PATCH', body: qb._payload });
      return { data, error };
    }
    if (qb._op === 'delete') {
      const id = filterValue(qb.filters, 'id');
      const { error } = await request(`/exams/${id}`, { method: 'DELETE' });
      return { data: null, error };
    }
    const code = filterValue(qb.filters, 'enrollment_code');
    if (code) {
      const { data, error } = await request(`/exams/by-code/${code}`, { auth: false });
      return finishList(data, error, qb);
    }
    const id = filterValue(qb.filters, 'id');
    if (id) {
      const { data, error } = await request(`/exams/${id}`, { auth: false });
      return finishList(data, error, qb);
    }
    const institutionId = filterValue(qb.filters, 'institution_id');
    if (institutionId) {
      const { data, error } = await request(`/exams${qs({ institution_id: institutionId })}`);
      return finishList(data, error, qb);
    }
    const lecturerId = filterValue(qb.filters, 'lecturer_id');
    if (lecturerId) {
      const { data, error } = await request('/exams?mine=1');
      return finishList(data, error, qb);
    }
    // Platform-admin cross-tenant view (overview stats / monthly trend chart)
    // — anything left over with no id/institution/lecturer filter.
    const { data, error } = await request(
      `/exams${qs({
        all: 1,
        created_at_gte: filterValue(qb.filters, 'created_at', 'gte'),
        created_at_lt: filterValue(qb.filters, 'created_at', 'lt'),
      })}`
    );
    return finishList(data, error, qb);
  },

  // ---- questions -----------------------------------------------------------
  questions: async (qb) => {
    const examId = filterValue(qb.filters, 'exam_id');
    if (qb._op === 'insert') {
      const { data, error } = await request('/questions', { method: 'POST', body: firstRow(qb._payload) });
      return { data, error };
    }
    if (qb._op === 'delete') {
      // The frontend's "delete all then reinsert" pattern is now one atomic
      // call — see `api.questions.bulkReplace` below; a plain filtered
      // delete-all is intentionally not supported here.
      return { data: null, error: { message: 'Use api.questions.bulkReplace for bulk question saves', status: 400 } };
    }
    if (qb._op === 'update') {
      const id = filterValue(qb.filters, 'id');
      const { data, error } = await request(`/questions/${id}`, { method: 'PATCH', body: qb._payload });
      return { data, error };
    }
    const { data, error } = await request(`/questions${qs({ exam_id: examId })}`, { auth: false });
    return finishList(data, error, qb);
  },

  // ---- enrollments ---------------------------------------------------------
  enrollments: async (qb) => {
    if (qb._op === 'insert') {
      const { data, error } = await request('/enrollments', { method: 'POST', body: firstRow(qb._payload), auth: false });
      return { data, error };
    }
    if (qb._op === 'upsert') {
      const rows = Array.isArray(qb._payload) ? qb._payload : [qb._payload];
      const examId = rows[0]?.exam_id;
      const studentIds = rows.map((r: any) => r.student_id);
      const { data, error } = await request('/enrollments/bulk', { method: 'POST', body: { exam_id: examId, student_ids: studentIds } });
      return { data, error };
    }
    if (qb._op === 'delete') {
      const id = filterValue(qb.filters, 'id');
      const { error } = await request(`/enrollments/${id}`, { method: 'DELETE' });
      return { data: null, error };
    }
    const studentId = filterValue(qb.filters, 'student_id');
    const examId = filterValue(qb.filters, 'exam_id');
    const { data, error } = await request(`/enrollments${qs({ student_id: studentId, exam_id: examId })}`, { auth: false });
    return finishList(data, error, qb);
  },

  // ---- submissions -----------------------------------------------------------
  submissions: async (qb) => {
    if (qb._op === 'insert' || qb._op === 'upsert') {
      const { data, error } = await request('/submissions', { method: 'POST', body: firstRow(qb._payload), auth: false });
      return { data, error };
    }
    if (qb._op === 'update') {
      const id = filterValue(qb.filters, 'id');
      const { data, error } = await request(`/submissions/${id}`, { method: 'PATCH', body: qb._payload, auth: false });
      return { data, error };
    }
    if (qb._op === 'delete') {
      const id = filterValue(qb.filters, 'id');
      const { error } = await request(`/submissions/${id}`, { method: 'DELETE' });
      return { data: null, error };
    }
    const id = filterValue(qb.filters, 'id');
    if (id && (qb._single || qb._maybeSingle) && Object.keys(qb.filters).length === 1) {
      const { data, error } = await request(`/submissions/${id}`, { auth: false });
      return finishList(data, error, qb);
    }
    const examId = filterValue(qb.filters, 'exam_id');
    const studentId = filterValue(qb.filters, 'student_id');
    const { data, error } = await request(`/submissions${qs({ exam_id: examId, student_id: studentId })}`, { auth: false });
    return finishList(data, error, qb);
  },

  deleted_submissions: async (qb) => {
    if (qb._op === 'delete') {
      const id = filterValue(qb.filters, 'id');
      const { error } = await request(`/submissions/trash/${id}`, { method: 'DELETE' });
      return { data: null, error };
    }
    const examId = filterValue(qb.filters, 'exam_id');
    const { data, error } = await request(`/submissions/trash/list${qs({ exam_id: examId })}`);
    return finishList(data, error, qb);
  },

  // ---- violations -----------------------------------------------------------
  violations: async (qb) => {
    if (qb._op === 'insert') {
      // Sent as-is (array or single object) — the ExamRoom batches multiple
      // violations from one debounce window into a single array insert, and
      // the backend accepts either shape. Do not reduce to firstRow here.
      const { data, error } = await request('/violations', { method: 'POST', body: qb._payload, auth: false });
      return { data, error };
    }
    if (qb._op === 'delete') {
      const examId = filterValue(qb.filters, 'exam_id');
      const studentId = filterValue(qb.filters, 'student_id');
      const { error } = await request(`/violations${qs({ exam_id: examId, student_id: studentId })}`, { method: 'DELETE' });
      return { data: null, error };
    }
    const examId = filterValue(qb.filters, 'exam_id');
    const studentId = filterValue(qb.filters, 'student_id');
    if (qb._countOnly) {
      const { data, error } = await request(`/violations/count${qs({ exam_id: examId, student_id: studentId })}`, { auth: false });
      return { data: null, error, count: error ? undefined : (data as any)?.count };
    }
    const { data, error } = await request(`/violations${qs({ exam_id: examId })}`);
    return finishList(data, error, qb);
  },

  // ---- subjects ------------------------------------------------------------
  subjects: async (qb) => {
    if (qb._op === 'insert') {
      const { data, error } = await request('/subjects', { method: 'POST', body: firstRow(qb._payload) });
      return { data, error };
    }
    if (qb._op === 'delete') {
      const id = filterValue(qb.filters, 'id');
      const { error } = await request(`/subjects/${id}`, { method: 'DELETE' });
      return { data: null, error };
    }
    const { data, error } = await request('/subjects');
    return finishList(data, error, qb);
  },

  // ---- exam_lecturers (co-markers) -------------------------------------------
  exam_lecturers: async (qb) => {
    if (qb._op === 'insert') {
      const { data, error } = await request('/co-markers', { method: 'POST', body: firstRow(qb._payload) });
      return { data, error };
    }
    return { data: null, error: { message: 'exam_lecturers has no list endpoint (write-only)', status: 400 } };
  },
};

function firstRow(payload: any) {
  return Array.isArray(payload) ? payload[0] : payload;
}

// ---------------------------------------------------------------------------
// auth namespace
// ---------------------------------------------------------------------------

type AuthChangeCallback = (event: string, session: { user: any } | null) => void;
const authListeners = new Set<AuthChangeCallback>();

function notifyAuthChange(event: string, user: any) {
  for (const cb of authListeners) cb(event, user ? { user } : null);
}

const auth = {
  async signInWithPassword({ email, password }: { email: string; password: string }) {
    const { data, error } = await request<{ user: any; token: string }>('/auth/signin', {
      method: 'POST',
      body: { email, password },
      auth: false,
    });
    if (error || !data) return { data: { user: null, session: null }, error };
    localStorage.setItem(TOKEN_KEY, data.token);
    notifyAuthChange('SIGNED_IN', data.user);
    return { data: { user: data.user, session: { access_token: data.token, user: data.user } }, error: null };
  },

  async signUp({ email, password }: { email: string; password: string }) {
    const { data, error } = await request<{ user: any; token: string }>('/auth/signup', {
      method: 'POST',
      body: { email, password },
      auth: false,
    });
    if (error || !data) return { data: { user: null, session: null }, error };
    localStorage.setItem(TOKEN_KEY, data.token);
    notifyAuthChange('SIGNED_IN', data.user);
    return { data: { user: data.user, session: { access_token: data.token, user: data.user } }, error: null };
  },

  async signOut() {
    localStorage.removeItem(TOKEN_KEY);
    notifyAuthChange('SIGNED_OUT', null);
    return { error: null };
  },

  async getUser() {
    if (!getToken()) return { data: { user: null }, error: null };
    const { data, error } = await request<{ user: any }>('/auth/user');
    if (error) return { data: { user: null }, error };
    return { data: { user: data?.user ?? null }, error: null };
  },

  async getSession() {
    const token = getToken();
    if (!token) return { data: { session: null }, error: null };
    const { data } = await request<{ user: any }>('/auth/user');
    return { data: { session: data?.user ? { access_token: token, user: data.user } : null }, error: null };
  },

  onAuthStateChange(callback: AuthChangeCallback) {
    authListeners.add(callback);
    return { data: { subscription: { unsubscribe: () => authListeners.delete(callback) } } };
  },

  async resetPasswordForEmail(email: string, opts?: { redirectTo?: string }) {
    const { error } = await request('/auth/reset-password-request', {
      method: 'POST',
      body: { email, appUrl: opts?.redirectTo },
      auth: false,
    });
    return { data: {}, error };
  },

  async updateUser({ password }: { password: string }) {
    const { error } = await request('/auth/password', { method: 'PUT', body: { password } });
    return { data: { user: null }, error };
  },

  async confirmPasswordReset({ token, newPassword }: { token: string; newPassword: string }) {
    const { error } = await request('/auth/reset-password-confirm', {
      method: 'POST',
      body: { token, newPassword },
      auth: false,
    });
    return { data: {}, error };
  },
};

// ---------------------------------------------------------------------------
// rpc — `log_audit_event` is now written automatically, server-side, by
// whichever mutating route the frontend already called (see api/lib/
// auditLog.js). The explicit frontend calls to `supabase.rpc('log_audit_event',
// ...)` sprinkled through the admin/institution-admin apps become no-ops here
// to avoid double-logging the same event — nothing else calls .rpc().
// ---------------------------------------------------------------------------

async function rpc(name: string, _args?: Record<string, unknown>) {
  if (name === 'log_audit_event') return { data: null, error: null };
  return { data: null, error: { message: `Unknown RPC "${name}"`, status: 400 } };
}

// ---------------------------------------------------------------------------
// functions.invoke — AI grading / report generation
// ---------------------------------------------------------------------------

const functions = {
  async invoke(name: string, opts?: { body?: any }) {
    const body = opts?.body ?? {};
    if (name === 'grade-submission') {
      // Both the bulk and single-question calls carry `submissionId` — check
      // for `questionId` first to tell them apart.
      const path = 'questionId' in body ? '/ai/grade-submission/question' : '/ai/grade-submission';
      return request(path, { method: 'POST', body });
    }
    if (name === 'generate-focus-report') {
      return request('/ai/focus-report', { method: 'POST', body, auth: false });
    }
    if (name === 'generate-class-focus-report') {
      return request('/ai/class-focus-report', { method: 'POST', body });
    }
    return { data: null, error: { message: `Unknown function "${name}"`, status: 400 } };
  },
};

// ---------------------------------------------------------------------------
// Escape-hatch helpers for the handful of flows that don't map cleanly onto
// the generic `.from()` shape (see file header).
// ---------------------------------------------------------------------------

const students = {
  async loginOrCreate(body: { student_number: string; full_name?: string; institution_id?: string }) {
    return request('/students/login-or-create', { method: 'POST', body, auth: false });
  },
};

const questions = {
  async bulkReplace(examId: string, rows: any[]) {
    return request('/questions/bulk', { method: 'PUT', body: { exam_id: examId, questions: rows } });
  },
};

const exams = {
  async regenerateCode(examId: string) {
    return request(`/exams/${examId}/regenerate-code`, { method: 'POST' });
  },
};

const submissions = {
  async restore(id: string) {
    return request(`/submissions/${id}/restore`, { method: 'POST' });
  },
};

// The cross-tenant AdminUsers directory spans 3 tables (lecturer_profiles,
// students, institution_admins), each with different self-service vs.
// admin-only write rules — `students` in particular has no admin-authorized
// `active` field on its own public endpoint (that field is intentionally
// student-CRUD-only there), so suspend/reactivate goes through this
// dedicated, platform-admin-gated dispatcher instead of the generic `.from()`
// path for any of the three roles.
const users = {
  async setActive(role: 'lecturer' | 'student' | 'institution_admin', id: string, active: boolean) {
    return request(`/users/${role}/${id}`, { method: 'PATCH', body: { active } });
  },
};

// ---------------------------------------------------------------------------

export const supabase = {
  from<T = any>(table: string) {
    return new QueryBuilder<T>(table);
  },
  auth,
  rpc,
  functions,
  // Non-Supabase-shaped escape hatches, used only by the hand-touched call
  // sites documented in the migration plan.
  students,
  questions,
  exams,
  submissions,
  users,
};
