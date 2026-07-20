import { useCallback, useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { supabase } from '@shared/lib/apiClient';
import { useNotification } from '@shared/components/NotificationProvider';

type Category = 'technical' | 'grading' | 'billing' | 'account';
type Status = 'open' | 'in_progress' | 'escalated' | 'resolved';

interface IssueRow {
  id: string;
  title: string;
  category: Category;
  status: Status;
  reporter_name: string;
  created_at: string;
}

interface NewIssueDraft {
  title: string;
  category: Category;
  details: string;
}

const CATEGORY_OPTIONS: { value: Category; label: string }[] = [
  { value: 'technical', label: 'Technical' },
  { value: 'grading', label: 'Grading' },
  { value: 'account', label: 'Account' },
  { value: 'billing', label: 'Billing' },
];

const CATEGORY_LABEL: Record<Category, string> = {
  technical: 'Technical',
  grading: 'Grading',
  billing: 'Billing',
  account: 'Account',
};

const STATUS_TAG: Record<Status, string> = {
  open: 'tag-accent',
  in_progress: 'tag-accent',
  escalated: 'tag-outline',
  resolved: 'tag-neutral',
};

const STATUS_LABEL: Record<Status, string> = {
  open: 'Open',
  in_progress: 'In progress',
  escalated: 'Escalated',
  resolved: 'Resolved',
};

const EMPTY_DRAFT: NewIssueDraft = { title: '', category: 'technical', details: '' };

interface IssuesTabProps {
  institutionId: string;
  admin: { full_name: string };
  onChange: () => void;
  // Passed by the dashboard shell so the Billing tab can jump here; this tab
  // doesn't need to act on it itself.
  onRequestSeatIncrease?: () => void;
}

export default function IssuesTab({ institutionId, admin, onChange }: IssuesTabProps) {
  const { showToast } = useNotification();
  const [issues, setIssues] = useState<IssueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewIssue, setShowNewIssue] = useState(false);
  const [draft, setDraft] = useState<NewIssueDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('issues')
      .select('id, title, category, status, reporter_name, created_at')
      .eq('institution_id', institutionId)
      .order('created_at', { ascending: false })
      .returns<IssueRow[]>();
    if (error) {
      showToast(error.message, 'error');
      setIssues([]);
      setLoading(false);
      return;
    }
    setIssues(data || []);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [institutionId]);

  useEffect(() => { load(); }, [load]);

  const logEvent = async (action: string, target: string) => {
    await supabase.rpc('log_audit_event', { p_action: action, p_target: target, p_institution_id: institutionId });
  };

  const closeNewIssue = () => {
    setShowNewIssue(false);
    setDraft(EMPTY_DRAFT);
  };

  const submitNewIssue = async () => {
    if (!draft.title.trim()) {
      showToast('Title is required.', 'error');
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('issues').insert({
      institution_id: institutionId,
      title: draft.title.trim(),
      category: draft.category,
      body: draft.details,
      reporter_name: admin.full_name,
      reporter_role: 'institution_admin',
      status: 'open',
    });
    setSaving(false);
    if (error) {
      showToast(error.message, 'error');
      return;
    }
    await logEvent('Logged issue', draft.title.trim());
    showToast('Issue logged.', 'success');
    closeNewIssue();
    load();
    onChange();
  };

  const resolveIssue = async (issue: IssueRow) => {
    const { error } = await supabase
      .from('issues')
      .update({ status: 'resolved', resolved_at: new Date().toISOString() })
      .eq('id', issue.id);
    if (error) { showToast(error.message, 'error'); return; }
    await logEvent('Resolved issue', issue.title);
    showToast('Issue marked resolved.', 'success');
    load();
    onChange();
  };

  const escalateIssue = async (issue: IssueRow) => {
    const { error } = await supabase
      .from('issues')
      .update({ status: 'escalated' })
      .eq('id', issue.id);
    if (error) { showToast(error.message, 'error'); return; }
    await logEvent('Escalated issue to Mashoke Tech', issue.title);
    showToast('Issue escalated to Mashoke Tech.', 'success');
    load();
    onChange();
  };

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
        <h3 style={{ margin: 0 }}>Issues</h3>
        <button className="btn btn-primary" onClick={() => setShowNewIssue(true)}>
          <Plus size={15} /> Log issue
        </button>
      </div>

      {loading ? (
        <p className="text-muted">Loading issues…</p>
      ) : issues.length === 0 ? (
        <p className="text-muted">No issues logged yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr><th>Issue</th><th>Reported by</th><th>Category</th><th>Status</th><th>Date</th><th></th></tr>
          </thead>
          <tbody>
            {issues.map(issue => (
              <tr key={issue.id}>
                <td style={{ fontWeight: 700, maxWidth: 280 }}>{issue.title}</td>
                <td className="text-muted">{issue.reporter_name}</td>
                <td><span className="tag tag-neutral">{CATEGORY_LABEL[issue.category]}</span></td>
                <td><span className={`tag ${STATUS_TAG[issue.status]}`}>{STATUS_LABEL[issue.status]}</span></td>
                <td className="text-muted">{new Date(issue.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {issue.status === 'open' && (
                    <>
                      <button className="btn btn-ghost" onClick={() => resolveIssue(issue)}>Resolve</button>
                      <button className="btn btn-ghost" style={{ color: 'var(--color-accent-700)' }} onClick={() => escalateIssue(issue)}>Escalate</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showNewIssue && (
        <div className="dialog-backdrop" onClick={closeNewIssue}>
          <div className="dialog" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div className="dialog-title">Log an issue</div>
              <button className="btn btn-icon" onClick={closeNewIssue}><X size={16} /></button>
            </div>
            <div className="field">
              <label>Title</label>
              <input
                className="input"
                placeholder="e.g. Student can't join exam with valid code"
                value={draft.title}
                onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
              />
            </div>
            <div className="field">
              <label>Category</label>
              <select
                className="input"
                value={draft.category}
                onChange={e => setDraft(d => ({ ...d, category: e.target.value as Category }))}
              >
                {CATEGORY_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Details</label>
              <textarea
                className="input"
                rows={3}
                placeholder="What's happening, and who's affected?"
                value={draft.details}
                onChange={e => setDraft(d => ({ ...d, details: e.target.value }))}
              />
            </div>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={closeNewIssue}>Cancel</button>
              <button className="btn btn-primary" disabled={saving} onClick={submitNewIssue}>
                {saving ? 'Logging…' : 'Log issue'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
