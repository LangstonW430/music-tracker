/**
 * Rating CRUD service.
 *
 * upsertRating is idempotent: calling it twice with different values for the
 * same (user, track) pair updates rather than duplicates (enforced by the
 * UNIQUE constraint on ratings(user_id, track_id) in Supabase).
 */

import { supabase } from '../lib/supabase';
import type { Rating } from '../types';

/**
 * Creates or updates a rating for a track.
 * Returns the persisted rating record.
 */
export async function upsertRating(
  userId: string,
  trackId: string,
  rating: number
): Promise<Rating> {
  if (rating < 1 || rating > 5) {
    throw new RangeError(`Rating must be 1–5, got ${rating}`);
  }

  const { data, error } = await supabase
    .from('ratings')
    .upsert(
      { user_id: userId, track_id: trackId, rating },
      { onConflict: 'user_id,track_id' }
    )
    .select()
    .single();

  if (error) throw new Error(`Failed to save rating: ${error.message}`);
  return data as Rating;
}

/**
 * Returns all rated tracks for the user, including full track details,
 * sorted by rating descending (then by track name for ties).
 */
export async function getRatedTracks(userId: string) {
  const { data, error } = await supabase
    .from('ratings')
    .select('rating, created_at, track:tracks(*)')
    .eq('user_id', userId)
    .order('rating', { ascending: false });

  if (error) throw new Error(`Failed to load ratings: ${error.message}`);

  // Secondary sort by track name for equal ratings
  return (data ?? []).sort((a, b) => {
    if (b.rating !== a.rating) return b.rating - a.rating;
    const nameA = (a.track as unknown as { name: string })?.name ?? '';
    const nameB = (b.track as unknown as { name: string })?.name ?? '';
    return nameA.localeCompare(nameB);
  });
}
