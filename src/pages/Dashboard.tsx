/**
 * Dashboard — the user's full Spotify library with inline star ratings.
 *
 * Layout: sticky top bar (stats + sync button) + responsive track grid.
 * Rating flow:
 *   1. User clicks a star → `updateLocalRating` updates state immediately (optimistic).
 *   2. StarRating debounces the `onRate` callback by 500 ms.
 *   3. After debounce fires → `upsertRating` persists to Supabase.
 */

import type { Session } from '@supabase/supabase-js';
import { useTracks } from '../hooks/useTracks';
import { upsertRating } from '../services/ratings';
import { TrackCard } from '../components/TrackCard';
import { LoadingSpinner } from '../components/LoadingSpinner';

interface DashboardProps {
  session: Session;
}

export function Dashboard({ session }: DashboardProps) {
  const { tracks, loading, syncStatus, syncProgress, error, startSync, updateLocalRating } =
    useTracks(session);

  const handleRate = async (trackId: string, rating: number) => {
    // Optimistic update already applied by StarRating's debounce caller (updateLocalRating)
    try {
      await upsertRating(session.user.id, trackId, rating);
    } catch (err) {
      console.error('Rating save failed:', err);
    }
  };

  const handleStarClick = (trackId: string, rating: number) => {
    // Apply optimistic update immediately, then persist (debounced inside StarRating)
    updateLocalRating(trackId, rating);
    handleRate(trackId, rating);
  };

  const syncing = syncStatus === 'syncing';
  const ratedCount = tracks.filter((t) => t.rating !== null).length;

  return (
    <div className="page">
      {/* ── Top bar ── */}
      <div className="dashboard-header">
        <div className="dashboard-stats">
          <span><strong>{tracks.length}</strong> tracks</span>
          <span><strong>{ratedCount}</strong> rated</span>
        </div>

        <div className="dashboard-actions">
          {syncProgress && (
            <span className="sync-progress">
              Synced {syncProgress.synced} tracks…
            </span>
          )}
          {syncStatus === 'done' && (
            <span className="sync-done">Sync complete</span>
          )}
          <button
            className="btn-primary"
            onClick={startSync}
            disabled={syncing}
          >
            {syncing ? 'Syncing…' : 'Sync Library'}
          </button>
        </div>
      </div>

      {/* ── Error banner ── */}
      {error && <div className="error-banner">{error}</div>}

      {/* ── Content ── */}
      {loading ? (
        <LoadingSpinner message="Loading your library…" />
      ) : tracks.length === 0 ? (
        <div className="empty-state">
          <p>Your library is empty.</p>
          <p>Click <strong>Sync Library</strong> to import your Spotify saved tracks.</p>
        </div>
      ) : (
        <div className="track-grid">
          {tracks.map((track) => (
            <TrackCard
              key={track.id}
              track={track}
              onRate={handleStarClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}
