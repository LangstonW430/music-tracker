/**
 * get-recommendations — Supabase Edge Function
 *
 * Sources (all non-blocking — each fails gracefully):
 *  1. Content-based: user's top-rated artists → their Spotify top tracks
 *  2. Community: tracks rated 4★+ by other users, sorted by popularity
 *  3. Trending: most-added tracks sitewide
 *  4. New release / popular fallback via Spotify search
 *  5. Last-resort: well-known artist top tracks
 *
 * Accepts POST body: { excludeIds?: string[] }
 * excludeIds: source_ids already shown to the client (used for pagination)
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

    // Parse pagination params from body
    let excludeIds: string[] = [];
    try {
      if (req.method === 'POST') {
        const body = await req.json().catch(() => ({}));
        excludeIds = Array.isArray(body?.excludeIds) ? body.excludeIds : [];
      }
    } catch { /* ignore parse errors */ }

    const page = Math.floor(excludeIds.length / 24);

    const userId = user.id;
    const recs: Recommendation[] = [];
    // seed `seen` with already-shown ids so we never repeat them
    const seen = new Set<string>(excludeIds);

    // ── Parallel DB queries ───────────────────────────────────────────────────

    const [libraryResult, ratingsResult, trendingResult, communityResult] = await Promise.all([
      supabase
        .from('user_tracks')
        .select('track_id, track:tracks(source_id)')
        .eq('user_id', userId),
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

    // Build sets of what the user already has — both by UUID and by source_id
    const libraryRows = libraryResult.data ?? [];
    const libraryIds = new Set<string>(
      libraryRows.map((r: { track_id: string }) => r.track_id)
    );
    // Handle both object and array shapes that Supabase may return for the join
    const librarySourceIds = new Set<string>();
    for (const r of libraryRows as Array<{ track: { source_id: string } | { source_id: string }[] | null }>) {
      if (!r.track) continue;
      const t = Array.isArray(r.track) ? r.track[0] : r.track;
      if (t?.source_id) librarySourceIds.add(t.source_id);
    }
    // Also exclude already-seen ids from source id set (for Spotify checks)
    for (const id of excludeIds) librarySourceIds.add(id);

    // ── 1. Content-based: artist top tracks ───────────────────────────────────

    const topRatings = (ratingsResult.data ?? []) as Array<{
      rating: number;
      track: { source_id: string; name: string; artist: string } | null;
    }>;

    const artistToTrack = new Map<string, string>();
    for (const r of topRatings) {
      if (r.track?.artist && !artistToTrack.has(r.track.artist)) {
        artistToTrack.set(r.track.artist, r.track.name);
      }
    }

    if (artistToTrack.size > 0) {
      try {
        const token = await getSpotifyToken();

        // Use more artists on later pages
        const maxArtists = 4 + page * 2;
        const artists = [...artistToTrack.entries()].slice(0, maxArtists);
        const searchResults = await Promise.allSettled(
          artists.map(([name]) =>
            spotifyGet(`/search?q=${encodeURIComponent(name)}&type=artist&limit=1`, token)
          )
        );

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
          for (const t of (result.value.tracks ?? [])) {
            const sourceId = `spotify:${t.id}`;
            if (seen.has(sourceId) || librarySourceIds.has(sourceId)) continue;
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
      } catch { /* Spotify unavailable — skip content recs */ }
    }

    // ── 2. Community: popular among other users ───────────────────────────────

    const popularMap = new Map<string, { track: Record<string, unknown>; count: number }>();
    for (const row of (communityResult.data ?? []) as Array<{
      track_id: string; track: Record<string, unknown> | null;
    }>) {
      if (!row.track || libraryIds.has(row.track_id)) continue;
      const sourceId = row.track.source_id as string;
      if (seen.has(sourceId)) continue;
      const entry = popularMap.get(row.track_id);
      if (entry) entry.count++;
      else popularMap.set(row.track_id, { track: row.track, count: 1 });
    }

    for (const { track, count } of [...popularMap.values()].sort((a, b) => b.count - a.count).slice(0, 15)) {
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

    // ── 3. Trending: most-added tracks sitewide ───────────────────────────────

    const trendingMap = new Map<string, { track: Record<string, unknown>; count: number }>();
    for (const row of (trendingResult.data ?? []) as Array<{
      track_id: string; track: Record<string, unknown> | null;
    }>) {
      if (!row.track || libraryIds.has(row.track_id)) continue;
      const sourceId = row.track.source_id as string;
      if (seen.has(sourceId)) continue;
      const entry = trendingMap.get(row.track_id);
      if (entry) entry.count++;
      else trendingMap.set(row.track_id, { track: row.track, count: 1 });
    }

    for (const { track, count } of [...trendingMap.values()].sort((a, b) => b.count - a.count).slice(0, 15)) {
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

    // ── 4. Popular tracks via Spotify search ──────────────────────────────────

    const searchQueries = [
      ['year:2024', 'year:2025', 'genre:pop', 'genre:hip-hop'],
      ['genre:rock', 'genre:r-n-b', 'genre:electronic', 'genre:indie'],
      ['genre:rap', 'genre:soul', 'genre:country', 'genre:latin'],
      ['genre:jazz', 'genre:metal', 'genre:reggae', 'genre:alternative'],
    ];
    const pageQueries = searchQueries[page % searchQueries.length];
    const spotifyOffset = Math.floor(page / searchQueries.length) * 10;

    try {
      const token = await getSpotifyToken();
      for (const q of pageQueries) {
        if (recs.length >= 24) break;
        try {
          const data = await spotifyGet(
            `/search?q=${encodeURIComponent(q)}&type=track&limit=10&offset=${spotifyOffset}&market=US`,
            token
          );
          for (const t of (data?.tracks?.items ?? [])) {
            const sourceId = `spotify:${t.id}`;
            if (seen.has(sourceId) || librarySourceIds.has(sourceId)) continue;
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
    } catch { /* Spotify unavailable */ }

    // ── 5. Last-resort: well-known artist top tracks ──────────────────────────

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
            if (seen.has(sourceId) || librarySourceIds.has(sourceId)) continue;
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
        hasMore: recs.length > 0,
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
