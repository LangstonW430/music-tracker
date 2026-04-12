/**
 * useTracks — manages the user's track library.
 *
 * State:
 *   tracks    — array of tracks enriched with ratings
 *   loading   — initial load in progress
 *   error     — most recent error message, or null
 */

import { useState, useEffect, useCallback } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getUserTracks, addTrackToLibrary, removeTrackFromLibrary } from '../services/tracks';
import type { TrackWithRating, NormalisedTrack } from '../types';

interface UseTracksResult {
  tracks: TrackWithRating[];
  loading: boolean;
  error: string | null;
  addTrack: (track: NormalisedTrack) => Promise<void>;
  removeTrack: (trackId: string) => Promise<void>;
  updateLocalRating: (trackId: string, rating: number) => void;
}

export function useTracks(session: Session | null): UseTracksResult {
  const [tracks, setTracks] = useState<TrackWithRating[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const userId = session?.user.id ?? null;

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        const data = await getUserTracks(userId);
        if (!cancelled) setTracks(data);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [userId]);

  const addTrack = useCallback(
    async (track: NormalisedTrack) => {
      if (!userId) return;
      await addTrackToLibrary(userId, track);
      // Reload from DB so the new track has its real UUID (needed for ratings)
      const fresh = await getUserTracks(userId);
      setTracks(fresh);
    },
    [userId]
  );

  const removeTrack = useCallback(
    async (trackId: string) => {
      if (!userId) return;
      setTracks((prev) => prev.filter((t) => t.id !== trackId));
      await removeTrackFromLibrary(userId, trackId);
    },
    [userId]
  );

  const updateLocalRating = useCallback((trackId: string, rating: number) => {
    setTracks((prev) =>
      prev.map((t) => (t.id === trackId ? { ...t, rating } : t))
    );
  }, []);

  return { tracks, loading, error, addTrack, removeTrack, updateLocalRating };
}
