/**
 * useRatings — fetches rated tracks for the Ratings view.
 *
 * Separate from useTracks because the Ratings page only cares about
 * tracks that have a rating, sorted by score. Keeping concerns isolated
 * avoids over-fetching on the Dashboard.
 */

import { useState, useEffect } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getRatedTracks } from '../services/ratings';
import type { Track } from '../types';

interface RatedTrackRow {
  rating: number;
  created_at: string;
  track: Track;
}

interface UseRatingsResult {
  ratedTracks: RatedTrackRow[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useRatings(session: Session | null): UseRatingsResult {
  const [ratedTracks, setRatedTracks] = useState<RatedTrackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0); // increment to trigger reload

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
        const data = await getRatedTracks(userId);
        if (!cancelled) setRatedTracks(data as unknown as RatedTrackRow[]);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [userId, tick]);

  const reload = () => setTick((n) => n + 1);

  return { ratedTracks, loading, error, reload };
}
