import { useEffect, useState, useCallback } from 'react';
import { X } from 'lucide-react';
import { supabase } from '@shared/lib/apiClient';
import { useNotification } from '@shared/components/NotificationProvider';

interface InstitutionAdminRow {
  id: string;
  full_name: string;
  email: string;
}

interface InstitutionProp {
  id: string;
  name: string;
  contact_email?: string;
}

interface SettingsTabProps {
  institution: InstitutionProp | null;
  onChange: () => void;
}

export default function SettingsTab({ institution, onChange }: SettingsTabProps) {
  const { showToast, showConfirm } = useNotification();
  const [name, setName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [admins, setAdmins] = useState<InstitutionAdminRow[]>([]);
  const [loadingAdmins, setLoadingAdmins] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showInviteInfo, setShowInviteInfo] = useState(false);

  const institutionId = institution?.id ?? null;

  const logEvent = useCallback(async (action: string, target: string) => {
    if (!institutionId) return;
    await supabase.rpc('log_audit_event', { p_action: action, p_target: target, p_institution_id: institutionId });
  }, [institutionId]);

  // Pre-fill the editable name from the shell's institution prop whenever it changes.
  useEffect(() => {
    setName(institution?.name ?? '');
  }, [institution?.name]);

  // The shell's institution object doesn't include contact_email, so fetch it separately.
  useEffect(() => {
    if (!institutionId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('institutions')
        .select('contact_email')
        .eq('id', institutionId)
        .single();
      if (cancelled) return;
      if (error) {
        showToast(error.message, 'error');
        return;
      }
      setContactEmail(data?.contact_email ?? '');
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [institutionId]);

  const loadAdmins = useCallback(async () => {
    if (!institutionId) return;
    setLoadingAdmins(true);
    const { data, error } = await supabase
      .from('institution_admins')
      .select('id, full_name, email')
      .eq('institution_id', institutionId)
      .order('full_name');
    if (error) {
      showToast(error.message, 'error');
    } else {
      setAdmins(data || []);
    }
    setLoadingAdmins(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [institutionId]);

  useEffect(() => { loadAdmins(); }, [loadAdmins]);

  const handleRemoveAdmin = (admin: InstitutionAdminRow) => {
    showConfirm({
      title: 'Remove institution admin',
      message: `This removes ${admin.full_name}'s institution admin access. Their underlying account is not deleted.`,
      confirmText: 'Remove',
      onConfirm: async () => {
        const { error } = await supabase.from('institution_admins').delete().eq('id', admin.id);
        if (error) {
          showToast(error.message, 'error');
          return;
        }
        await logEvent('Removed institution admin', admin.full_name);
        showToast(`${admin.full_name} removed.`, 'success');
        loadAdmins();
      },
    });
  };

  const handleSave = async () => {
    if (!institutionId) return;
    setSaving(true);
    const { error } = await supabase
      .from('institutions')
      .update({ name, contact_email: contactEmail })
      .eq('id', institutionId);
    setSaving(false);
    if (error) {
      showToast(error.message, 'error');
      return;
    }
    await logEvent('Updated institution profile', name);
    showToast('Settings saved.', 'success');
    onChange();
  };

  if (!institution) {
    return <p className="text-muted">Loading…</p>;
  }

  return (
    <>
      <h3 style={{ marginTop: 0 }}>Institution profile</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-6)' }}>
        <div className="field">
          <label>Institution name</label>
          <input className="input" value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div className="field">
          <label>Primary contact email</label>
          <input className="input" type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} />
        </div>
      </div>

      <div className="hr" />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
        <h3 style={{ margin: 0 }}>Institution admins</h3>
        <button className="btn btn-primary" onClick={() => setShowInviteInfo(true)}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg> Invite admin
        </button>
      </div>

      {loadingAdmins ? (
        <p className="text-muted">Loading admins…</p>
      ) : admins.length === 0 ? (
        <p className="text-muted">No institution admins yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr><th>Name</th><th>Email</th><th></th></tr>
          </thead>
          <tbody>
            {admins.map(admin => (
              <tr key={admin.id}>
                <td style={{ fontWeight: 700 }}>{admin.full_name}</td>
                <td className="text-muted">{admin.email}</td>
                <td style={{ textAlign: 'right' }}>
                  <button
                    className="btn btn-ghost"
                    style={{ color: 'var(--color-accent-700)' }}
                    onClick={() => handleRemoveAdmin(admin)}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="text-muted" style={{ fontSize: 12, marginTop: 'var(--space-3)' }}>
        New institution admins are provisioned by Mashoke Tech support — contact{' '}
        <a href="mailto:support@mashoketech.com">support@mashoketech.com</a> with the person's name and email to
        get them access.
      </p>

      <button className="btn btn-primary" style={{ marginTop: 'var(--space-6)' }} onClick={handleSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save settings'}
      </button>

      {showInviteInfo && (
        <div className="dialog-backdrop" onClick={() => setShowInviteInfo(false)}>
          <div className="dialog" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div className="dialog-title">Invite institution admin</div>
              <button className="btn btn-icon" onClick={() => setShowInviteInfo(false)}><X size={16} /></button>
            </div>
            <p className="text-muted" style={{ fontSize: 13, margin: '4px 0 0' }}>
              New institution admin accounts must be provisioned by Mashoke Tech support — this app has no way to
              create logins directly. Email <a href="mailto:support@mashoketech.com">support@mashoketech.com</a>{' '}
              with the person's full name and email address, and support will set up their access.
            </p>
            <div className="dialog-actions">
              <button className="btn btn-primary" onClick={() => setShowInviteInfo(false)}>OK</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
