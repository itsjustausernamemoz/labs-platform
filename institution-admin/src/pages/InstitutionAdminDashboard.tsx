import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { supabase } from '@shared/lib/apiClient';
import logo from '@shared/assets/mashoke-logo.png';
import type { InstitutionAdmin } from '../lib/auth';
import { signOutInstitutionAdmin } from '../lib/auth';
import OverviewTab from '../components/tabs/OverviewTab';
import ExamsTab from '../components/tabs/ExamsTab';
import LecturersTab from '../components/tabs/LecturersTab';
import StudentsTab from '../components/tabs/StudentsTab';
import IssuesTab from '../components/tabs/IssuesTab';
import BillingTab from '../components/tabs/BillingTab';
import SettingsTab from '../components/tabs/SettingsTab';

type TabKey = 'overview' | 'exams' | 'lecturers' | 'students' | 'issues' | 'billing' | 'settings';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'exams', label: 'Exams' },
  { key: 'lecturers', label: 'Lecturers' },
  { key: 'students', label: 'Students' },
  { key: 'issues', label: 'Issues' },
  { key: 'billing', label: 'Billing' },
  { key: 'settings', label: 'Settings' },
];

interface Institution {
  id: string;
  name: string;
  plan: string;
  lecturer_seat_limit: number;
  student_seat_limit: number;
}

export default function InstitutionAdminDashboard({ admin }: { admin: InstitutionAdmin }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabKey>('overview');
  const [institution, setInstitution] = useState<Institution | null>(null);
  const [lecturerCount, setLecturerCount] = useState(0);
  const [studentCount, setStudentCount] = useState(0);
  const [openIssueCount, setOpenIssueCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const loadHeader = useCallback(async () => {
    setLoading(true);
    const [{ data: inst }, { data: stats }, { count: issueCount }] = await Promise.all([
      supabase.from('institutions').select('id, name, plan, lecturer_seat_limit, student_seat_limit').eq('id', admin.institution_id).single(),
      supabase.from('institution_stats').select('lecturer_count, student_count').eq('institution_id', admin.institution_id).maybeSingle(),
      supabase.from('issues').select('id', { count: 'exact', head: true }).eq('institution_id', admin.institution_id).eq('status', 'open'),
    ]);
    setInstitution(inst);
    setLecturerCount(stats?.lecturer_count ?? 0);
    setStudentCount(stats?.student_count ?? 0);
    setOpenIssueCount(issueCount ?? 0);
    setLoading(false);
  }, [admin.institution_id]);

  useEffect(() => { loadHeader(); }, [loadHeader]);

  const handleLogout = async () => {
    await signOutInstitutionAdmin();
    navigate('/', { replace: true });
  };

  const lecturerPct = institution ? Math.min(100, Math.round((lecturerCount / Math.max(1, institution.lecturer_seat_limit)) * 100)) : 0;
  const studentPct = institution ? Math.min(100, Math.round((studentCount / Math.max(1, institution.student_seat_limit)) * 100)) : 0;

  return (
    <>
      <nav className="nav">
        <div className="nav-brand" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src={logo} alt="Mashoke Tech" style={{ width: 30, height: 30, objectFit: 'contain' }} />
          Mashoke Labs <span className="tag tag-outline" style={{ marginLeft: 4 }}>Institution Admin</span>
        </div>
        <button className="btn btn-icon btn-secondary" title="Log out" onClick={handleLogout} style={{ marginLeft: 'auto' }}>
          <LogOut size={16} />
        </button>
      </nav>

      <main style={{ maxWidth: 1080, margin: '0 auto', padding: 'var(--space-8) var(--space-6)' }}>
        <h1>{loading ? 'Loading…' : institution?.name || 'Your institution'}</h1>
        <p className="text-muted" style={{ marginBottom: 'var(--space-6)' }}>
          Manage your lecturers, students, and resolve issues without contacting Mashoke Tech.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-4)', marginBottom: 'var(--space-6)' }}>
          <div className="card elev-sm">
            <span className="card-kicker">Lecturer seats</span>
            <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 26 }}>
              {lecturerCount} <span className="text-muted" style={{ fontSize: 14, fontWeight: 400 }}>/ {institution?.lecturer_seat_limit ?? '—'}</span>
            </span>
            <div style={{ height: 5, background: 'var(--color-neutral-200)', marginTop: 6 }}>
              <div style={{ height: '100%', width: `${lecturerPct}%`, background: 'var(--color-accent)' }} />
            </div>
          </div>
          <div className="card elev-sm">
            <span className="card-kicker">Student seats</span>
            <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 26 }}>
              {studentCount} <span className="text-muted" style={{ fontSize: 14, fontWeight: 400 }}>/ {institution?.student_seat_limit ?? '—'}</span>
            </span>
            <div style={{ height: 5, background: 'var(--color-neutral-200)', marginTop: 6 }}>
              <div style={{ height: '100%', width: `${studentPct}%`, background: 'var(--color-accent)' }} />
            </div>
          </div>
          <div className="card elev-sm">
            <span className="card-kicker">Plan</span>
            <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 22, textTransform: 'capitalize' }}>{institution?.plan ?? '—'}</span>
          </div>
          <div className="card elev-sm">
            <span className="card-kicker">Open issues</span>
            <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 26, color: 'var(--color-accent-700)' }}>{openIssueCount}</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-6)', flexWrap: 'wrap' }}>
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                padding: '9px 16px', fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em',
                border: '1px solid var(--color-divider)', cursor: 'pointer',
                background: tab === t.key ? 'var(--color-accent)' : 'transparent',
                color: tab === t.key ? 'var(--color-bg)' : 'inherit',
                borderColor: tab === t.key ? 'var(--color-accent)' : 'var(--color-divider)',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'overview' && <OverviewTab institutionId={admin.institution_id} />}
        {tab === 'exams' && <ExamsTab institutionId={admin.institution_id} />}
        {tab === 'lecturers' && <LecturersTab institutionId={admin.institution_id} onChange={loadHeader} />}
        {tab === 'students' && <StudentsTab institutionId={admin.institution_id} onChange={loadHeader} />}
        {tab === 'issues' && <IssuesTab institutionId={admin.institution_id} admin={admin} onChange={loadHeader} onRequestSeatIncrease={() => setTab('issues')} />}
        {tab === 'billing' && <BillingTab institutionId={admin.institution_id} onRequestSeatIncrease={() => setTab('issues')} adminName={admin.full_name} />}
        {tab === 'settings' && <SettingsTab institution={institution} onChange={loadHeader} />}
      </main>
    </>
  );
}
