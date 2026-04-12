/**
 * Ratings — shows only rated tracks, sorted by score descending.
 *
 * Fetched from the `ratings` table (joined to tracks), so it only contains
 * tracks the user has explicitly rated. Sorted server-side by rating desc,
 * then client-side by name for equal ratings.
 */

import type { Session } from '@supabase/supabase-js';
import { useRatings } from '../hooks/useRatings';
import { upsertRating } from '../services/ratings';
import { StarRating } from '../components/StarRating';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { playTrack } from '../lib/playerStore';
import type { Track } from '../types';

interface RatingsProps {
  session: Session;
}

export function Ratings({ session }: RatingsProps) {
  const { ratedTracks, loading, error, reload } = useRatings(session);

  const handleRate = async (trackId: string, rating: number) => {
    try {
      await upsertRating(session.user.id, trackId, rating);
      reload(); // refresh sorted list after change
    } catch (err) {
      console.error('Rating update failed:', err);
    }
  };

  return (
    <div className="page">
      <div className="page-title-row">
        <h2 className="page-title">Your Ratings</h2>
        {!loading && (
          <span className="page-subtitle">{ratedTracks.length} rated track{ratedTracks.length !== 1 ? 's' : ''}</span>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <LoadingSpinner message="Loading ratings…" />
      ) : ratedTracks.length === 0 ? (
        <div className="empty-state">
          <p>No ratings yet.</p>
          <p>Head to your <strong>Library</strong> and star some tracks.</p>
        </div>
      ) : (
        <div className="ratings-list">
          {ratedTracks.map(({ rating, track }) => {
            const t = track as Track;
            return (
              <div key={t.id} className="rating-row">
                <div className="rating-score">
                  <span className="rating-number">{rating}</span>
                  <span className="rating-max">/5</span>
                </div>

                <div
                  className={`rating-art${t.source_id.startsWith('spotify:') ? ' track-art--playable' : ''}`}
                  onClick={t.source_id.startsWith('spotify:') ? () => playTrack(t) : undefined}
                  role={t.source_id.startsWith('spotify:') ? 'button' : undefined}
                  tabIndex={t.source_id.startsWith('spotify:') ? 0 : undefined}
                  onKeyDown={t.source_id.startsWith('spotify:') ? (e) => e.key === 'Enter' && playTrack(t) : undefined}
                  aria-label={t.source_id.startsWith('spotify:') ? `Play ${t.name}` : undefined}
                >
                  {t.image_url ? (
                    <img src={t.image_url} alt={t.album} loading="lazy" />
                  ) : (
                    <div className="track-art-placeholder" aria-hidden="true">♪</div>
                  )}
                  {t.source_id.startsWith('spotify:') && <div className="track-art-play">▶</div>}
                </div>

                <div className="rating-info">
                  <p className="track-name">{t.name}</p>
                  <p className="track-artist">{t.artist}</p>
                  <p className="track-album">{t.album}</p>
                </div>

                <div className="rating-stars">
                  <StarRating
                    value={rating}
                    onRate={(newRating) => handleRate(t.id, newRating)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
