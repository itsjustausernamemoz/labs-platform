import { useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import logo from '@shared/assets/mashoke-logo.png';
import { signOutAdmin } from '../lib/auth';

export default function AdminNav() {
  const navigate = useNavigate();

  const handleLogout = async () => {
    await signOutAdmin();
    navigate('/', { replace: true });
  };

  return (
    <nav className="nav">
      <div className="nav-brand" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <img src={logo} alt="Mashoke Tech" style={{ width: 30, height: 30, objectFit: 'contain' }} />
        Mashoke Labs <span className="tag tag-outline" style={{ marginLeft: 4 }}>Platform Admin</span>
      </div>
      <button className="btn btn-icon btn-secondary" title="Log out" onClick={handleLogout}>
        <LogOut size={16} />
      </button>
    </nav>
  );
}
