/**
 * Track search via the Spotify search Edge Function.
 *
 * The edge function uses Client Credentials flow so no user login is needed.
 * The client secret stays server-side; only the Supabase URL and anon key
 * are needed here.
 */

import { supabase } from '../lib/supabase';
import { perfStart, perfEnd } from '../lib/perf';
import type { NormalisedTrack } from '../types';

export async function searchTracks(query: string): Promise<NormalisedTrack[]> {
  if (!query.trim()) return [];

  const start = perfStart();
  try {
    const { data, error } = await supabase.functions.invoke('spotify-search', {
      body: { query },
    });

    if (error) {
      const detail = (error as { context?: Response }).context;
      if (detail) {
        try {
          const body = await detail.json();
          if (body?.error) throw new Error(body.error);
        } catch (inner) {
          if (inner instanceof Error && inner.message !== error.message) throw inner;
        }
      }
      throw new Error(error.message);
    }

    if (data?.error) throw new Error(data.error);

    return (data?.tracks ?? []) as NormalisedTrack[];
  } finally {
    perfEnd(`search "${query}"`, start);
  }
}
