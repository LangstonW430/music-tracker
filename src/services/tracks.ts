/**
 * Track library service.
 *
 * addTrackToLibrary: upserts a track (by source_id) then links it to the user.
 * getUserTracks: returns the user's full library enriched with ratings.
 */

import { supabase } from '../lib/supabase';
import type { TrackWithRating, NormalisedTrack } from '../types';

// ─── Add a track manually ─────────────────────────────────────────────────────

/**
 * Adds a track to the user's library.
 * The track row is upserted by source_id so duplicates are ignored.
 */
export async function addTrackToLibrary(
  userId: string,
  track: NormalisedTrack
): Promise<void> {
  // Upsert the track itself
  const { data: upserted, error: trackError } = await supabase
    .from('tracks')
    .upsert(
      {
        source_id: track.source_id,
        name: track.name,
        artist: track.artist,
        album: track.album,
        image_url: track.image_url,
      },
      { onConflict: 'source_id' }
    )
    .select('id')
    .single();

  if (trackError) throw new Error(`Failed to save track: ${trackError.message}`);

  // Link it to the user
  const { error: utError } = await supabase
    .from('user_tracks')
    .upsert(
      { user_id: userId, track_id: upserted.id, added_at: new Date().toISOString() },
      { onConflict: 'user_id,track_id', ignoreDuplicates: true }
    );

  if (utError) throw new Error(`Failed to add track to library: ${utError.message}`);
}

// ─── Remove a track from the user's library ───────────────────────────────────

export async function removeTrackFromLibrary(userId: string, trackId: string): Promise<void> {
  const { error } = await supabase
    .from('user_tracks')
    .delete()
    .eq('user_id', userId)
    .eq('track_id', trackId);

  if (error) throw new Error(`Failed to remove track: ${error.message}`);
}

// ─── Library queries ──────────────────────────────────────────────────────────

/**
 * Returns all tracks in the user's library, enriched with their current rating
 * (null if unrated). Ordered by date added, newest first.
 */
export async function getUserTracks(userId: string): Promise<TrackWithRating[]> {
  const { data: userTracks, error: utError } = await supabase
    .from('user_tracks')
    .select('added_at, track:tracks(*)')
    .eq('user_id', userId)
    .order('added_at', { ascending: false });

  if (utError) throw new Error(`Failed to load library: ${utError.message}`);

  const { data: ratingsData, error: rError } = await supabase
    .from('ratings')
    .select('track_id, rating')
    .eq('user_id', userId);

  if (rError) throw new Error(`Failed to load ratings: ${rError.message}`);

  const ratingsMap: Record<string, number> = {};
  for (const r of ratingsData ?? []) {
    ratingsMap[r.track_id] = r.rating;
  }

  return (userTracks ?? []).map((row) => {
    const track = row.track as unknown as TrackWithRating;
    return {
      ...track,
      added_at: row.added_at,
      rating: ratingsMap[track.id] ?? null,
    };
  });
}
