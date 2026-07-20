import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@shared/lib/apiClient';
import AdminNav from '../components/AdminNav';
import AdminTabBar from '../components/AdminTabBar';

interface AuditLogRow {
  id: string;
  occurred_at: string;
  actor_id: string | null;
  actor_name: string;
  actor_role: string;
  institution_id: string | null;
  action: string;
  target: string;
}

interface AuditLogEntry extends AuditLogRow {
  institution_name: string | null;
}

export default function AdminAuditLog() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    // v1: most recent 200 entries only, no pagination.
    const [{ data: rows }, { data: institutions }] = await Promise.all([
      supabase
        .from('audit_log')
        .select('*')
        .order('occurred_at', { ascending: false })
        .limit(200),
      supabase.from('institutions').select('id, name'),
    ]);
    const nameById = new Map((institutions || []).map((i: any) => [i.id, i.name]));
    setEntries(
      (rows || []).map((r: AuditLogRow) => ({
        ...r,
        institution_name: r.institution_id ? nameById.get(r.institution_id) ?? null : null,
      }))
    );
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });

  const formatActor = (entry: AuditLogEntry) =>
    entry.actor_role === 'System' ? 'System' : `${entry.actor_name} (${entry.actor_role})`;

  return (
    <>
      <AdminNav />
      <main className="wrap" style={{ maxWidth: 1120, margin: '0 auto', padding: 'var(--space-8) var(--space-6)' }}>
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <h1>Audit log</h1>
          <p className="text-muted">Every sensitive action taken across the platform, in order.</p>
        </div>

        <AdminTabBar />

        {loading ? (
          <p className="text-muted">Loading activity…</p>
        ) : entries.length === 0 ? (
          <p className="text-muted">No activity yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Target</th>
                <th>Institution</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(entry => (
                <tr key={entry.id}>
                  <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>{formatTime(entry.occurred_at)}</td>
                  <td style={{ fontWeight: 700 }}>{formatActor(entry)}</td>
                  <td>{entry.action}</td>
                  <td className="text-muted">{entry.target}</td>
                  <td className="text-muted">{entry.institution_name ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
    </>
  );
}
