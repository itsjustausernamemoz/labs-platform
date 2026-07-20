import { NavLink } from 'react-router-dom';

const TABS = [
  { to: '/overview', label: 'Overview' },
  { to: '/institutions', label: 'Institutions' },
  { to: '/users', label: 'Users' },
  { to: '/billing', label: 'Billing & revenue' },
  { to: '/support', label: 'Support' },
  { to: '/audit-log', label: 'Audit log' },
  { to: '/settings', label: 'Settings' },
];

const linkStyle = (active: boolean): React.CSSProperties => ({
  padding: '9px 16px',
  fontSize: 12,
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  border: '1px solid var(--color-divider)',
  background: active ? 'var(--color-accent)' : 'transparent',
  color: active ? 'var(--color-bg)' : 'inherit',
  borderColor: active ? 'var(--color-accent)' : 'var(--color-divider)',
  textDecoration: 'none',
});

export default function AdminTabBar() {
  return (
    <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-6)', flexWrap: 'wrap' }}>
      {TABS.map(tab => (
        <NavLink key={tab.to} to={tab.to} style={({ isActive }) => linkStyle(isActive)}>
          {tab.label}
        </NavLink>
      ))}
    </div>
  );
}
