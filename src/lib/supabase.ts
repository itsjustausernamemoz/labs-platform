import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase credentials missing. Please check your .env file.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: {
    headers: {
      // Identifies this client in Supabase dashboard logs, making it easy
      // to monitor exam traffic and set up per-app rate-limit alerts.
      'X-App-Name': 'SecureLab-ExamPlatform',
    },
  },
});
