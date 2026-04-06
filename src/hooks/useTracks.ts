/**
 * useTracks — manages loading and syncing of the user's track library.
 *
 * State:
 *   tracks    — array of tracks enriched with ratings
 *   loading   — initial load in progress
 *   syncStatus — 'idle' | 'syncing' | 'done' | 'error'
 *   syncProgress — { synced, total } for progress display
 *   error     — most recent error message, or null
 *
 * The sync flow:
 *   1. Read the stored Spotify access token from the `users` table.
 *   2. Stream all saved tracks from Spotify page by page.
 *   3. After sync completes, reload tracks from Supabase (now includes new tracks).
 */

import { useState, useEffect, useCallback } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { getUserTracks, syncLibrary } from '../services/tracks';
import type { TrackWithRating, SyncStatus } from '../types';

interface UseTracksResult {
  tracks: TrackWithRating[];
  loading: boolean;
  syncStatus: SyncStatus;
  syncProgress: { synced: number } | null;
  error: string | null;
  startSync: () => Promise<void>;
  updateLocalRating: (trackId: string, rating: number) => void;
}

export function useTracks(session: Session | null): UseTracksResult {
  const [tracks, setTracks] = useState<TrackWithRating[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [syncProgress, setSyncProgress] = useState<{ synced: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const userId = session?.user.id ?? null;

  // Load library from Supabase on mount (or when user changes)
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

  // Sync library from Spotify then reload
  const startSync = useCallback(async () => {
    if (!userId || syncStatus === 'syncing') return;

    setSyncStatus('syncing');
    setSyncProgress({ synced: 0 });
    setError(null);

    try {
      // Fetch the stored Spotify access token from our users table
      const { data: userData, error: uError } = await supabase
        .from('users')
        .select('spotify_access_token')
        .eq('id', userId)
        .single();

      if (uError || !userData?.spotify_access_token) {
        throw new Error('No Spotify access token found. Please log in again.');
      }

      await syncLibrary(userId, userData.spotify_access_token, (synced) => {
        setSyncProgress({ synced });
      });

      // Reload library now that new tracks are in the DB
      const fresh = await getUserTracks(userId);
      setTracks(fresh);
      setSyncStatus('done');
    } catch (err) {
      setError((err as Error).message);
      setSyncStatus('error');
    } finally {
      setSyncProgress(null);
    }
  }, [userId, syncStatus]);

  /**
   * Optimistic local rating update — called immediately when the user clicks
   * a star, before the DB write completes (which is debounced in the component).
   */
  const updateLocalRating = useCallback((trackId: string, rating: number) => {
    setTracks((prev) =>
      prev.map((t) => (t.id === trackId ? { ...t, rating } : t))
    );
  }, []);

  return { tracks, loading, syncStatus, syncProgress, error, startSync, updateLocalRating };
}
