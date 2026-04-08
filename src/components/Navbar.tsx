import { Link, useLocation } from 'react-router-dom';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface NavbarProps {
  user: SupabaseUser;
}

export function Navbar({ user }: NavbarProps) {
  const { pathname } = useLocation();

  const displayName = user.email ?? 'User';

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <nav className="navbar">
      <span className="navbar-brand">MusicTracker</span>

      <div className="navbar-links">
        <Link className={pathname === '/dashboard' ? 'nav-link active' : 'nav-link'} to="/dashboard">
          Library
        </Link>
        <Link className={pathname === '/ratings' ? 'nav-link active' : 'nav-link'} to="/ratings">
          Ratings
        </Link>
      </div>

      <div className="navbar-user">
        <span className="navbar-name">{displayName}</span>
        <button className="btn-ghost" onClick={handleSignOut}>
          Sign out
        </button>
      </div>
    </nav>
  );
}
