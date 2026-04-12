import { useSyncExternalStore } from 'react';
import { getSnapshot, subscribe, closePlayer } from '../lib/playerStore';

export function SpotifyPlayer() {
  const track = useSyncExternalStore(subscribe, getSnapshot);

  if (!track) return null;

  // source_id format: "spotify:TRACK_ID"
  const spotifyId = track.source_id.startsWith('spotify:')
    ? track.source_id.slice(8)
    : null;

  if (!spotifyId) return null;

  const embedUrl = `https://open.spotify.com/embed/track/${spotifyId}?utm_source=generator&autoplay=1`;

  return (
    <div className="spotify-player">
      <iframe
        className="spotify-player-iframe"
        src={embedUrl}
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        loading="lazy"
        title={`${track.name} by ${track.artist}`}
      />
      <button
        className="spotify-player-close"
        onClick={closePlayer}
        aria-label="Close player"
        type="button"
      >
        ✕
      </button>
    </div>
  );
}
