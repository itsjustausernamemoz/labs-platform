import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useInstitutionAdminSession, type InstitutionAdmin } from '../lib/auth';

export default function RequireInstitutionAdmin({ children }: { children: (admin: InstitutionAdmin) => ReactNode }) {
  const { loading, admin } = useInstitutionAdminSession();

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <p className="text-muted">Loading…</p>
      </div>
    );
  }

  if (!admin) return <Navigate to="/" replace />;

  return <>{children(admin)}</>;
}
