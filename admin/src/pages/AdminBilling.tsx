import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@shared/lib/apiClient';
import AdminNav from '../components/AdminNav';
import AdminTabBar from '../components/AdminTabBar';

type Plan = 'trial' | 'standard' | 'enterprise';
type Cycle = 'monthly' | 'annual' | 'trial';
type InvoiceStatus = 'paid' | 'past_due' | 'trialing';

interface BillingRow {
  institutionId: string;
  name: string;
  plan: Plan;
  pricePerMonth: number;
  cycle: Cycle;
  nextInvoiceDate: string | null;
  status: InvoiceStatus;
}

const PLAN_TAG: Record<Plan, string> = {
  trial: 'tag-outline',
  standard: 'tag-neutral',
  enterprise: 'tag-accent',
};

const PLAN_LABEL: Record<Plan, string> = { trial: 'Trial', standard: 'Standard', enterprise: 'Enterprise' };

const STATUS_TAG: Record<InvoiceStatus, string> = {
  paid: 'tag-neutral',
  past_due: 'tag-accent',
  trialing: 'tag-outline',
};

const STATUS_LABEL: Record<InvoiceStatus, string> = { paid: 'Paid', past_due: 'Past due', trialing: 'Trialing' };

const CYCLE_LABEL: Record<Cycle, string> = { monthly: 'Monthly', annual: 'Annual', trial: 'Trial' };

export default function AdminBilling() {
  const [rows, setRows] = useState<BillingRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: institutions }, { data: subscriptions }] = await Promise.all([
      supabase.from('institutions').select('id, name, plan').order('name'),
      supabase.from('subscriptions').select('*'),
    ]);
    const subsByInstitution = new Map<string, any>((subscriptions || []).map((s: any) => [s.institution_id, s]));
    const merged: BillingRow[] = (institutions || []).map((inst: any) => {
      const sub = subsByInstitution.get(inst.id);
      // Institutions without a subscriptions row yet (none are auto-created on institution
      // creation) are treated as an unbilled trial: no price, no cycle, no invoice date.
      if (!sub) {
        return {
          institutionId: inst.id,
          name: inst.name,
          plan: inst.plan as Plan,
          pricePerMonth: 0,
          cycle: 'trial' as Cycle,
          nextInvoiceDate: null,
          status: 'trialing' as InvoiceStatus,
        };
      }
      return {
        institutionId: inst.id,
        name: inst.name,
        plan: sub.plan as Plan,
        pricePerMonth: Number(sub.price_per_month) || 0,
        cycle: sub.cycle as Cycle,
        nextInvoiceDate: sub.next_invoice_date,
        status: sub.status as InvoiceStatus,
      };
    });
    setRows(merged);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // MRR: sum of price_per_month for every subscription not currently trialing. The schema's
  // price_per_month is already a monthly figure regardless of billing cycle, so no per-cycle
  // normalization is needed.
  const mrr = rows.filter(r => r.status !== 'trialing').reduce((a, r) => a + r.pricePerMonth, 0);
  const activeSubs = rows.filter(r => r.status !== 'trialing').length;
  const pastDue = rows.filter(r => r.status === 'past_due').length;
  // Revenue YTD is a simple estimate: current MRR x number of months elapsed so far this year.
  // There's no invoice history table to sum actual collected revenue from.
  const monthsElapsed = new Date().getMonth() + 1;
  const ytd = mrr * monthsElapsed;

  const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  return (
    <>
      <AdminNav />
      <main className="wrap" style={{ maxWidth: 1120, margin: '0 auto', padding: 'var(--space-8) var(--space-6)' }}>
        <h1>Billing &amp; revenue</h1>
        <p className="text-muted" style={{ marginBottom: 'var(--space-4)' }}>
          Subscription revenue across every institution on the platform.
        </p>

        <AdminTabBar />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
          <div className="card elev-sm"><span className="card-kicker">MRR</span><span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 30 }}>{money(mrr)}</span></div>
          <div className="card elev-sm"><span className="card-kicker">Revenue (YTD est.)</span><span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 30 }}>{money(ytd)}</span></div>
          <div className="card elev-sm"><span className="card-kicker">Active subscriptions</span><span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 30 }}>{activeSubs}</span></div>
          <div className="card elev-sm"><span className="card-kicker">Past due</span><span style={{ fontFamily: 'var(--font-heading)', fontWeight: 800, fontSize: 30, color: 'var(--color-accent-700)' }}>{pastDue}</span></div>
        </div>

        {/*
          The mockup includes a 6-month MRR trend bar chart. There's no historical snapshot
          table backing this data (subscriptions only store the current price/status, not a
          time series), so rendering a "trend" would mean repeating today's MRR six times —
          which reads as a flat line and falsely implies revenue has been stable for months.
          Omitting the chart and noting the limitation is more honest than fabricating history.
          A real trend chart would need a monthly MRR snapshot table populated on a schedule.
        */}
        <p className="text-muted" style={{ fontSize: 12, marginBottom: 'var(--space-6)' }}>
          Historical MRR trend isn&apos;t tracked yet — it would require a monthly revenue snapshot table. Figures above reflect the current billing period only.
        </p>

        <h3>Subscriptions</h3>
        {loading ? (
          <p className="text-muted">Loading subscriptions…</p>
        ) : rows.length === 0 ? (
          <p className="text-muted">No institutions yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Institution</th><th>Plan</th><th>Price / mo</th><th>Billing cycle</th><th>Next invoice</th><th>Status</th></tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.institutionId}>
                  <td style={{ fontWeight: 700 }}>{row.name}</td>
                  <td><span className={`tag ${PLAN_TAG[row.plan]}`}>{PLAN_LABEL[row.plan]}</span></td>
                  <td style={{ fontWeight: 800 }}>{money(row.pricePerMonth)}</td>
                  <td>{CYCLE_LABEL[row.cycle]}</td>
                  <td className="text-muted">
                    {row.nextInvoiceDate
                      ? new Date(row.nextInvoiceDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
                      : '—'}
                  </td>
                  <td><span className={`tag ${STATUS_TAG[row.status]}`}>{STATUS_LABEL[row.status]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
    </>
  );
}
