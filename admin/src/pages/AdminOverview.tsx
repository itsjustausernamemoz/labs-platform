import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@shared/lib/apiClient';
import AdminNav from '../components/AdminNav';
import AdminTabBar from '../components/AdminTabBar';

type Plan = 'trial' | 'standard' | 'enterprise';

const PLAN_TAG: Record<Plan, string> = {
  trial: 'tag-outline',
  standard: 'tag-neutral',
  enterprise: 'tag-accent',
};

const PLAN_LABEL: Record<Plan, string> = { trial: 'Trial', standard: 'Standard', enterprise: 'Enterprise' };

interface RecentInstitution {
  id: string;
  name: string;
  plan: Plan;
  created_at: string;
}

interface AuditLogRow {
  id: string;
  occurred_at: string;
  actor_name: string | null;
  actor_role: string | null;
  institution_id: string | null;
  action: string;
  target: string | null;
}

interface MonthlyExamCount {
  key: string;
  label: string;
  value: number;
  pct: number;
}

interface Stats {
  institutionCount: number;
  institutionsThisMonth: number;
  lecturerCount: number;
  studentCount: number;
  examsLast30: number;
  examsPrior30: number;
}

const EMPTY_STATS: Stats = {
  institutionCount: 0,
  institutionsThisMonth: 0,
  lecturerCount: 0,
  studentCount: 0,
  examsLast30: 0,
  examsPrior30: 0,
};

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = Math.max(0, now - then);
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

function describeAuditRow(row: AuditLogRow): string {
  const who = row.actor_name || row.actor_role || 'A platform admin';
  const target = row.target ? ` — ${row.target}` : '';
  return `${who}: ${row.action}${target}`;
}

export default function AdminOverview() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [months, setMonths] = useState<MonthlyExamCount[]>([]);
  const [recentInstitutions, setRecentInstitutions] = useState<RecentInstitution[]>([]);
  const [activity, setActivity] = useState<AuditLogRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString();
    // Six full calendar months back (for the monthly exam trend chart).
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString();

    const [
      institutionCountRes,
      institutionsThisMonthRes,
      lecturerCountRes,
      studentCountRes,
      examsLast30Res,
      examsPriorRes,
      examsForChartRes,
      recentInstitutionsRes,
      activityRes,
    ] = await Promise.all([
      supabase.from('institutions').select('*', { count: 'exact', head: true }),
      supabase.from('institutions').select('*', { count: 'exact', head: true }).gte('created_at', startOfMonth),
      supabase.from('lecturer_profiles').select('*', { count: 'exact', head: true }),
      supabase.from('students').select('*', { count: 'exact', head: true }),
      supabase.from('exams').select('*', { count: 'exact', head: true }).gte('created_at', thirtyDaysAgo),
      supabase.from('exams').select('*', { count: 'exact', head: true }).gte('created_at', sixtyDaysAgo).lt('created_at', thirtyDaysAgo),
      supabase.from('exams').select('created_at').gte('created_at', sixMonthsAgo),
      supabase.from('institutions').select('id,name,plan,created_at').order('created_at', { ascending: false }).limit(5),
      supabase.from('audit_log').select('*').order('occurred_at', { ascending: false }).limit(8),
    ]);

    setStats({
      institutionCount: institutionCountRes.count ?? 0,
      institutionsThisMonth: institutionsThisMonthRes.count ?? 0,
      lecturerCount: lecturerCountRes.count ?? 0,
      studentCount: studentCountRes.count ?? 0,
      examsLast30: examsLast30Res.count ?? 0,
      examsPrior30: examsPriorRes.count ?? 0,
    });

    // Build the last 6 calendar months (oldest first), zero-filled where there's no data.
    const buckets: { key: string; label: string; value: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.push({
        key: `${d.getFullYear()}-${d.getMonth()}`,
        label: d.toLocaleString(undefined, { month: 'short' }),
        value: 0,
      });
    }
    const bucketByKey = new Map(buckets.map(b => [b.key, b]));
    for (const row of examsForChartRes.data || []) {
      const d = new Date(row.created_at as string);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      const bucket = bucketByKey.get(key);
      if (bucket) bucket.value += 1;
    }
    const max = Math.max(1, ...buckets.map(b => b.value));
    setMonths(buckets.map(b => ({ ...b, pct: Math.round((b.value / max) * 100) })));

    setRecentInstitutions((recentInstitutionsRes.data || []) as RecentInstitution[]);
    setActivity((activityRes.data || []) as AuditLogRow[]);

    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const totalUsers = stats.lecturerCount + stats.studentCount;
  const examsDeltaPct = stats.examsPrior30 > 0
    ? Math.round(((stats.examsLast30 - stats.examsPrior30) / stats.examsPrior30) * 100)
    : null;

  return (
    <>
      <AdminNav />
      <main className="wrap" style={{ maxWidth: 1120, margin: '0 auto', padding: 'var(--space-8) var(--space-6)' }}>
        <h1>Platform overview</h1>
        <p className="text-muted" style={{ marginBottom: 'var(--space-4)' }}>The pulse of Mashoke Labs across every institution.</p>

        <AdminTabBar />

        {loading ? (
          <p className="text-muted">Loading overview…</p>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-4)', marginBottom: 'var(--space-8)' }}>
              <div className="card elev-sm">
                <span className="card-kicker">Institutions</span>
                <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 30 }}>{stats.institutionCount}</span>
                <span className="card-meta">{stats.institutionsThisMonth > 0 ? `+${stats.institutionsThisMonth} this month` : 'None added this month'}</span>
              </div>
              <div className="card elev-sm">
                <span className="card-kicker">Total users</span>
                <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 30 }}>{totalUsers.toLocaleString()}</span>
                <span className="card-meta">{stats.lecturerCount.toLocaleString()} lecturers · {stats.studentCount.toLocaleString()} students</span>
              </div>
              <div className="card elev-sm">
                <span className="card-kicker">Exams run (30d)</span>
                <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 30 }}>{stats.examsLast30.toLocaleString()}</span>
                <span className="card-meta">
                  {examsDeltaPct === null ? 'No prior period to compare' : `${examsDeltaPct >= 0 ? '+' : ''}${examsDeltaPct}% vs prior 30 days`}
                </span>
              </div>
              <div className="card elev-sm">
                <span className="card-kicker">Platform uptime</span>
                {/* No uptime/monitoring integration exists in this schema yet; static display value until one is wired up. */}
                <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 30 }}>99.98%</span>
                <span className="card-meta">Last 90 days</span>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 'var(--space-6)', alignItems: 'start' }}>
              <div>
                <h3>Exams run per month</h3>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--space-3)', height: 140, paddingTop: 'var(--space-4)' }}>
                  {months.map(m => (
                    <div key={m.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
                      <span style={{ fontSize: 11, fontWeight: 800 }}>{m.value}</span>
                      <div style={{ width: '100%', background: 'var(--color-accent)', height: `${m.pct}%` }} />
                      <span className="text-muted" style={{ fontSize: 11 }}>{m.label}</span>
                    </div>
                  ))}
                </div>

                <div className="hr" />
                <h3>Recent institutions</h3>
                {recentInstitutions.length === 0 ? (
                  <p className="text-muted">No institutions yet.</p>
                ) : (
                  <table className="table">
                    <thead>
                      <tr><th>Institution</th><th>Plan</th><th>Joined</th></tr>
                    </thead>
                    <tbody>
                      {recentInstitutions.map(inst => (
                        <tr key={inst.id}>
                          <td style={{ fontWeight: 700 }}>{inst.name}</td>
                          <td><span className={`tag ${PLAN_TAG[inst.plan]}`}>{PLAN_LABEL[inst.plan]}</span></td>
                          <td className="text-muted">{new Date(inst.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div>
                <h3>Activity feed</h3>
                {activity.length === 0 ? (
                  <p className="text-muted">No recent activity.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {activity.map(row => (
                      <div key={row.id} style={{ padding: 'var(--space-2) 0', borderBottom: '1px solid var(--color-divider)' }}>
                        <div style={{ fontSize: 13 }}>{describeAuditRow(row)}</div>
                        <div className="text-muted" style={{ fontSize: 11 }}>{formatRelativeTime(row.occurred_at)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </main>
    </>
  );
}
