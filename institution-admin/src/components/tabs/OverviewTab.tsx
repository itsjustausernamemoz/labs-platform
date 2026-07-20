import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@shared/lib/apiClient';

interface OverviewStats {
  activeExams: number;
  submissions7d: number;
  avgScore: number;
  pendingGrading: number;
}

interface ActivityRow {
  id: string;
  action: string;
  target: string;
  occurred_at: string;
}

interface SubmissionRow {
  score: number | null;
  total_marks: number | null;
  graded: boolean;
  submitted_at: string;
}

const EMPTY_STATS: OverviewStats = {
  activeExams: 0,
  submissions7d: 0,
  avgScore: 0,
  pendingGrading: 0,
};

export default function OverviewTab({ institutionId }: { institutionId: string }) {
  const [stats, setStats] = useState<OverviewStats>(EMPTY_STATS);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [{ count: activeExams }, { data: submissions }, { data: activityRows }] = await Promise.all([
      supabase
        .from('exams')
        .select('id', { count: 'exact', head: true })
        .eq('institution_id', institutionId)
        .eq('is_active', true),
      supabase
        .from('submissions')
        .select('score, total_marks, graded, submitted_at, exams!inner(institution_id)')
        .eq('exams.institution_id', institutionId),
      supabase
        .from('audit_log')
        .select('id, action, target, occurred_at')
        .eq('institution_id', institutionId)
        .order('occurred_at', { ascending: false })
        .limit(8),
    ]);

    const subs = (submissions || []) as SubmissionRow[];
    const submissions7d = subs.filter(s => s.submitted_at >= sevenDaysAgo).length;
    const graded = subs.filter(s => s.graded && s.total_marks && s.total_marks > 0);
    const avgScore = graded.length
      ? Math.round((graded.reduce((sum, s) => sum + ((s.score ?? 0) / (s.total_marks as number)) * 100, 0) / graded.length) * 10) / 10
      : 0;
    const pendingGrading = subs.filter(s => !s.graded).length;

    setStats({
      activeExams: activeExams ?? 0,
      submissions7d,
      avgScore,
      pendingGrading,
    });
    setActivity((activityRows || []) as ActivityRow[]);
    setLoading(false);
  }, [institutionId]);

  useEffect(() => { load(); }, [load]);

  const formatTime = (iso: string) => {
    const date = new Date(iso);
    const diffMs = Date.now() - date.getTime();
    const diffMin = Math.round(diffMs / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.round(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.round(diffHr / 24);
    if (diffDay < 7) return `${diffDay}d ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  if (loading) {
    return <p className="text-muted">Loading overview…</p>;
  }

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-6)' }}>
        <div className="card elev-sm">
          <span className="card-kicker">Active exams</span>
          <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 26 }}>{stats.activeExams}</span>
        </div>
        <div className="card elev-sm">
          <span className="card-kicker">Submissions (7d)</span>
          <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 26 }}>{stats.submissions7d}</span>
        </div>
        <div className="card elev-sm">
          <span className="card-kicker">Avg. score</span>
          <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 26 }}>{stats.avgScore}%</span>
        </div>
        <div className="card elev-sm">
          <span className="card-kicker">Pending grading</span>
          <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 26, color: 'var(--color-accent-700)' }}>{stats.pendingGrading}</span>
        </div>
      </div>

      <h3>Recent activity</h3>
      {activity.length === 0 ? (
        <p className="text-muted">No recent activity.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {activity.map(a => (
            <div key={a.id} style={{ padding: 'var(--space-2) 0', borderBottom: '1px solid var(--color-divider)' }}>
              <div style={{ fontSize: 13 }}>{a.action}{a.target ? `: ${a.target}` : ''}</div>
              <div className="text-muted" style={{ fontSize: 11 }}>{formatTime(a.occurred_at)}</div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
