import { useEffect, useState } from 'react';
import { supabase } from '@shared/lib/apiClient';

export interface PlatformAdmin {
  id: string;
  full_name: string;
  email: string;
  active: boolean;
}

interface AdminSessionState {
  loading: boolean;
  admin: PlatformAdmin | null;
}

export function useAdminSession(): AdminSessionState {
  const [state, setState] = useState<AdminSessionState>({ loading: true, admin: null });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) setState({ loading: false, admin: null });
        return;
      }
      const { data } = await supabase
        .from('platform_admins')
        .select('id, full_name, email, active')
        .eq('id', user.id)
        .maybeSingle();
      if (!cancelled) setState({ loading: false, admin: data && data.active ? data : null });
    };

    load();
    const { data: subscription } = supabase.auth.onAuthStateChange(() => load());
    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, []);

  return state;
}

export async function signOutAdmin() {
  await supabase.auth.signOut();
}
