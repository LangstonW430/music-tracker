import { playTrack } from '../lib/playerStore';
import type { Recommendation } from '../types';

interface RecommendationCardProps {
  rec: Recommendation;
  onAdd: (rec: Recommendation) => void;
  isInLibrary?: boolean;
}

export function RecommendationCard({ rec, onAdd, isInLibrary = false }: RecommendationCardProps) {
  const canPlay = rec.source_id.startsWith('spotify:');

  return (
    <div className="rec-card">
      <div
        className={`rec-art${canPlay ? ' track-art--playable' : ''}`}
        onClick={canPlay ? () => playTrack(rec) : undefined}
        role={canPlay ? 'button' : undefined}
        tabIndex={canPlay ? 0 : undefined}
        onKeyDown={canPlay ? (e) => e.key === 'Enter' && playTrack(rec) : undefined}
        aria-label={canPlay ? `Play ${rec.name}` : undefined}
      >
        {rec.image_url ? (
          <img src={rec.image_url} alt={rec.album} loading="lazy" />
        ) : (
          <div className="track-art-placeholder" aria-hidden="true">♪</div>
        )}
        {canPlay && <div className="track-art-play">▶</div>}
      </div>
      <div className="rec-info">
        <p className="track-name" title={rec.name}>{rec.name}</p>
        <p className="track-artist" title={rec.artist}>{rec.artist}</p>
        <p className="rec-reason">{rec.reason}</p>
        {isInLibrary ? (
          <button className="btn-primary rec-add rec-add--in-library" disabled type="button">
            ✓ In library
          </button>
        ) : (
          <button className="btn-primary rec-add" onClick={() => onAdd(rec)} type="button">
            + Add
          </button>
        )}
      </div>
    </div>
  );
}
