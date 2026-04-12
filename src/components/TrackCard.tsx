import { StarRating } from './StarRating';
import { playTrack } from '../lib/playerStore';
import type { TrackWithRating } from '../types';

interface TrackCardProps {
  track: TrackWithRating;
  /** Called with the new rating value (after debounce). */
  onRate: (trackId: string, rating: number) => void;
}

export function TrackCard({ track, onRate }: TrackCardProps) {
  const canPlay = track.source_id.startsWith('spotify:');

  return (
    <article className="track-card">
      <div
        className={`track-art${canPlay ? ' track-art--playable' : ''}`}
        onClick={canPlay ? () => playTrack(track) : undefined}
        role={canPlay ? 'button' : undefined}
        tabIndex={canPlay ? 0 : undefined}
        onKeyDown={canPlay ? (e) => e.key === 'Enter' && playTrack(track) : undefined}
        aria-label={canPlay ? `Play ${track.name}` : undefined}
      >
        {track.image_url ? (
          <img src={track.image_url} alt={`${track.album} cover`} loading="lazy" />
        ) : (
          <div className="track-art-placeholder" aria-hidden="true">♪</div>
        )}
        {canPlay && <div className="track-art-play">▶</div>}
      </div>

      <div className="track-info">
        <p className="track-name" title={track.name}>{track.name}</p>
        <p className="track-artist" title={track.artist}>{track.artist}</p>
        <p className="track-album" title={track.album}>{track.album}</p>

        <StarRating
          value={track.rating}
          onRate={(rating) => onRate(track.id, rating)}
        />
      </div>
    </article>
  );
}
