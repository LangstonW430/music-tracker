/**
 * Track sync and library query service.
 *
 * sync flow:
 *  1. Stream saved tracks from Spotify page by page.
 *  2. Upsert each page into `tracks` (idempotent by spotify_id).
 *  3. Upsert the user–track relationships into `user_tracks`.
 *
 * The upsert strategy makes syncing safe to run multiple times — duplicate
 * tracks are ignored and existing records are updated in place.
 */

import { supabase } from '../lib/supabase';
import { streamAllSavedTracks } from './spotify';
import type { TrackWithRating } from '../types';

// ─── Library sync ─────────────────────────────────────────────────────────────

/**
 * Syncs the Spotify saved library for `userId` using the given `accessToken`.
 * Calls `onProgress(synced, total)` after each page so the UI can show progress.
 */
export async function syncLibrary(
  userId: string,
  accessToken: string,
  onProgress?: (synced: number, total: number) => void
): Promise<void> {
  let synced = 0;

  for await (const page of streamAllSavedTracks(accessToken)) {
    // Build the track rows to upsert
    const trackRows = page.map((item) => ({
      spotify_id: item.track.id,
      name: item.track.name,
      artist: item.track.artists[0]?.name ?? 'Unknown Artist',
      album: item.track.album.name,
      // Pick the smallest image ≥ 300 px, falling back to the first available
      image_url: pickImage(item.track.album.images),
    }));

    // Upsert tracks — `onConflict: 'spotify_id'` makes this idempotent
    const { data: upsertedTracks, error: tracksError } = await supabase
      .from('tracks')
      .upsert(trackRows, { onConflict: 'spotify_id' })
      .select('id, spotify_id');

    if (tracksError) throw new Error(`Track upsert failed: ${tracksError.message}`);

    // Build a spotify_id → UUID map so we can link user_tracks correctly
    const idMap: Record<string, string> = {};
    for (const t of upsertedTracks ?? []) {
      idMap[t.spotify_id] = t.id;
    }

    // Upsert user_tracks (user → track relationship)
    const userTrackRows = page
      .map((item) => ({
        user_id: userId,
        track_id: idMap[item.track.id],
        added_at: item.added_at,
      }))
      .filter((row) => row.track_id); // guard against any upsert gaps

    if (userTrackRows.length > 0) {
      const { error: utError } = await supabase
        .from('user_tracks')
        .upsert(userTrackRows, { onConflict: 'user_id,track_id', ignoreDuplicates: true });

      if (utError) throw new Error(`user_tracks upsert failed: ${utError.message}`);
    }

    synced += page.length;
    onProgress?.(synced, synced); // total unknown until last page; good enough for UX
  }
}

// ─── Library queries ──────────────────────────────────────────────────────────

/**
 * Returns all tracks in the user's library, enriched with their current rating
 * (null if unrated). Ordered by date added, newest first.
 */
export async function getUserTracks(userId: string): Promise<TrackWithRating[]> {
  // Fetch library
  const { data: userTracks, error: utError } = await supabase
    .from('user_tracks')
    .select('added_at, track:tracks(*)')
    .eq('user_id', userId)
    .order('added_at', { ascending: false });

  if (utError) throw new Error(`Failed to load library: ${utError.message}`);

  // Fetch all ratings for this user in one query
  const { data: ratingsData, error: rError } = await supabase
    .from('ratings')
    .select('track_id, rating')
    .eq('user_id', userId);

  if (rError) throw new Error(`Failed to load ratings: ${rError.message}`);

  // Build ratings lookup map
  const ratingsMap: Record<string, number> = {};
  for (const r of ratingsData ?? []) {
    ratingsMap[r.track_id] = r.rating;
  }

  // Merge
  return (userTracks ?? []).map((row) => {
    const track = row.track as unknown as TrackWithRating;
    return {
      ...track,
      added_at: row.added_at,
      rating: ratingsMap[track.id] ?? null,
    };
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pickImage(
  images: Array<{ url: string; width: number; height: number }>
): string | null {
  if (!images || images.length === 0) return null;
  // Prefer images closest to 300 px (good card size, not too heavy)
  const sorted = [...images].sort(
    (a, b) => Math.abs(a.width - 300) - Math.abs(b.width - 300)
  );
  return sorted[0].url;
}
