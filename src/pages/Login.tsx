import { useState } from 'react';
import { supabase } from '../lib/supabase';

type Mode = 'signin' | 'signup';

export function Login() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
    } else {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) setError(error.message);
      else setMessage('Check your email for a confirmation link.');
    }

    setLoading(false);
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo" aria-hidden="true">♫</div>
        <h1 className="login-title">MusicTracker</h1>
        <p className="login-subtitle">Rate and track the music you love.</p>

        <form onSubmit={handleSubmit} className="login-form">
          <input
            className="input"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
          <input
            className="input"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          />

          {error && <p className="form-error">{error}</p>}
          {message && <p className="form-success">{message}</p>}

          <button className="btn-primary" type="submit" disabled={loading}>
            {loading ? '…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <p className="login-switch">
          {mode === 'signin' ? (
            <>No account?{' '}
              <button className="btn-link" onClick={() => { setMode('signup'); setError(null); setMessage(null); }}>
                Sign up
              </button>
            </>
          ) : (
            <>Already have an account?{' '}
              <button className="btn-link" onClick={() => { setMode('signin'); setError(null); setMessage(null); }}>
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
