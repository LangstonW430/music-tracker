// ─── Domain models (mirror Supabase tables) ──────────────────────────────────

export interface Track {
  id: string;
  source_id: string;
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

// A track result from an external search provider (e.g. Last.fm), before it is saved
export interface NormalisedTrack {
  source_id: string;
  name: string;
  artist: string;
  album: string;
  image_url: string | null;
}

// A personalised recommendation returned by the get-recommendations edge function
export interface Recommendation {
  source_id: string;
  name: string;
  artist: string;
  album: string;
  image_url: string | null;
  reason: string;
  type: 'content' | 'community' | 'trending' | 'new_release';
}
