import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { perfStart, perfEnd } from './lib/perf';
import { Navbar } from './components/Navbar';
import { LoadingSpinner } from './components/LoadingSpinner';
import { SpotifyPlayer } from './components/SpotifyPlayer';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Ratings } from './pages/Ratings';
import { Recommendations } from './pages/Recommendations';
import { Profile } from './pages/Profile';

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [resolving, setResolving] = useState(true);

  useEffect(() => {
    const start = perfStart();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setResolving(false);
        perfEnd('session-resolve', start);
      }
    );
    return () => subscription.unsubscribe();
  }, []);

  if (resolving) {
    return <LoadingSpinner message="Loading…" />;
  }

  return (
    <BrowserRouter>
      {session && <Navbar user={session.user} />}
      <SpotifyPlayer />

      <Routes>
        <Route
          path="/"
          element={session ? <Navigate to="/dashboard" replace /> : <Login />}
        />

        <Route
          path="/dashboard"
          element={!session ? <Navigate to="/" replace /> : <Dashboard session={session} />}
        />
        <Route
          path="/ratings"
          element={!session ? <Navigate to="/" replace /> : <Ratings session={session} />}
        />
        <Route
          path="/recommendations"
          element={!session ? <Navigate to="/" replace /> : <Recommendations session={session} />}
        />
        <Route
          path="/profile"
          element={!session ? <Navigate to="/" replace /> : <Profile session={session} />}
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
