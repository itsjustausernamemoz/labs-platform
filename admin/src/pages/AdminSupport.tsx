import { useEffect, useState, useCallback } from 'react';
import { Eye, CheckCircle2, X } from 'lucide-react';
import { supabase } from '@shared/lib/apiClient';
import { useNotification } from '@shared/components/NotificationProvider';
import AdminNav from '../components/AdminNav';
import AdminTabBar from '../components/AdminTabBar';

type Category = 'technical' | 'grading' | 'billing' | 'account';
type Status = 'escalated' | 'resolved';

interface Issue {
  id: string;
  institution_id: string;
  institution_name: string;
  title: string;
  category: Category;
  status: Status;
  reporter_name: string;
  reporter_role: string;
  body: string;
  created_at: string;
  resolved_at: string | null;
}

interface IssueRow {
  id: string;
  institution_id: string;
  title: string;
  category: Category;
  status: Status;
  reporter_name: string;
  reporter_role: string;
  body: string;
  created_at: string;
  resolved_at: string | null;
  institutions: { name: string } | null;
}

const CATEGORY_LABEL: Record<Category, string> = {
  technical: 'Technical',
  grading: 'Grading',
  billing: 'Billing',
  account: 'Account',
};

const STATUS_TAG: Record<Status, string> = {
  escalated: 'tag-accent',
  resolved: 'tag-neutral',
};

const STATUS_LABEL: Record<Status, string> = {
  escalated: 'Escalated',
  resolved: 'Resolved',
};

export default function AdminSupport() {
  const { showToast, showConfirm } = useNotification();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailsTarget, setDetailsTarget] = useState<Issue | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // Only issues that institution admins have escalated to Mashoke Tech staff
    // (or were escalated and have since been resolved) belong in this queue —
    // plain open/in_progress issues are still the institution's own business.
    const { data, error } = await supabase
      .from('issues')
      .select('*, institutions(name)')
      .in('status', ['escalated', 'resolved'])
      .order('created_at', { ascending: false })
      .returns<IssueRow[]>();
    if (error) {
      showToast(error.message, 'error');
      setIssues([]);
      setLoading(false);
      return;
    }
    setIssues(
      (data || []).map((row) => ({
        id: row.id,
        institution_id: row.institution_id,
        institution_name: row.institutions?.name ?? 'Unknown institution',
        title: row.title,
        category: row.category,
        status: row.status,
        reporter_name: row.reporter_name,
        reporter_role: row.reporter_role,
        body: row.body,
        created_at: row.created_at,
        resolved_at: row.resolved_at,
      }))
    );
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  const logEvent = async (action: string, target: string, institutionId?: string) => {
    await supabase.rpc('log_audit_event', { p_action: action, p_target: target, p_institution_id: institutionId ?? null });
  };

  const resolveIssue = (issue: Issue) => {
    showConfirm({
      title: 'Mark issue resolved',
      message: `Mark "${issue.title}" from ${issue.institution_name} as resolved?`,
      confirmText: 'Mark resolved',
      onConfirm: async () => {
        const { error } = await supabase
          .from('issues')
          .update({ status: 'resolved', resolved_at: new Date().toISOString() })
          .eq('id', issue.id);
        if (error) { showToast(error.message, 'error'); return; }
        await logEvent('Resolved support issue', `${issue.title} — ${issue.institution_name}`, issue.institution_id);
        showToast('Issue marked resolved.', 'success');
        setDetailsTarget(null);
        load();
      },
    });
  };

  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
  const stats = {
    escalated: issues.filter(i => i.status === 'escalated').length,
    resolved30d: issues.filter(i => i.status === 'resolved' && i.resolved_at && new Date(i.resolved_at).getTime() >= thirtyDaysAgo).length,
    // No first-response timestamp is tracked on issues yet, so this is a static
    // placeholder rather than a real SLA metric (same approach as the platform
    // uptime figure on the Overview page).
    avgResponse: '4.2h',
  };

  return (
    <>
      <AdminNav />
      <main className="wrap" style={{ maxWidth: 1120, margin: '0 auto', padding: 'var(--space-8) var(--space-6)' }}>
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <h1>Support</h1>
          <p className="text-muted">Issues escalated by institution admins that need Mashoke Tech attention.</p>
        </div>

        <AdminTabBar />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-4)', marginBottom: 'var(--space-6)' }}>
          <div className="card elev-sm">
            <span className="card-kicker">Escalated</span>
            <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 30, color: 'var(--color-accent-700)' }}>{stats.escalated}</span>
          </div>
          <div className="card elev-sm">
            <span className="card-kicker">Resolved (30d)</span>
            <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 30 }}>{stats.resolved30d}</span>
          </div>
          <div className="card elev-sm">
            <span className="card-kicker">Avg. response</span>
            <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 30 }}>{stats.avgResponse}</span>
          </div>
        </div>

        {loading ? (
          <p className="text-muted">Loading support queue…</p>
        ) : issues.length === 0 ? (
          <p className="text-muted">No escalated issues. Everything institutions have raised is being handled locally.</p>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Institution</th><th>Issue</th><th>Category</th><th>Status</th><th>Date</th><th></th></tr>
            </thead>
            <tbody>
              {issues.map(issue => (
                <tr key={issue.id}>
                  <td style={{ fontWeight: 700 }}>{issue.institution_name}</td>
                  <td style={{ maxWidth: 320 }}>{issue.title}</td>
                  <td><span className="tag tag-neutral">{CATEGORY_LABEL[issue.category]}</span></td>
                  <td><span className={`tag ${STATUS_TAG[issue.status]}`}>{STATUS_LABEL[issue.status]}</span></td>
                  <td className="text-muted">{new Date(issue.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn btn-ghost" style={{ padding: 4 }} title="View details" onClick={() => setDetailsTarget(issue)}><Eye size={15} /></button>
                    <button
                      className="btn btn-ghost"
                      style={{ padding: 4, color: 'var(--color-accent-2-700)' }}
                      title="Mark resolved"
                      disabled={issue.status === 'resolved'}
                      onClick={() => resolveIssue(issue)}
                    >
                      <CheckCircle2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>

      {detailsTarget && (
        <div className="dialog-backdrop" onClick={() => setDetailsTarget(null)}>
          <div className="dialog" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div className="dialog-title">{detailsTarget.title}</div>
              <button className="btn btn-icon" onClick={() => setDetailsTarget(null)}><X size={16} /></button>
            </div>
            <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <div><span className="text-muted">Institution:</span> {detailsTarget.institution_name}</div>
              <div><span className="text-muted">Category:</span> <span className="tag tag-neutral">{CATEGORY_LABEL[detailsTarget.category]}</span></div>
              <div><span className="text-muted">Status:</span> <span className={`tag ${STATUS_TAG[detailsTarget.status]}`}>{STATUS_LABEL[detailsTarget.status]}</span></div>
              <div><span className="text-muted">Reported by:</span> {detailsTarget.reporter_name} ({detailsTarget.reporter_role})</div>
              <div><span className="text-muted">Escalated:</span> {new Date(detailsTarget.created_at).toLocaleString()}</div>
              {detailsTarget.resolved_at && (
                <div><span className="text-muted">Resolved:</span> {new Date(detailsTarget.resolved_at).toLocaleString()}</div>
              )}
              <div className="hr" />
              <div style={{ whiteSpace: 'pre-wrap' }}>{detailsTarget.body}</div>
            </div>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={() => setDetailsTarget(null)}>Close</button>
              {detailsTarget.status !== 'resolved' && (
                <button className="btn btn-primary" onClick={() => resolveIssue(detailsTarget)}>Mark resolved</button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
