/**
 * AuthCallback — waits for App.tsx to establish the session, then navigates.
 *
 * App.tsx owns the single onAuthStateChange subscription. When Supabase
 * finishes the PKCE code exchange it fires SIGNED_IN, App stores the Spotify
 * tokens, and sets `session` in state. That updated session prop flows here
 * and triggers the navigate to /dashboard.
 *
 * This component deliberately contains no Supabase calls — having a second
 * subscriber caused StrictMode timing conflicts that left the spinner stuck.
 */

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { LoadingSpinner } from '../components/LoadingSpinner';

interface AuthCallbackProps {
  session: Session | null;
}

export function AuthCallback({ session }: AuthCallbackProps) {
  const navigate = useNavigate();

  useEffect(() => {
    if (session) {
      navigate('/dashboard', { replace: true });
    }
  }, [session, navigate]);

  return <LoadingSpinner message="Finishing login…" />;
}
