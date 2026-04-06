/**
 * App — root component.
 *
 * Auth flow:
 *  - onAuthStateChange is the single source of truth for session state.
 *  - On SIGNED_IN after OAuth, provider_token is present — we persist the
 *    Spotify tokens to the `users` table here so AuthCallback doesn't need
 *    its own Supabase subscriber (which caused timing/StrictMode conflicts).
 *  - AuthCallback receives `session` as a prop and simply waits for it to
 *    become non-null before navigating to /dashboard.
 */

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { Navbar } from './components/Navbar';
import { LoadingSpinner } from './components/LoadingSpinner';
import { Login } from './pages/Login';
import { AuthCallback } from './pages/AuthCallback';
import { Dashboard } from './pages/Dashboard';
import { Ratings } from './pages/Ratings';

// ─── User profile persistence ─────────────────────────────────────────────────

async function storeUserProfile(session: Session) {
  const user = session.user;

  const spotifyId =
    user.user_metadata?.provider_id ??
    user.identities?.find((i) => i.provider === 'spotify')?.id ??
    user.id;

  const tokenExpiresAt = session.provider_token
    ? new Date(Date.now() + 3600 * 1000).toISOString()
    : null;

  const { error } = await supabase.from('users').upsert(
    {
      id: user.id,
      spotify_id: spotifyId,
      spotify_access_token: session.provider_token ?? null,
      spotify_refresh_token: session.provider_refresh_token ?? null,
      token_expires_at: tokenExpiresAt,
    },
    { onConflict: 'id' }
  );

  if (error) console.error('Failed to save user profile:', error.message);
}

// ─── Protected route wrapper ──────────────────────────────────────────────────

interface ProtectedProps {
  session: Session | null;
  children: ReactNode;
}

function Protected({ session, children }: ProtectedProps) {
  if (!session) return <Navigate to="/" replace />;
  return <>{children}</>;
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [resolving, setResolving] = useState(true);

  // Stable callback so the effect dependency array doesn't change
  const handleAuthChange = useCallback(
    async (event: string, session: Session | null) => {
      setSession(session);

      // provider_token is only present immediately after a fresh OAuth login.
      // Store it now — it won't be available on subsequent page loads.
      if (event === 'SIGNED_IN' && session?.provider_token) {
        await storeUserProfile(session);
      }
    },
    []
  );

  useEffect(() => {
    // onAuthStateChange fires INITIAL_SESSION immediately with whatever session
    // exists (or null). Using it as the primary source avoids a separate
    // getSession() call and the race conditions that come with two async reads.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        handleAuthChange(event, session);
        // Mark resolving done after the first event (INITIAL_SESSION)
        setResolving(false);
      }
    );

    return () => subscription.unsubscribe();
  }, [handleAuthChange]);

  if (resolving) {
    return <LoadingSpinner message="Loading…" />;
  }

  return (
    <BrowserRouter>
      {session && <Navbar user={session.user} />}

      <Routes>
        <Route
          path="/"
          element={session ? <Navigate to="/dashboard" replace /> : <Login />}
        />

        {/* Pass session down — AuthCallback just waits for it to be non-null */}
        <Route
          path="/auth/callback"
          element={<AuthCallback session={session} />}
        />

        <Route
          path="/dashboard"
          element={
            <Protected session={session}>
              <Dashboard session={session!} />
            </Protected>
          }
        />
        <Route
          path="/ratings"
          element={
            <Protected session={session}>
              <Ratings session={session!} />
            </Protected>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
