import { useEffect, useState, useCallback } from 'react';
import { Plus, X } from 'lucide-react';
import { supabase } from '@shared/lib/apiClient';
import { useNotification } from '@shared/components/NotificationProvider';

interface Lecturer {
  id: string;
  full_name: string;
  email: string;
  active: boolean;
  exam_count: number;
}

interface UnassignedLecturer {
  id: string;
  full_name: string;
  email: string;
}

interface LecturersTabProps {
  institutionId: string;
  onChange: () => void;
}

export default function LecturersTab({ institutionId, onChange }: LecturersTabProps) {
  const { showToast } = useNotification();
  const [lecturers, setLecturers] = useState<Lecturer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [unassigned, setUnassigned] = useState<UnassignedLecturer[]>([]);
  const [unassignedLoading, setUnassignedLoading] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: lecturerRows }, { data: examRows }] = await Promise.all([
      supabase
        .from('lecturer_profiles')
        .select('id, full_name, email, active')
        .eq('institution_id', institutionId)
        .order('full_name'),
      supabase
        .from('exams')
        .select('lecturer_id, is_active')
        .eq('institution_id', institutionId),
    ]);

    const activeExamCounts = new Map<string, number>();
    for (const exam of examRows || []) {
      if (exam.is_active && exam.lecturer_id) {
        activeExamCounts.set(exam.lecturer_id, (activeExamCounts.get(exam.lecturer_id) ?? 0) + 1);
      }
    }

    setLecturers(
      (lecturerRows || []).map((l: any) => ({
        id: l.id,
        full_name: l.full_name,
        email: l.email,
        active: l.active,
        exam_count: activeExamCounts.get(l.id) ?? 0,
      }))
    );
    setLoading(false);
  }, [institutionId]);

  useEffect(() => { load(); }, [load]);

  const logEvent = async (action: string, target: string) => {
    await supabase.rpc('log_audit_event', { p_action: action, p_target: target, p_institution_id: institutionId });
  };

  const openAdd = async () => {
    setSelectedId('');
    setShowAdd(true);
    setUnassignedLoading(true);
    const { data, error } = await supabase
      .from('lecturer_profiles')
      .select('id, full_name, email')
      .is('institution_id', null)
      .order('full_name');
    if (error) {
      showToast(error.message, 'error');
    } else {
      setUnassigned(data || []);
    }
    setUnassignedLoading(false);
  };

  const closeAdd = () => setShowAdd(false);

  const handleAdd = async () => {
    if (!selectedId) return;
    const lecturer = unassigned.find(l => l.id === selectedId);
    if (!lecturer) return;
    setSaving(true);
    const { error } = await supabase
      .from('lecturer_profiles')
      .update({ institution_id: institutionId })
      .eq('id', selectedId);
    setSaving(false);
    if (error) {
      showToast(error.message, 'error');
      return;
    }
    await logEvent('Attached lecturer to institution', lecturer.full_name);
    showToast(`${lecturer.full_name} added.`, 'success');
    setShowAdd(false);
    load();
    onChange();
  };

  const toggleActive = async (lecturer: Lecturer) => {
    const nextActive = !lecturer.active;
    const { error } = await supabase
      .from('lecturer_profiles')
      .update({ active: nextActive })
      .eq('id', lecturer.id);
    if (error) {
      showToast(error.message, 'error');
      return;
    }
    await logEvent(nextActive ? 'Reactivated lecturer' : 'Suspended lecturer', lecturer.full_name);
    showToast(`${lecturer.full_name} ${nextActive ? 'reactivated' : 'suspended'}.`, 'success');
    load();
    onChange();
  };

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
        <h3 style={{ margin: 0 }}>Lecturers</h3>
        <button className="btn btn-primary" onClick={openAdd}>
          <Plus size={15} /> Add lecturer
        </button>
      </div>

      {loading ? (
        <p className="text-muted">Loading lecturers…</p>
      ) : lecturers.length === 0 ? (
        <p className="text-muted">No lecturers yet. Add one to get started.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Active exams</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lecturers.map(lecturer => (
              <tr key={lecturer.id}>
                <td style={{ fontWeight: 700 }}>{lecturer.full_name}</td>
                <td className="text-muted">{lecturer.email}</td>
                <td>{lecturer.exam_count}</td>
                <td>
                  <span className={`tag ${lecturer.active ? 'tag-accent-2' : 'tag-neutral'}`}>
                    {lecturer.active ? 'Active' : 'Suspended'}
                  </span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button
                    className="btn btn-ghost"
                    style={{ color: 'var(--color-accent-700)' }}
                    onClick={() => toggleActive(lecturer)}
                  >
                    {lecturer.active ? 'Suspend' : 'Reactivate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showAdd && (
        <div className="dialog-backdrop" onClick={closeAdd}>
          <div className="dialog" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div className="dialog-title">Add lecturer</div>
              <button className="btn btn-icon" onClick={closeAdd}><X size={16} /></button>
            </div>
            <p className="text-muted" style={{ fontSize: 12, margin: '2px 0 var(--space-4)' }}>
              Lecturers create their own account in the Lecturer app. Attach an existing, unclaimed account to
              this institution below.
            </p>
            {unassignedLoading ? (
              <p className="text-muted">Loading unassigned lecturers…</p>
            ) : unassigned.length === 0 ? (
              <p className="text-muted">
                No unassigned lecturer accounts yet. Ask the lecturer to sign up at the lecturer portal first,
                then add them here.
              </p>
            ) : (
              <div className="field">
                <label>Lecturer</label>
                <select className="input" value={selectedId} onChange={e => setSelectedId(e.target.value)}>
                  <option value="">Select a lecturer…</option>
                  {unassigned.map(l => (
                    <option key={l.id} value={l.id}>{l.full_name} ({l.email})</option>
                  ))}
                </select>
              </div>
            )}
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={closeAdd}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={handleAdd}
                disabled={saving || !selectedId}
              >
                {saving ? 'Adding…' : 'Add lecturer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
