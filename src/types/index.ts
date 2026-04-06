// ─── Domain models (mirror Supabase tables) ──────────────────────────────────

export interface User {
  id: string;
  spotify_id: string;
  spotify_access_token: string | null;
  spotify_refresh_token: string | null;
  token_expires_at: string | null;
  created_at: string;
}

export interface Track {
  id: string;
  spotify_id: string;
  name: string;
  artist: string;
  album: string;
  image_url: string | null;
  created_at: string;
}

export interface UserTrack {
  user_id: string;
  track_id: string;
  added_at: string;
}

export interface Rating {
  id: string;
  user_id: string;
  track_id: string;
  rating: number; // 1–5
  created_at: string;
}

// Track enriched with the user's rating (null = unrated) and library timestamp
export interface TrackWithRating extends Track {
  rating: number | null;
  added_at: string;
}

// ─── Spotify Web API response shapes ─────────────────────────────────────────

export interface SpotifyTrack {
  id: string;
  name: string;
  artists: Array<{ name: string }>;
  album: {
    name: string;
    images: Array<{ url: string; width: number; height: number }>;
  };
}

export interface SpotifySavedTrack {
  added_at: string;
  track: SpotifyTrack;
}

export interface SpotifyPage<T> {
  items: T[];
  next: string | null;
  total: number;
  limit: number;
  offset: number;
}

// ─── UI state helpers ─────────────────────────────────────────────────────────

export type SyncStatus = 'idle' | 'syncing' | 'done' | 'error';
