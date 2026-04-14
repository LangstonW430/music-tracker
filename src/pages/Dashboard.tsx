/**
 * Dashboard — the user's library with inline star ratings and manual track adding.
 *
 * Layout: sticky top bar (stats) + search + responsive track grid.
 */

import { useMemo, Profiler } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useTracks } from '../hooks/useTracks';
import { upsertRating } from '../services/ratings';
import { TrackCard } from '../components/TrackCard';
import { TrackSearch } from '../components/TrackSearch';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { profilerLog } from '../lib/perf';
import type { NormalisedTrack } from '../types';

interface DashboardProps {
  session: Session;
}

export function Dashboard({ session }: DashboardProps) {
  const { tracks, loading, error, addTrack, removeTrack, updateLocalRating } = useTracks(session);

  const handleRate = async (trackId: string, rating: number) => {
    updateLocalRating(trackId, rating);
    try {
      await upsertRating(session.user.id, trackId, rating);
    } catch (err) {
      console.error('Rating save failed:', err);
    }
  };

  const handleAdded = (track: NormalisedTrack) => addTrack(track);

  const ratedCount = useMemo(
    () => tracks.filter((t) => t.rating !== null).length,
    [tracks],
  );

  return (
    <div className="page">
      {/* ── Top bar ── */}
      <div className="dashboard-header">
        <div className="dashboard-stats">
          <span><strong>{tracks.length}</strong> tracks</span>
          <span><strong>{ratedCount}</strong> rated</span>
        </div>
      </div>

      {/* ── Search / add ── */}
      <TrackSearch userId={session.user.id} onAdded={handleAdded} />

      {/* ── Error banner ── */}
      {error && <div className="error-banner">{error}</div>}

      {/* ── Content ── */}
      {loading ? (
        <LoadingSpinner message="Loading your library…" />
      ) : tracks.length === 0 ? (
        <div className="empty-state">
          <p>Your library is empty.</p>
          <p>Search for a song above to add it.</p>
        </div>
      ) : (
        <Profiler id="track-grid" onRender={profilerLog}>
          <div className="track-grid">
            {tracks.map((track) => (
              <TrackCard
                key={track.id}
                track={track}
                onRate={handleRate}
                onRemove={removeTrack}
              />
            ))}
          </div>
        </Profiler>
      )}
    </div>
  );
}
