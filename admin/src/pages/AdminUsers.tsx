import { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '@shared/lib/apiClient';
import { useNotification } from '@shared/components/NotificationProvider';
import AdminNav from '../components/AdminNav';
import AdminTabBar from '../components/AdminTabBar';

type Role = 'lecturer' | 'student' | 'institution_admin';
type RoleFilter = Role | 'all';

// Normalized shape all three source tables map into. `lastActive` is the best
// timestamp each table actually has (updated_at for lecturers/admins, created_at
// for students — there is no login-tracking column anywhere in this schema).
interface DirectoryUser {
  id: string;
  role: Role;
  name: string;
  email: string | null;
  studentNumber: string | null;
  institutionId: string | null;
  active: boolean;
  lastActive: string | null;
}

interface InstitutionRef {
  id: string;
  name: string;
}

const ROLE_LABEL: Record<Role, string> = {
  lecturer: 'Lecturer',
  student: 'Student',
  institution_admin: 'Institution admin',
};

const ROLE_FILTERS: RoleFilter[] = ['all', 'lecturer', 'student', 'institution_admin'];

export default function AdminUsers() {
  const { showToast } = useNotification();
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [institutions, setInstitutions] = useState<InstitutionRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: lecturers }, { data: students }, { data: admins }, { data: insts }] = await Promise.all([
      supabase.from('lecturer_profiles').select('id, full_name, email, institution_id, active, updated_at'),
      supabase.from('students').select('id, student_number, full_name, institution_id, active, created_at'),
      supabase.from('institution_admins').select('id, full_name, email, institution_id, active, created_at'),
      supabase.from('institutions').select('id, name'),
    ]);

    const lecturerUsers: DirectoryUser[] = (lecturers || []).map((l: any) => ({
      id: l.id,
      role: 'lecturer',
      name: l.full_name || l.email || 'Unnamed lecturer',
      email: l.email ?? null,
      studentNumber: null,
      institutionId: l.institution_id ?? null,
      active: l.active,
      lastActive: l.updated_at ?? null,
    }));

    const studentUsers: DirectoryUser[] = (students || []).map((s: any) => ({
      id: s.id,
      role: 'student',
      name: s.full_name || s.student_number,
      email: null,
      studentNumber: s.student_number ?? null,
      institutionId: s.institution_id ?? null,
      active: s.active,
      lastActive: s.created_at ?? null,
    }));

    const adminUsers: DirectoryUser[] = (admins || []).map((a: any) => ({
      id: a.id,
      role: 'institution_admin',
      name: a.full_name || a.email || 'Unnamed admin',
      email: a.email ?? null,
      studentNumber: null,
      institutionId: a.institution_id ?? null,
      active: a.active,
      lastActive: a.created_at ?? null,
    }));

    setUsers([...lecturerUsers, ...studentUsers, ...adminUsers].sort((a, b) => a.name.localeCompare(b.name)));
    setInstitutions(insts || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const institutionById = useMemo(() => new Map(institutions.map(i => [i.id, i.name])), [institutions]);

  const logEvent = async (action: string, target: string, institutionId?: string | null) => {
    await supabase.rpc('log_audit_event', { p_action: action, p_target: target, p_institution_id: institutionId ?? null });
  };

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users
      .filter(u => roleFilter === 'all' || u.role === roleFilter)
      .filter(u => {
        if (!q) return true;
        return (
          u.name.toLowerCase().includes(q) ||
          (u.email || '').toLowerCase().includes(q) ||
          (u.studentNumber || '').toLowerCase().includes(q)
        );
      });
  }, [users, roleFilter, query]);

  const toggleActive = async (u: DirectoryUser) => {
    const nextActive = !u.active;
    const { error } = await supabase.users.setActive(u.role, u.id, nextActive);
    if (error) { showToast(error.message, 'error'); return; }
    await logEvent(nextActive ? 'Reactivated user' : 'Suspended user', `${u.name} (${ROLE_LABEL[u.role]})`, u.institutionId);
    showToast(`${u.name} ${nextActive ? 'reactivated' : 'suspended'}.`, 'success');
    load();
  };

  const RESET_APP_URL: Record<'lecturer' | 'institution_admin', string> = {
    lecturer: 'https://lab-lecturer.web.app/reset-password',
    institution_admin: 'https://mashoke-institution-admin.web.app/reset-password',
  };

  const resetPassword = async (u: DirectoryUser) => {
    if (!u.email) {
      showToast('This user has no email on file — nothing to reset.', 'error');
      return;
    }
    if (u.role === 'student') return;
    const { error } = await supabase.auth.resetPasswordForEmail(u.email, { redirectTo: RESET_APP_URL[u.role] });
    if (error) { showToast(error.message, 'error'); return; }
    await logEvent('Sent password reset email', `${u.name} (${u.email})`, u.institutionId);
    showToast(`Password reset email sent to ${u.email}.`, 'success');
  };

  const assignInstitution = async (u: DirectoryUser, institutionId: string) => {
    if (!institutionId) return;
    const { error } = await supabase.from('lecturer_profiles').update({ institution_id: institutionId }).eq('id', u.id);
    if (error) { showToast(error.message, 'error'); return; }
    const instName = institutionById.get(institutionId) || institutionId;
    await logEvent('Assigned lecturer to institution', `${u.name} → ${instName}`, institutionId);
    showToast(`${u.name} assigned to ${instName}.`, 'success');
    load();
  };

  return (
    <>
      <AdminNav />
      <main className="wrap" style={{ maxWidth: 1120, margin: '0 auto', padding: 'var(--space-8) var(--space-6)' }}>
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <h1>Users</h1>
          <p className="text-muted">Every account on the platform, across every institution.</p>
        </div>

        <AdminTabBar />

        <div className="field" style={{ maxWidth: 360, marginBottom: 'var(--space-4)' }}>
          <label>Search</label>
          <input
            className="input"
            placeholder="Search by name, email, or student number…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
          {ROLE_FILTERS.map(r => {
            const active = roleFilter === r;
            const label = r === 'all' ? 'All roles' : ROLE_LABEL[r];
            return (
              <button
                key={r}
                className="btn btn-secondary"
                style={active ? { background: 'var(--color-accent)', color: 'var(--color-bg)', borderColor: 'var(--color-accent)' } : undefined}
                onClick={() => setRoleFilter(r)}
              >
                {label}
              </button>
            );
          })}
        </div>

        {loading ? (
          <p className="text-muted">Loading users…</p>
        ) : filteredUsers.length === 0 ? (
          <p className="text-muted">No users match this search.</p>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Name</th><th>Role</th><th>Institution</th><th>Status</th><th>Last active</th><th></th></tr>
            </thead>
            <tbody>
              {filteredUsers.map(u => (
                <tr key={`${u.role}-${u.id}`}>
                  <td>
                    <div style={{ fontWeight: 700 }}>{u.name}</div>
                    {u.email && <div className="text-muted" style={{ fontSize: 11 }}>{u.email}</div>}
                  </td>
                  <td><span className="tag tag-neutral">{ROLE_LABEL[u.role]}</span></td>
                  <td>
                    {u.institutionId ? (
                      institutionById.get(u.institutionId) || 'Unknown institution'
                    ) : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span className="text-muted">Unassigned</span>
                        {u.role === 'lecturer' && (
                          <select
                            className="input"
                            style={{ width: 'auto', fontSize: 11, padding: '2px 6px' }}
                            defaultValue=""
                            onChange={e => assignInstitution(u, e.target.value)}
                          >
                            <option value="" disabled>Assign…</option>
                            {institutions.map(i => (
                              <option key={i.id} value={i.id}>{i.name}</option>
                            ))}
                          </select>
                        )}
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={`tag ${u.active ? 'tag-accent-2' : 'tag-outline'}`}>
                      {u.active ? 'Active' : 'Suspended'}
                    </span>
                  </td>
                  <td className="text-muted">{u.lastActive ? new Date(u.lastActive).toLocaleDateString() : '—'}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {u.role !== 'student' && (
                      <button className="btn btn-ghost" onClick={() => resetPassword(u)}>Reset password</button>
                    )}
                    <button
                      className="btn btn-ghost"
                      style={{ color: 'var(--color-accent-700)' }}
                      onClick={() => toggleActive(u)}
                    >
                      {u.active ? 'Suspend' : 'Reactivate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
    </>
  );
}
