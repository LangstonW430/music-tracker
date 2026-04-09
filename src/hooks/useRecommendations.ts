import { useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import type { Recommendation } from '../types';

interface UseRecommendationsResult {
  recommendations: Recommendation[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  hasRatings: boolean;
  fetch: () => Promise<void>;
  loadMore: () => Promise<void>;
  removeRecommendation: (sourceId: string) => void;
}

async function invokeRecommendations(excludeIds: string[]) {
  const { data, error: fnError } = await supabase.functions.invoke('get-recommendations', {
    body: { excludeIds },
  });
  if (fnError) {
    let msg = fnError.message;
    try {
      const context = (fnError as { context?: Response }).context;
      if (context) {
        const body = await context.json();
        if (body?.error) msg = body.error;
      }
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return {
    recommendations: (data?.recommendations ?? []) as Recommendation[],
    hasRatings: (data?.hasRatings ?? false) as boolean,
    hasMore: (data?.hasMore ?? false) as boolean,
  };
}

export function useRecommendations(): UseRecommendationsResult {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasRatings, setHasRatings] = useState(true);

  // Refs so loadMore stays stable (no deps) while always reading current values
  const seenIdsRef = useRef<Set<string>>(new Set());
  const loadingMoreRef = useRef(false);
  const hasMoreRef = useRef(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    seenIdsRef.current = new Set();
    try {
      const result = await invokeRecommendations([]);
      setRecommendations(result.recommendations);
      seenIdsRef.current = new Set(result.recommendations.map((r) => r.source_id));
      setHasRatings(result.hasRatings);
      hasMoreRef.current = result.hasMore;
      setHasMore(result.hasMore);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Stable callback — reads state via refs, never recreated
  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setError(null);
    try {
      const excludeIds = [...seenIdsRef.current];
      const result = await invokeRecommendations(excludeIds);
      if (result.recommendations.length === 0) {
        hasMoreRef.current = false;
        setHasMore(false);
        return;
      }
      setRecommendations((prev) => [...prev, ...result.recommendations]);
      for (const r of result.recommendations) seenIdsRef.current.add(r.source_id);
      hasMoreRef.current = result.hasMore;
      setHasMore(result.hasMore);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, []); // intentionally empty — reads live values via refs

  const removeRecommendation = useCallback((sourceId: string) => {
    setRecommendations((prev) => prev.filter((r) => r.source_id !== sourceId));
    seenIdsRef.current.delete(sourceId);
  }, []);

  return { recommendations, loading, loadingMore, hasMore, error, hasRatings, fetch, loadMore, removeRecommendation };
}
