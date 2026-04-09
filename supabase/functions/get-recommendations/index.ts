/**
 * get-recommendations — Supabase Edge Function
 *
 * Three recommendation sources (all non-blocking — each fails gracefully):
 *
 *  1. Content-based: user's top-rated artists → their Spotify top tracks
 *  2. Community: tracks rated 4★+ by other users, sorted by popularity
 *  3. Trending fallback: most-added tracks sitewide (always has results)
 *
 * Required secrets: SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SUPABASE_URL, SUPABASE_ANON_KEY
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ─── Spotify helpers ──────────────────────────────────────────────────────────

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getSpotifyToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 10_000) return cachedToken.value;
  const id = Deno.env.get('SPOTIFY_CLIENT_ID')!;
  const secret = Deno.env.get('SPOTIFY_CLIENT_SECRET')!;
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${id}:${secret}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`Spotify auth failed: ${data?.error_description ?? data?.error}`);
  }
  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

async function spotifyGet(path: string, token: string) {
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Spotify ${res.status}: ${path}`);
  return res.json();
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Recommendation {
  source_id: string;
  name: string;
  artist: string;
  album: string;
  image_url: string | null;
  reason: string;
  type: 'content' | 'community' | 'trending' | 'new_release';
}

// ─── Handler ──────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    const userId = user.id;
    const recs: Recommendation[] = [];
    const seen = new Set<string>();

    // ── Parallel DB queries ───────────────────────────────────────────────────

    const [libraryResult, ratingsResult, trendingResult, communityResult] = await Promise.all([
      supabase.from('user_tracks').select('track_id').eq('user_id', userId),
      supabase
        .from('ratings')
        .select('rating, track:tracks(source_id, name, artist)')
        .eq('user_id', userId)
        .gte('rating', 3)
        .order('rating', { ascending: false })
        .limit(20),
      // Trending: most-added tracks sitewide
      supabase
        .from('user_tracks')
        .select('track_id, track:tracks(source_id, name, artist, album, image_url)')
        .neq('user_id', userId)
        .limit(500),
      // Community: tracks rated 4★+ by other users
      supabase
        .from('ratings')
        .select('track_id, track:tracks(source_id, name, artist, album, image_url)')
        .gte('rating', 4)
        .neq('user_id', userId)
        .limit(200),
    ]);

    const libraryIds = new Set(
      (libraryResult.data ?? []).map((r: { track_id: string }) => r.track_id)
    );

    // ── 1. Content-based: artist top tracks ───────────────────────────────────

    const topRatings = (ratingsResult.data ?? []) as Array<{
      rating: number;
      track: { source_id: string; name: string; artist: string };
    }>;

    // Unique artists from top-rated tracks, preserving rating order
    const artistToTrack = new Map<string, string>();
    for (const r of topRatings) {
      if (r.track?.artist && !artistToTrack.has(r.track.artist)) {
        artistToTrack.set(r.track.artist, r.track.name);
      }
    }

    if (artistToTrack.size > 0) {
      try {
        const token = await getSpotifyToken();

        // Search for each artist to get their Spotify ID (parallel)
        const artists = [...artistToTrack.entries()].slice(0, 4);
        const searchResults = await Promise.allSettled(
          artists.map(([name]) =>
            spotifyGet(`/search?q=${encodeURIComponent(name)}&type=artist&limit=1`, token)
          )
        );

        // Fetch top tracks for each found artist (parallel)
        const artistIds: Array<{ id: string; name: string; seedTrack: string }> = [];
        for (let i = 0; i < searchResults.length; i++) {
          const result = searchResults[i];
          if (result.status === 'rejected') continue;
          const artistId = result.value?.artists?.items?.[0]?.id;
          if (artistId) {
            artistIds.push({ id: artistId, name: artists[i][0], seedTrack: artists[i][1] });
          }
        }

        const topTracksResults = await Promise.allSettled(
          artistIds.map((a) => spotifyGet(`/artists/${a.id}/top-tracks?market=US`, token))
        );

        for (let i = 0; i < topTracksResults.length; i++) {
          const result = topTracksResults[i];
          if (result.status === 'rejected') continue;
          const artist = artistIds[i];
          for (const t of (result.value.tracks ?? []).slice(0, 5)) {
            const sourceId = `spotify:${t.id}`;
            if (seen.has(sourceId)) continue;
            seen.add(sourceId);
            recs.push({
              source_id: sourceId,
              name: t.name,
              artist: t.artists?.[0]?.name ?? artist.name,
              album: t.album?.name ?? '',
              image_url: t.album?.images?.[1]?.url ?? t.album?.images?.[0]?.url ?? null,
              reason: `Top track from ${artist.name}, because you liked "${artist.seedTrack}"`,
              type: 'content',
            });
          }
        }
      } catch { /* Spotify unavailable — skip content recs, fall through to trending */ }
    }

    // ── 2. Community: popular among other users ───────────────────────────────

    const popularMap = new Map<string, { track: Record<string, unknown>; count: number }>();
    for (const row of (communityResult.data ?? []) as Array<{
      track_id: string; track: Record<string, unknown>;
    }>) {
      if (!row.track || libraryIds.has(row.track_id)) continue;
      const entry = popularMap.get(row.track_id);
      if (entry) entry.count++;
      else popularMap.set(row.track_id, { track: row.track, count: 1 });
    }

    for (const { track, count } of [...popularMap.values()].sort((a, b) => b.count - a.count).slice(0, 8)) {
      const sourceId = track.source_id as string;
      if (seen.has(sourceId)) continue;
      seen.add(sourceId);
      recs.push({
        source_id: sourceId,
        name: track.name as string,
        artist: track.artist as string,
        album: track.album as string,
        image_url: track.image_url as string | null,
        reason: count === 1 ? 'Highly rated by another user' : `Highly rated by ${count} users`,
        type: 'community',
      });
    }

    // ── 3. Trending fallback: most-added tracks sitewide ─────────────────────

    const trendingMap = new Map<string, { track: Record<string, unknown>; count: number }>();
    for (const row of (trendingResult.data ?? []) as Array<{
      track_id: string; track: Record<string, unknown>;
    }>) {
      if (!row.track || libraryIds.has(row.track_id)) continue;
      const entry = trendingMap.get(row.track_id);
      if (entry) entry.count++;
      else trendingMap.set(row.track_id, { track: row.track, count: 1 });
    }

    for (const { track, count } of [...trendingMap.values()].sort((a, b) => b.count - a.count).slice(0, 10)) {
      const sourceId = track.source_id as string;
      if (seen.has(sourceId)) continue;
      seen.add(sourceId);
      recs.push({
        source_id: sourceId,
        name: track.name as string,
        artist: track.artist as string,
        album: track.album as string,
        image_url: track.image_url as string | null,
        reason: count === 1 ? 'Added by another user' : `Added by ${count} users`,
        type: 'trending',
      });
    }

    // ── 4. Popular tracks fallback: always available via Spotify search ───────
    // Uses broad search queries — no user data needed, works on any new site

    if (recs.length < 8) {
      const queries = ['year:2024', 'year:2025', 'genre:pop', 'genre:hip-hop'];
      try {
        const token = await getSpotifyToken();
        for (const q of queries) {
          if (recs.length >= 16) break;
          try {
            const data = await spotifyGet(
              `/search?q=${encodeURIComponent(q)}&type=track&limit=10&market=US`,
              token
            );
            for (const t of (data?.tracks?.items ?? [])) {
              const sourceId = `spotify:${t.id}`;
              if (seen.has(sourceId) || libraryIds.has(t.id)) continue;
              seen.add(sourceId);
              recs.push({
                source_id: sourceId,
                name: t.name,
                artist: t.artists?.[0]?.name ?? '',
                album: t.album?.name ?? '',
                image_url: t.album?.images?.[1]?.url ?? t.album?.images?.[0]?.url ?? null,
                reason: 'Popular on Spotify',
                type: 'new_release',
              });
            }
          } catch { /* skip this query */ }
        }
      } catch { /* Spotify unavailable — skip popular fallback */ }
    }

    // ── 5. Last-resort: fetch top tracks for well-known artists ──────────────
    // If everything else failed (Spotify search restricted, no community data)

    if (recs.length === 0) {
      const fallbackArtists = [
        { id: '06HL4z0CvFAxyc27GXpf02', name: 'Taylor Swift' },
        { id: '3TVXtAsR1Inumwj472S9r4', name: 'Drake' },
        { id: '1Xyo4u8uXC1ZmMpatF05PJ', name: 'The Weeknd' },
        { id: '6eUKZXaKkcviH0Ku9w2n3V', name: 'Ed Sheeran' },
      ];
      try {
        const token = await getSpotifyToken();
        const fallbackResults = await Promise.allSettled(
          fallbackArtists.map((a) => spotifyGet(`/artists/${a.id}/top-tracks?market=US`, token))
        );
        for (let i = 0; i < fallbackResults.length; i++) {
          const result = fallbackResults[i];
          if (result.status === 'rejected') continue;
          for (const t of (result.value.tracks ?? []).slice(0, 4)) {
            const sourceId = `spotify:${t.id}`;
            if (seen.has(sourceId)) continue;
            seen.add(sourceId);
            recs.push({
              source_id: sourceId,
              name: t.name,
              artist: t.artists?.[0]?.name ?? fallbackArtists[i].name,
              album: t.album?.name ?? '',
              image_url: t.album?.images?.[1]?.url ?? t.album?.images?.[0]?.url ?? null,
              reason: 'Popular on Spotify',
              type: 'new_release',
            });
          }
        }
      } catch { /* all Spotify calls failed */ }
    }

    return new Response(
      JSON.stringify({
        recommendations: recs.slice(0, 24),
        hasRatings: artistToTrack.size > 0,
      }),
      { headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  }
});
