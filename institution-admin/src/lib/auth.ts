import { useEffect, useState } from 'react';
import { supabase } from '@shared/lib/apiClient';

export interface InstitutionAdmin {
  id: string;
  institution_id: string;
  full_name: string;
  email: string;
  active: boolean;
}

interface InstitutionAdminSessionState {
  loading: boolean;
  admin: InstitutionAdmin | null;
}

export function useInstitutionAdminSession(): InstitutionAdminSessionState {
  const [state, setState] = useState<InstitutionAdminSessionState>({ loading: true, admin: null });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) setState({ loading: false, admin: null });
        return;
      }
      const { data } = await supabase
        .from('institution_admins')
        .select('id, institution_id, full_name, email, active')
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

export async function signOutInstitutionAdmin() {
  await supabase.auth.signOut();
}
