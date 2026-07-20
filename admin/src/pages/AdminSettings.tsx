import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@shared/lib/apiClient';
import { useNotification } from '@shared/components/NotificationProvider';
import AdminNav from '../components/AdminNav';
import AdminTabBar from '../components/AdminTabBar';

interface PlatformSettings {
  id: number;
  standard_price: number;
  enterprise_price: number;
  announcement: string;
  announcement_published: boolean;
  updated_at: string;
}

interface FeatureFlag {
  key: string;
  label: string;
  detail: string;
  enabled: boolean;
  updated_at: string;
}

interface SettingsForm {
  standardPrice: number;
  enterprisePrice: number;
  announcement: string;
  announcementPublished: boolean;
}

export default function AdminSettings() {
  const { showToast } = useNotification();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [form, setForm] = useState<SettingsForm>({
    standardPrice: 0,
    enterprisePrice: 0,
    announcement: '',
    announcementPublished: false,
  });

  const logEvent = async (action: string, target: string) => {
    await supabase.rpc('log_audit_event', { p_action: action, p_target: target, p_institution_id: null });
  };

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: settings }, { data: flagRows }] = await Promise.all([
      supabase.from('platform_settings').select('*').eq('id', 1).single(),
      supabase.from('feature_flags').select('*'),
    ]);
    if (settings) {
      const s = settings as PlatformSettings;
      setForm({
        standardPrice: s.standard_price,
        enterprisePrice: s.enterprise_price,
        announcement: s.announcement ?? '',
        announcementPublished: s.announcement_published,
      });
    }
    setFlags((flagRows || []) as FeatureFlag[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleFlag = async (flag: FeatureFlag) => {
    const nextEnabled = !flag.enabled;
    const { error } = await supabase.from('feature_flags').update({ enabled: nextEnabled }).eq('key', flag.key);
    if (error) {
      showToast(error.message, 'error');
      return;
    }
    setFlags(prev => prev.map(f => (f.key === flag.key ? { ...f, enabled: nextEnabled } : f)));
    await logEvent(`Toggled feature flag: ${flag.label}`, nextEnabled ? 'Enabled' : 'Disabled');
    showToast(`${flag.label} ${nextEnabled ? 'enabled' : 'disabled'}.`, 'success');
  };

  const handleSave = async () => {
    setSaving(true);
    const { error } = await supabase
      .from('platform_settings')
      .update({
        standard_price: form.standardPrice,
        enterprise_price: form.enterprisePrice,
        announcement: form.announcement,
        announcement_published: form.announcementPublished,
      })
      .eq('id', 1);
    setSaving(false);
    if (error) {
      showToast(error.message, 'error');
      return;
    }
    await logEvent('Updated platform settings', 'Pricing/announcement');
    showToast('Settings saved.', 'success');
  };

  return (
    <>
      <AdminNav />
      <main className="wrap" style={{ maxWidth: 1120, margin: '0 auto', padding: 'var(--space-8) var(--space-6)' }}>
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <h1>Settings</h1>
          <p className="text-muted">Platform-wide plan pricing, feature availability, and announcements.</p>
        </div>

        <AdminTabBar />

        {loading ? (
          <p className="text-muted">Loading settings…</p>
        ) : (
          <>
            <h3>Plan pricing</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-6)' }}>
              <div className="field">
                <label>Trial ($/mo)</label>
                <input className="input" value="Free" disabled />
              </div>
              <div className="field">
                <label>Standard ($/mo)</label>
                <input
                  className="input" type="number" min={0} value={form.standardPrice}
                  onChange={e => setForm({ ...form, standardPrice: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <div className="field">
                <label>Enterprise ($/mo)</label>
                <input
                  className="input" type="number" min={0} value={form.enterprisePrice}
                  onChange={e => setForm({ ...form, enterprisePrice: parseFloat(e.target.value) || 0 })}
                />
              </div>
            </div>

            <div className="hr" />
            <h3>Feature flags</h3>
            {flags.length === 0 ? (
              <p className="text-muted">No feature flags configured.</p>
            ) : (
              flags.map(flag => (
                <div key={flag.key} className="toggle-row">
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{flag.label}</div>
                    <div className="text-muted" style={{ fontSize: 12 }}>{flag.detail}</div>
                  </div>
                  <button
                    type="button"
                    className={`switch ${flag.enabled ? 'on' : ''}`}
                    role="switch"
                    aria-checked={flag.enabled}
                    aria-label={flag.label}
                    onClick={() => toggleFlag(flag)}
                  >
                    <span />
                  </button>
                </div>
              ))
            )}

            <div className="hr" />
            <h3>Platform announcement</h3>
            <div className="field">
              <label>Banner message shown to all lecturers &amp; students</label>
              <textarea
                className="input" rows={2} value={form.announcement}
                onChange={e => setForm({ ...form, announcement: e.target.value })}
              />
            </div>
            <div className="toggle-row" style={{ borderBottom: 'none' }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>Publish banner</span>
              <button
                type="button"
                className={`switch ${form.announcementPublished ? 'on' : ''}`}
                role="switch"
                aria-checked={form.announcementPublished}
                aria-label="Publish banner"
                onClick={() => setForm({ ...form, announcementPublished: !form.announcementPublished })}
              >
                <span />
              </button>
            </div>

            <button className="btn btn-primary" style={{ marginTop: 'var(--space-4)' }} onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          </>
        )}
      </main>

      <style>{`
        .toggle-row {
          display: flex; align-items: center; justify-content: space-between;
          padding: var(--space-3) 0; border-bottom: 1px solid var(--color-divider);
        }
        .switch {
          width: 40px; height: 22px; background: var(--color-neutral-300);
          position: relative; cursor: pointer; border: none; padding: 0; flex-shrink: 0;
        }
        .switch.on { background: var(--color-accent); }
        .switch > span {
          position: absolute; top: 2px; left: 2px; width: 18px; height: 18px;
          background: var(--color-bg); transition: left 0.15s;
        }
        .switch.on > span { left: 20px; }
      `}</style>
    </>
  );
}
