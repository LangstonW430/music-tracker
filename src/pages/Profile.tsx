import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { LoadingSpinner } from '../components/LoadingSpinner';

interface ProfileStats {
  overview: {
    totalTracks: number;
    totalRated: number;
    avgRating: number;
    uniqueArtists: number;
  };
  topGenres: string[];
  topArtists: Array<{ name: string; count: number; avgRating: number | null }>;
  topAlbums: Array<{ name: string; count: number; artist: string }>;
  ratingDist: Array<{ star: number; count: number }>;
  recentTracks: Array<{
    name: string; artist: string;
    image_url: string | null; added_at: string; rating: number | null;
  }>;
  topRatedTracks: Array<{
    name: string; artist: string; image_url: string | null; rating: number;
  }>;
  monthlyActivity: Array<{ month: string; count: number }>;
  insights: Array<{ emoji: string; title: string; subtitle: string }>;
}

interface ProfileProps {
  session: Session;
}

export function Profile({ session }: ProfileProps) {
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.functions.invoke('get-profile-stats', { body: {} }).then(async ({ data, error: fnError }) => {
      if (fnError) {
        let detail = fnError.message;
        try {
          const ctx = (fnError as unknown as { context?: Response }).context;
          if (ctx) {
            const body = await ctx.json();
            detail = body?.error ?? body?.message ?? JSON.stringify(body);
          }
        } catch { /* ignore */ }
        setError(detail);
      } else if (data?.error) {
        setError(data.error);
      } else {
        setStats(data as ProfileStats);
      }
      setLoading(false);
    });
  }, []);

  const email = session.user.email ?? 'User';
  const initials = email.slice(0, 2).toUpperCase();
  const memberSince = new Date(session.user.created_at).toLocaleDateString('en-US', {
    month: 'long', year: 'numeric',
  });

  if (loading) return <LoadingSpinner message="Loading your stats…" />;
  if (error) return <div className="page"><div className="error-banner">Could not load profile: {error}</div></div>;
  if (!stats) return null;

  const { overview, topGenres, topArtists, topAlbums, ratingDist, recentTracks, topRatedTracks, monthlyActivity, insights } = stats;
  const maxRatingCount = Math.max(...ratingDist.map((d) => d.count), 1);
  const maxActivity = Math.max(...monthlyActivity.map((m) => m.count), 1);

  return (
    <div className="page">
      <div className="page-title-row">
        <h2 className="page-title">Profile</h2>
      </div>

      {/* User header */}
      <div className="profile-header">
        <div className="profile-avatar">{initials}</div>
        <div>
          <div className="profile-email">{email}</div>
          <div className="profile-since">Member since {memberSince}</div>
        </div>
      </div>

      {/* Overview stat cards */}
      <div className="profile-stats-grid">
        <StatCard label="Tracks" value={overview.totalTracks} />
        <StatCard label="Rated" value={overview.totalRated} />
        <StatCard
          label="Avg Rating"
          value={overview.avgRating > 0 ? `${overview.avgRating} ★` : '—'}
          accent={overview.avgRating > 0}
        />
        <StatCard label="Artists" value={overview.uniqueArtists} />
      </div>

      {overview.totalTracks === 0 ? (
        <div className="empty-state">
          <p>No stats yet.</p>
          <p>Head to your <strong>Library</strong> and add some tracks to get started.</p>
        </div>
      ) : (
        <div className="profile-content">

          {/* Taste Insights */}
          {insights.length > 0 && (
            <section className="profile-section">
              <h3 className="profile-section-title">Taste Insights</h3>
              <div className="insight-grid">
                {insights.map((ins) => (
                  <div key={ins.title} className="insight-card">
                    <span className="insight-emoji">{ins.emoji}</span>
                    <span className="insight-title">{ins.title}</span>
                    <span className="insight-subtitle">{ins.subtitle}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Genres */}
          {topGenres.length > 0 && (
            <section className="profile-section">
              <h3 className="profile-section-title">Your Genres</h3>
              <div className="genre-tags">
                {topGenres.map((g) => (
                  <span key={g} className="genre-tag">{g}</span>
                ))}
              </div>
            </section>
          )}

          <div className="profile-two-col">
            {/* Top Artists */}
            {topArtists.length > 0 && (
              <section className="profile-section">
                <h3 className="profile-section-title">Top Artists</h3>
                <div className="profile-list">
                  {topArtists.map((a, i) => (
                    <div key={a.name} className="profile-list-row">
                      <span className="profile-list-rank">{i + 1}</span>
                      <span className="profile-list-name">{a.name}</span>
                      <span className="profile-list-meta">{a.count} track{a.count !== 1 ? 's' : ''}</span>
                      {a.avgRating !== null && (
                        <span className="profile-list-rating">{a.avgRating} ★</span>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Rating distribution */}
            {overview.totalRated > 0 && (
              <section className="profile-section">
                <h3 className="profile-section-title">Rating Breakdown</h3>
                <div className="rating-dist">
                  {[...ratingDist].reverse().map(({ star, count }) => (
                    <div key={star} className="rating-dist-row">
                      <span className="rating-dist-label">{star} ★</span>
                      <div className="rating-dist-bar-track">
                        <div className="rating-dist-bar" style={{ width: `${(count / maxRatingCount) * 100}%` }} />
                      </div>
                      <span className="rating-dist-count">{count}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* Top Rated Tracks */}
          {topRatedTracks.length > 0 && (
            <section className="profile-section">
              <h3 className="profile-section-title">Top Rated Tracks</h3>
              <div className="profile-list">
                {topRatedTracks.map((t, i) => (
                  <div key={`${t.name}-${t.artist}`} className="profile-list-row">
                    <span className="profile-list-rank">{i + 1}</span>
                    {t.image_url ? (
                      <img src={t.image_url} alt="" className="profile-list-art" />
                    ) : (
                      <div className="profile-list-art profile-list-art--empty" />
                    )}
                    <div className="profile-list-info">
                      <span className="profile-list-name">{t.name}</span>
                      <span className="profile-list-sub">{t.artist}</span>
                    </div>
                    <span className="profile-list-rating">{t.rating} ★</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className="profile-two-col">
            {/* Top Albums */}
            {topAlbums.length > 0 && (
              <section className="profile-section">
                <h3 className="profile-section-title">Top Albums</h3>
                <div className="profile-list">
                  {topAlbums.map((a, i) => (
                    <div key={a.name} className="profile-list-row">
                      <span className="profile-list-rank">{i + 1}</span>
                      <div className="profile-list-info">
                        <span className="profile-list-name">{a.name}</span>
                        <span className="profile-list-sub">{a.artist}</span>
                      </div>
                      <span className="profile-list-meta">{a.count} track{a.count !== 1 ? 's' : ''}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Recently Added */}
            {recentTracks.length > 0 && (
              <section className="profile-section">
                <h3 className="profile-section-title">Recently Added</h3>
                <div className="profile-list">
                  {recentTracks.map((t) => (
                    <div key={`${t.name}-${t.artist}`} className="profile-list-row">
                      {t.image_url ? (
                        <img src={t.image_url} alt="" className="profile-list-art" />
                      ) : (
                        <div className="profile-list-art profile-list-art--empty" />
                      )}
                      <div className="profile-list-info">
                        <span className="profile-list-name">{t.name}</span>
                        <span className="profile-list-sub">{t.artist}</span>
                      </div>
                      {t.rating !== null && (
                        <span className="profile-list-rating">{t.rating} ★</span>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* Monthly Activity */}
          <section className="profile-section">
            <h3 className="profile-section-title">Library Activity</h3>
            <p className="profile-section-sub">Tracks added per month</p>
            <div className="activity-chart">
              {monthlyActivity.map(({ month, count }) => (
                <div key={month} className="activity-col">
                  {count > 0 && <span className="activity-count">{count}</span>}
                  <div
                    className="activity-bar"
                    style={{ height: `${Math.max((count / maxActivity) * 100, count > 0 ? 6 : 2)}%` }}
                  />
                  <span className="activity-month">{month}</span>
                </div>
              ))}
            </div>
          </section>

        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, accent = false }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="stat-card">
      <span className={`stat-value${accent ? ' stat-value--accent' : ''}`}>{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}
