import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Recommendation } from '../types';

interface UseRecommendationsResult {
  recommendations: Recommendation[];
  loading: boolean;
  error: string | null;
  hasRatings: boolean;
  fetch: () => Promise<void>;
}

export function useRecommendations(): UseRecommendationsResult {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasRatings, setHasRatings] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('get-recommendations');
      if (fnError) {
        const context = (fnError as { context?: Response }).context;
        if (context) {
          try {
            const body = await context.json();
            if (body?.error) { setError(body.error); return; }
          } catch { /* ignore parse failure */ }
        }
        setError(fnError.message);
        return;
      }
      if (data?.error) {
        setError(data.error);
      } else {
        setRecommendations(data?.recommendations ?? []);
        setHasRatings(data?.hasRatings ?? false);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  return { recommendations, loading, error, hasRatings, fetch };
}
