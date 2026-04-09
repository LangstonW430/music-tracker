import type { Recommendation } from '../types';

interface RecommendationCardProps {
  rec: Recommendation;
  onAdd: (rec: Recommendation) => void;
}

export function RecommendationCard({ rec, onAdd }: RecommendationCardProps) {
  return (
    <div className="rec-card">
      <div className="rec-art">
        {rec.image_url ? (
          <img src={rec.image_url} alt={rec.album} loading="lazy" />
        ) : (
          <div className="track-art-placeholder" aria-hidden="true">♪</div>
        )}
      </div>
      <div className="rec-info">
        <p className="track-name" title={rec.name}>{rec.name}</p>
        <p className="track-artist" title={rec.artist}>{rec.artist}</p>
        <p className="rec-reason">{rec.reason}</p>
        <button className="btn-primary rec-add" onClick={() => onAdd(rec)} type="button">
          + Add
        </button>
      </div>
    </div>
  );
}
