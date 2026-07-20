import { useEffect, useState, useCallback } from 'react';
import { Plus, Eye, Pencil, Play, Square, Trash2, X, UserPlus } from 'lucide-react';
import { supabase } from '@shared/lib/apiClient';
import { useNotification } from '@shared/components/NotificationProvider';
import AdminNav from '../components/AdminNav';
import AdminTabBar from '../components/AdminTabBar';

type Plan = 'trial' | 'standard' | 'enterprise';

interface Institution {
  id: string;
  name: string;
  contact_email: string;
  plan: Plan;
  lecturer_seat_limit: number;
  student_seat_limit: number;
  status: 'active' | 'suspended';
  created_at: string;
  lecturer_count: number;
  student_count: number;
}

const PLAN_TAG: Record<Plan, string> = {
  trial: 'tag-outline',
  standard: 'tag-neutral',
  enterprise: 'tag-accent',
};

const PLAN_LABEL: Record<Plan, string> = { trial: 'Trial', standard: 'Standard', enterprise: 'Enterprise' };

export default function AdminDashboard() {
  const { showToast, showConfirm } = useNotification();
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [seatsTarget, setSeatsTarget] = useState<Institution | null>(null);
  const [detailsTarget, setDetailsTarget] = useState<Institution | null>(null);
  const [seatsDraft, setSeatsDraft] = useState({ lecturerLimit: 0, studentLimit: 0 });
  const [newInst, setNewInst] = useState({ name: '', contact_email: '', plan: 'trial' as Plan, lecturerLimit: 20, studentLimit: 1000 });
  const [saving, setSaving] = useState(false);
  const [inviteTarget, setInviteTarget] = useState<Institution | null>(null);
  const [inviteDraft, setInviteDraft] = useState({ full_name: '', email: '' });
  const [inviting, setInviting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: rows }, { data: stats }] = await Promise.all([
      supabase.from('institutions').select('*').order('created_at', { ascending: false }),
      supabase.from('institution_stats').select('*'),
    ]);
    const statsById = new Map<string, any>((stats || []).map((s: any) => [s.institution_id, s]));
    setInstitutions(
      (rows || []).map((r: any) => ({
        ...r,
        lecturer_count: statsById.get(r.id)?.lecturer_count ?? 0,
        student_count: statsById.get(r.id)?.student_count ?? 0,
      }))
    );
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const logEvent = async (action: string, target: string, institutionId?: string) => {
    await supabase.rpc('log_audit_event', { p_action: action, p_target: target, p_institution_id: institutionId ?? null });
  };

  const handleCreate = async () => {
    if (!newInst.name.trim() || !newInst.contact_email.trim()) {
      showToast('Name and contact email are required.', 'error');
      return;
    }
    setSaving(true);
    const { data, error } = await supabase
      .from('institutions')
      .insert({
        name: newInst.name.trim(),
        contact_email: newInst.contact_email.trim(),
        plan: newInst.plan,
        lecturer_seat_limit: newInst.lecturerLimit,
        student_seat_limit: newInst.studentLimit,
      })
      .select('id')
      .single();
    setSaving(false);
    if (error || !data) {
      showToast(error?.message || 'Could not create institution.', 'error');
      return;
    }
    await logEvent('Created institution', newInst.name.trim(), data.id);
    showToast('Institution created.', 'success');
    setShowCreate(false);
    setNewInst({ name: '', contact_email: '', plan: 'trial', lecturerLimit: 20, studentLimit: 1000 });
    load();
  };

  const toggleStatus = async (inst: Institution) => {
    const nextStatus = inst.status === 'active' ? 'suspended' : 'active';
    const { error } = await supabase.from('institutions').update({ status: nextStatus }).eq('id', inst.id);
    if (error) { showToast(error.message, 'error'); return; }
    await logEvent(nextStatus === 'suspended' ? 'Suspended institution' : 'Reactivated institution', inst.name, inst.id);
    showToast(`${inst.name} ${nextStatus === 'suspended' ? 'suspended' : 'reactivated'}.`, 'success');
    load();
  };

  const removeInstitution = (inst: Institution) => {
    showConfirm({
      title: 'Remove institution',
      message: `This permanently removes ${inst.name} and all of its lecturers, students and exams. This cannot be undone.`,
      confirmText: 'Remove',
      onConfirm: async () => {
        const { error } = await supabase.from('institutions').delete().eq('id', inst.id);
        if (error) { showToast(error.message, 'error'); return; }
        await logEvent('Removed institution', inst.name);
        showToast('Institution removed.', 'success');
        load();
      },
    });
  };

  const openSeats = (inst: Institution) => {
    setSeatsTarget(inst);
    setSeatsDraft({ lecturerLimit: inst.lecturer_seat_limit, studentLimit: inst.student_seat_limit });
  };

  const saveSeats = async () => {
    if (!seatsTarget) return;
    const { error } = await supabase
      .from('institutions')
      .update({ lecturer_seat_limit: seatsDraft.lecturerLimit, student_seat_limit: seatsDraft.studentLimit })
      .eq('id', seatsTarget.id);
    if (error) { showToast(error.message, 'error'); return; }
    await logEvent('Updated seat limits', `${seatsTarget.name} (${seatsDraft.lecturerLimit} lecturer / ${seatsDraft.studentLimit} student)`, seatsTarget.id);
    showToast('Seat limits saved.', 'success');
    setSeatsTarget(null);
    load();
  };

  const openInvite = (inst: Institution) => {
    setInviteTarget(inst);
    setInviteDraft({ full_name: '', email: '' });
  };

  const submitInvite = async () => {
    if (!inviteTarget) return;
    if (!inviteDraft.full_name.trim() || !inviteDraft.email.trim()) {
      showToast('Full name and email are required.', 'error');
      return;
    }
    setInviting(true);
    const { error } = await supabase.from('institution_admins').insert({
      institution_id: inviteTarget.id,
      full_name: inviteDraft.full_name.trim(),
      email: inviteDraft.email.trim(),
    });
    setInviting(false);
    if (error) {
      showToast(error.message || 'Could not invite admin.', 'error');
      return;
    }
    showToast(`Invitation email sent to ${inviteDraft.email}.`, 'success');
    setInviteTarget(null);
  };

  const totals = {
    total: institutions.length,
    lecturers: institutions.reduce((a, i) => a + i.lecturer_count, 0),
    students: institutions.reduce((a, i) => a + i.student_count, 0),
    suspended: institutions.filter(i => i.status === 'suspended').length,
  };

  return (
    <>
      <AdminNav />
      <main className="wrap" style={{ maxWidth: 1120, margin: '0 auto', padding: 'var(--space-8) var(--space-6)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 'var(--space-6)', flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}>
          <div>
            <h1>Institutions</h1>
            <p className="text-muted">Manage every institution on Mashoke Labs, their seats, and their standing.</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            <Plus size={16} /> Add institution
          </button>
        </div>

        <AdminTabBar />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-4)', marginBottom: 'var(--space-6)' }}>
          <div className="card elev-sm"><span className="card-kicker">Institutions</span><span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 30 }}>{totals.total}</span></div>
          <div className="card elev-sm"><span className="card-kicker">Lecturer seats used</span><span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 30 }}>{totals.lecturers}</span></div>
          <div className="card elev-sm"><span className="card-kicker">Student seats used</span><span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 30 }}>{totals.students}</span></div>
          <div className="card elev-sm"><span className="card-kicker">Suspended</span><span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 30, color: 'var(--color-accent-700)' }}>{totals.suspended}</span></div>
        </div>

        {loading ? (
          <p className="text-muted">Loading institutions…</p>
        ) : institutions.length === 0 ? (
          <p className="text-muted">No institutions yet. Add the first one to get started.</p>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Institution</th><th>Plan</th><th>Lecturer seats</th><th>Student seats</th><th>Status</th><th>Joined</th><th></th></tr>
            </thead>
            <tbody>
              {institutions.map(inst => {
                const lecturerPct = Math.min(100, Math.round((inst.lecturer_count / Math.max(1, inst.lecturer_seat_limit)) * 100));
                const studentPct = Math.min(100, Math.round((inst.student_count / Math.max(1, inst.student_seat_limit)) * 100));
                return (
                  <tr key={inst.id}>
                    <td>
                      <div style={{ fontWeight: 700 }}>{inst.name}</div>
                      <div className="text-muted" style={{ fontSize: 11 }}>{inst.contact_email}</div>
                    </td>
                    <td><span className={`tag ${PLAN_TAG[inst.plan]}`}>{PLAN_LABEL[inst.plan]}</span></td>
                    <td style={{ minWidth: 120 }}>
                      <span style={{ fontSize: 12 }}>{inst.lecturer_count} / {inst.lecturer_seat_limit}</span>
                      <div style={{ height: 5, background: 'var(--color-neutral-200)', marginTop: 3 }}>
                        <div style={{ height: '100%', width: `${lecturerPct}%`, background: 'var(--color-accent)' }} />
                      </div>
                    </td>
                    <td style={{ minWidth: 120 }}>
                      <span style={{ fontSize: 12 }}>{inst.student_count} / {inst.student_seat_limit}</span>
                      <div style={{ height: 5, background: 'var(--color-neutral-200)', marginTop: 3 }}>
                        <div style={{ height: '100%', width: `${studentPct}%`, background: 'var(--color-accent)' }} />
                      </div>
                    </td>
                    <td>
                      <span
                        style={{
                          padding: '3px 10px', fontSize: 11, fontWeight: 700,
                          background: inst.status === 'active' ? 'var(--color-accent-2-100)' : 'var(--color-neutral-200)',
                          color: inst.status === 'active' ? 'var(--color-accent-2-800)' : 'var(--color-neutral-700)',
                        }}
                      >
                        {inst.status === 'active' ? 'Active' : 'Suspended'}
                      </span>
                    </td>
                    <td className="text-muted">{new Date(inst.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn btn-ghost" style={{ padding: 4 }} title="View details" onClick={() => setDetailsTarget(inst)}><Eye size={15} /></button>
                      <button className="btn btn-ghost" style={{ padding: 4 }} title="Invite admin" onClick={() => openInvite(inst)}><UserPlus size={15} /></button>
                      <button className="btn btn-ghost" style={{ padding: 4 }} title="Manage seats" onClick={() => openSeats(inst)}><Pencil size={15} /></button>
                      <button
                        className="btn btn-ghost" style={{ padding: 4, color: inst.status === 'active' ? 'var(--color-accent-700)' : 'var(--color-accent-2-700)' }}
                        title={inst.status === 'active' ? 'Suspend institution' : 'Reactivate institution'}
                        onClick={() => toggleStatus(inst)}
                      >
                        {inst.status === 'active' ? <Square size={15} /> : <Play size={15} />}
                      </button>
                      <button className="btn btn-ghost" style={{ padding: 4, color: 'var(--color-accent-700)' }} title="Remove" onClick={() => removeInstitution(inst)}><Trash2 size={15} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </main>

      {showCreate && (
        <div className="dialog-backdrop" onClick={() => setShowCreate(false)}>
          <div className="dialog" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div className="dialog-title">Add institution</div>
              <button className="btn btn-icon" onClick={() => setShowCreate(false)}><X size={16} /></button>
            </div>
            <div className="field">
              <label>Institution name</label>
              <input className="input" placeholder="e.g. Lagoon State University" value={newInst.name} onChange={e => setNewInst({ ...newInst, name: e.target.value })} />
            </div>
            <div className="field">
              <label>Primary contact email</label>
              <input className="input" type="email" placeholder="admissions@university.edu" value={newInst.contact_email} onChange={e => setNewInst({ ...newInst, contact_email: e.target.value })} />
            </div>
            <div className="field">
              <label>Plan</label>
              <select className="input" value={newInst.plan} onChange={e => setNewInst({ ...newInst, plan: e.target.value as Plan })}>
                <option value="trial">Trial</option>
                <option value="standard">Standard</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
              <div className="field"><label>Lecturer seats</label><input className="input" type="number" value={newInst.lecturerLimit} onChange={e => setNewInst({ ...newInst, lecturerLimit: parseInt(e.target.value) || 0 })} /></div>
              <div className="field"><label>Student seats</label><input className="input" type="number" value={newInst.studentLimit} onChange={e => setNewInst({ ...newInst, studentLimit: parseInt(e.target.value) || 0 })} /></div>
            </div>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCreate} disabled={saving}>{saving ? 'Adding…' : 'Add institution'}</button>
            </div>
          </div>
        </div>
      )}

      {seatsTarget && (
        <div className="dialog-backdrop" onClick={() => setSeatsTarget(null)}>
          <div className="dialog" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div className="dialog-title">Manage seats</div>
                <p className="text-muted" style={{ fontSize: 12, margin: '2px 0 0' }}>{seatsTarget.name}</p>
              </div>
              <button className="btn btn-icon" onClick={() => setSeatsTarget(null)}><X size={16} /></button>
            </div>
            <div className="field">
              <label>Lecturer / teacher seats ({seatsTarget.lecturer_count} in use)</label>
              <input
                className="input" type="number" min={seatsTarget.lecturer_count}
                value={seatsDraft.lecturerLimit} onChange={e => setSeatsDraft({ ...seatsDraft, lecturerLimit: parseInt(e.target.value) || 0 })}
              />
            </div>
            <div className="field">
              <label>Student seats ({seatsTarget.student_count} in use)</label>
              <input
                className="input" type="number" min={seatsTarget.student_count}
                value={seatsDraft.studentLimit} onChange={e => setSeatsDraft({ ...seatsDraft, studentLimit: parseInt(e.target.value) || 0 })}
              />
            </div>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={() => setSeatsTarget(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveSeats}>Save seat limits</button>
            </div>
          </div>
        </div>
      )}

      {inviteTarget && (
        <div className="dialog-backdrop" onClick={() => setInviteTarget(null)}>
          <div className="dialog" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div className="dialog-title">Invite institution admin</div>
                <p className="text-muted" style={{ fontSize: 12, margin: '2px 0 0' }}>{inviteTarget.name}</p>
              </div>
              <button className="btn btn-icon" onClick={() => setInviteTarget(null)}><X size={16} /></button>
            </div>
            <div className="field">
              <label>Full name</label>
              <input className="input" placeholder="Jane Doe" value={inviteDraft.full_name} onChange={e => setInviteDraft({ ...inviteDraft, full_name: e.target.value })} />
            </div>
            <div className="field">
              <label>Email</label>
              <input className="input" type="email" placeholder="admin@university.edu" value={inviteDraft.email} onChange={e => setInviteDraft({ ...inviteDraft, email: e.target.value })} />
              <p className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>They'll get an email with a link to set their own password.</p>
            </div>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={() => setInviteTarget(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={submitInvite} disabled={inviting}>{inviting ? 'Inviting…' : 'Invite admin'}</button>
            </div>
          </div>
        </div>
      )}

      {detailsTarget && (
        <div className="dialog-backdrop" onClick={() => setDetailsTarget(null)}>
          <div className="dialog" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div className="dialog-title">{detailsTarget.name}</div>
              <button className="btn btn-icon" onClick={() => setDetailsTarget(null)}><X size={16} /></button>
            </div>
            <div className="dialog-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <div><span className="text-muted">Contact:</span> {detailsTarget.contact_email}</div>
              <div><span className="text-muted">Plan:</span> <span className={`tag ${PLAN_TAG[detailsTarget.plan]}`}>{PLAN_LABEL[detailsTarget.plan]}</span></div>
              <div><span className="text-muted">Status:</span> {detailsTarget.status === 'active' ? 'Active' : 'Suspended'}</div>
              <div><span className="text-muted">Joined:</span> {new Date(detailsTarget.created_at).toLocaleDateString()}</div>
              <div className="hr" />
              <div><span className="text-muted">Lecturers:</span> {detailsTarget.lecturer_count} / {detailsTarget.lecturer_seat_limit} seats</div>
              <div><span className="text-muted">Students:</span> {detailsTarget.student_count} / {detailsTarget.student_seat_limit} seats</div>
            </div>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={() => setDetailsTarget(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
