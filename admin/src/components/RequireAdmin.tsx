import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAdminSession } from '../lib/auth';

export default function RequireAdmin({ children }: { children: ReactNode }) {
  const { loading, admin } = useAdminSession();

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <p className="text-muted">Loading…</p>
      </div>
    );
  }

  if (!admin) return <Navigate to="/" replace />;

  return <>{children}</>;
}
