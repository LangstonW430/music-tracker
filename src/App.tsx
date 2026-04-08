import { useState, useEffect, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { Navbar } from './components/Navbar';
import { LoadingSpinner } from './components/LoadingSpinner';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Ratings } from './pages/Ratings';

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

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setResolving(false);
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

      <Routes>
        <Route
          path="/"
          element={session ? <Navigate to="/dashboard" replace /> : <Login />}
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
