import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@shared/lib/apiClient';
import { useNotification } from '@shared/components/NotificationProvider';

type InvoiceStatus = 'paid' | 'past_due' | 'trialing';

interface PlanInfo {
  plan: string | null;
  pricePerMonth: number | null;
  nextInvoiceDate: string | null;
}

interface Invoice {
  id: string;
  invoice_date: string;
  amount: number;
  status: InvoiceStatus;
}

interface BillingTabProps {
  institutionId: string;
  onRequestSeatIncrease: () => void;
  adminName?: string;
}

const STATUS_TAG: Record<InvoiceStatus, string> = {
  paid: 'tag-neutral',
  past_due: 'tag-accent',
  trialing: 'tag-outline',
};

const STATUS_LABEL: Record<InvoiceStatus, string> = {
  paid: 'Paid',
  past_due: 'Past due',
  trialing: 'Trialing',
};

export default function BillingTab({ institutionId, onRequestSeatIncrease, adminName }: BillingTabProps) {
  const { showToast } = useNotification();
  const [planInfo, setPlanInfo] = useState<PlanInfo>({ plan: null, pricePerMonth: null, nextInvoiceDate: null });
  const [institutionName, setInstitutionName] = useState<string>('');
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: subscription }, { data: institution }, { data: invoiceRows }] = await Promise.all([
      supabase
        .from('subscriptions')
        .select('plan, price_per_month, next_invoice_date')
        .eq('institution_id', institutionId)
        .maybeSingle(),
      supabase
        .from('institutions')
        .select('name, plan')
        .eq('id', institutionId)
        .single(),
      supabase
        .from('invoices')
        .select('id, invoice_date, amount, status')
        .eq('institution_id', institutionId)
        .order('invoice_date', { ascending: false }),
    ]);

    setInstitutionName(institution?.name ?? '');

    if (subscription) {
      setPlanInfo({
        plan: subscription.plan ?? institution?.plan ?? null,
        pricePerMonth: subscription.price_per_month ?? null,
        nextInvoiceDate: subscription.next_invoice_date ?? null,
      });
    } else {
      setPlanInfo({
        plan: institution?.plan ?? null,
        pricePerMonth: null,
        nextInvoiceDate: null,
      });
    }

    setInvoices((invoiceRows || []) as Invoice[]);
    setLoading(false);
  }, [institutionId]);

  useEffect(() => { load(); }, [load]);

  const logEvent = async (action: string, target: string) => {
    await supabase.rpc('log_audit_event', { p_action: action, p_target: target, p_institution_id: institutionId });
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

  const handleRequestSeatIncrease = async () => {
    setRequesting(true);
    const { error } = await supabase.from('issues').insert({
      institution_id: institutionId,
      title: 'Requesting additional seats',
      category: 'billing',
      status: 'escalated',
      reporter_name: adminName || 'Institution Admin',
      reporter_role: 'institution_admin',
    });
    setRequesting(false);
    if (error) {
      showToast(error.message, 'error');
      return;
    }
    await logEvent('Requested seat increase', institutionName || 'seat increase request');
    showToast('Seat increase request sent to Mashoke Tech.', 'success');
    onRequestSeatIncrease();
  };

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
        <h3 style={{ margin: 0 }}>Billing</h3>
        <button className="btn btn-secondary" onClick={handleRequestSeatIncrease} disabled={requesting}>
          {requesting ? 'Requesting…' : 'Request seat increase'}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-6)' }}>
        <div className="card elev-sm">
          <span className="card-kicker">Current plan</span>
          <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 22, textTransform: 'capitalize' }}>
            {planInfo.plan ?? '—'}
          </span>
        </div>
        <div className="card elev-sm">
          <span className="card-kicker">Monthly cost</span>
          <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 22 }}>
            {planInfo.pricePerMonth != null ? `$${planInfo.pricePerMonth}` : '—'}
          </span>
        </div>
        <div className="card elev-sm">
          <span className="card-kicker">Next invoice</span>
          <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 22 }}>
            {planInfo.nextInvoiceDate ? formatDate(planInfo.nextInvoiceDate) : '—'}
          </span>
        </div>
      </div>

      <h3>Invoice history</h3>
      {loading ? (
        <p className="text-muted">Loading invoices…</p>
      ) : invoices.length === 0 ? (
        <p className="text-muted">No invoices yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map(inv => (
              <tr key={inv.id}>
                <td>{formatDate(inv.invoice_date)}</td>
                <td style={{ fontWeight: 700 }}>${inv.amount}</td>
                <td>
                  <span className={`tag ${STATUS_TAG[inv.status]}`}>{STATUS_LABEL[inv.status]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
