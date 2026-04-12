/**
 * get-recommendations — Supabase Edge Function
 *
 * Sources:
 *  1. Content: artist search — searches Spotify for tracks by artists in the
 *     user's library. Results are cached in the spotify_cache table for 6 hours
 *     so every user after the first to trigger a given artist/genre gets the
 *     result instantly with zero Spotify requests.
 *  2. Genre fallback — one cached search when personalized content is thin or
 *     the library is empty.
 *  3. Community / trending — optional extras when other users exist.
 *
 * POST body: { excludeIds?: string[], popular?: boolean }
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// ── Spotify token ─────────────────────────────────────────────────────��───────

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
  if (!res.ok || !data.access_token) throw new Error('Spotify auth failed');
  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.value;
}

async function spotifyGet(path: string, token: string): Promise<unknown> {
  const attempt = () =>
    fetch(`https://api.spotify.com/v1${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

  let res = await attempt();

  // On 429, wait the Retry-After duration (capped at 8 s) then try once more
  if (res.status === 429) {
    const wait = Math.min(parseInt(res.headers.get('Retry-After') ?? '2', 10) * 1000, 8000);
    await new Promise((r) => setTimeout(r, wait));
    res = await attempt();
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Spotify ${res.status}: ${body}`);
  }
  return res.json();
}

// ── Cache helpers (service role — bypasses RLS) ──────────────────────────���────

type CacheClient = ReturnType<typeof createClient>;

async function getCached(db: CacheClient, key: string): Promise<unknown[] | null> {
  const { data } = await db
    .from('spotify_cache')
    .select('data, cached_at')
    .eq('cache_key', key)
    .single();

  if (!data) return null;
  if (Date.now() - new Date(data.cached_at).getTime() > CACHE_TTL_MS) return null;
  return data.data as unknown[];
}

async function setCached(db: CacheClient, key: string, tracks: unknown[]): Promise<void> {
  if (tracks.length === 0) return; // don't cache empty results
  await db.from('spotify_cache').upsert({
    cache_key: key,
    data: tracks,
    cached_at: new Date().toISOString(),
  });
}

// ── Types ────────────────────────────���────────────────────────────��───────────

type Rec = {
  source_id: string;
  name: string;
  artist: string;
  album: string;
  image_url: string | null;
  reason: string;
  type: 'content' | 'community' | 'trending' | 'new_release';
};

type SpotifyTrack = {
  id: string;
  name: string;
  artists: Array<{ name: string }>;
  album: { name: string; images: Array<{ url: string }> };
};

const GENRES = ['pop', 'hip-hop', 'rock', 'r-n-b', 'electronic', 'indie', 'latin', 'dance'];

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    // User-scoped client for library/ratings queries
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    // Service-role client for cache r/w (bypasses RLS)
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    let excludeIds: string[] = [];
    let popular = false;
    try {
      if (req.method === 'POST') {
        const body = await req.json().catch(() => ({}));
        excludeIds = Array.isArray(body?.excludeIds) ? body.excludeIds : [];
        popular = body?.popular === true;
      }
    } catch { /* ignore */ }

    const page = Math.floor(excludeIds.length / 24);
    const spotifyOffset = page * 20;
    const recs: Rec[] = [];
    const seen = new Set<string>(excludeIds);
    const debug: string[] = [];

    // ── Fetch library, ratings, and community data ────────────────────────────

    const [libraryResult, ratingsResult, trendingResult, communityResult] = await Promise.all([
      userClient
        .from('user_tracks')
        .select('track_id, track:tracks(source_id, name, artist)')
        .eq('user_id', user.id)
        .order('added_at', { ascending: false })
        .limit(50),
      userClient
        .from('ratings')
        .select('rating, track:tracks(source_id, name, artist)')
        .eq('user_id', user.id)
        .gte('rating', 3)
        .order('rating', { ascending: false })
        .limit(20),
      userClient
        .from('user_tracks')
        .select('track_id, track:tracks(source_id, name, artist, album, image_url)')
        .neq('user_id', user.id)
        .limit(500),
      userClient
        .from('ratings')
        .select('track_id, track:tracks(source_id, name, artist, album, image_url)')
        .gte('rating', 4)
        .neq('user_id', user.id)
        .limit(200),
    ]);

    // Build library lookup
    const librarySourceIds = new Set<string>();
    const libraryIds = new Set<string>();
    const libraryArtists: string[] = [];

    for (const r of (libraryResult.data ?? []) as Array<{ track_id: string; track: { source_id: string; artist?: string } | null }>) {
      const t = Array.isArray(r.track) ? r.track[0] : r.track;
      if (!t?.source_id) continue;
      librarySourceIds.add(t.source_id);
      libraryIds.add(r.track_id);
      if (t.artist && !libraryArtists.includes(t.artist)) libraryArtists.push(t.artist);
    }
    for (const id of excludeIds) librarySourceIds.add(id);

    // Rated artists go first as seeds
    const priorityArtists: string[] = [];
    for (const r of (ratingsResult.data ?? []) as Array<{ track: { artist?: string } | null }>) {
      const t = Array.isArray(r.track) ? r.track[0] : r.track;
      if (t?.artist && !priorityArtists.includes(t.artist)) priorityArtists.push(t.artist);
    }
    for (const a of libraryArtists) {
      if (!priorityArtists.includes(a)) priorityArtists.push(a);
    }

    const hasLibrary = priorityArtists.length > 0;
    debug.push(`library:${libraryArtists.length} artists hasLibrary:${hasLibrary}`);

    // ── Helper: convert a raw Spotify track into a Rec ──────────────���─────────

    const toRec = (t: SpotifyTrack, reason: string, type: Rec['type']): Rec | null => {
      const sourceId = `spotify:${t.id}`;
      if (seen.has(sourceId) || librarySourceIds.has(sourceId)) return null;
      seen.add(sourceId);
      return {
        source_id: sourceId,
        name: t.name,
        artist: t.artists?.[0]?.name ?? '',
        album: t.album?.name ?? '',
        image_url: t.album?.images?.[1]?.url ?? t.album?.images?.[0]?.url ?? null,
        reason,
        type,
      };
    };

    // ── 1. Content: cached artist search (3 artists per page, sequential) ──────
    // Each artist result is cached independently so after the first user triggers
    // a given artist, every subsequent request is a free cache hit.

    if (!popular && priorityArtists.length > 0) {
      // Pick 3 artists, rotating which 3 are featured per page for variety
      const startIdx = (page * 3) % priorityArtists.length;
      const pickedArtists = Array.from({ length: Math.min(3, priorityArtists.length) }, (_, i) =>
        priorityArtists[(startIdx + i) % priorityArtists.length]
      );

      for (const artistName of pickedArtists) {
        const cacheKey = `artist:${artistName.toLowerCase()}:${page}`;
        try {
          let tracks = await getCached(serviceClient, cacheKey);
          if (!tracks) {
            const token = await getSpotifyToken();
            const data = await spotifyGet(
              `/search?q=${encodeURIComponent(artistName)}&type=track&limit=10`,
              token
            ) as { tracks?: { items: SpotifyTrack[] } };
            tracks = data?.tracks?.items ?? [];
            await setCached(serviceClient, cacheKey, tracks);
          }
          for (const t of tracks as SpotifyTrack[]) {
            const rec = toRec(t, `More from ${artistName}`, 'content');
            if (rec) recs.push(rec);
          }
        } catch (e) {
          debug.push(`artist:${artistName}:error:${String(e)}`);
        }
      }
      debug.push(`after_artists:${recs.length}`);
    }

    // ── 2. Community — highly rated by other users (optional) ─────────────────

    if (!popular) {
      const communityMap = new Map<string, { track: Record<string, unknown>; count: number }>();
      for (const row of (communityResult.data ?? []) as Array<{ track_id: string; track: Record<string, unknown> | null }>) {
        if (!row.track || libraryIds.has(row.track_id)) continue;
        const sourceId = row.track.source_id as string;
        if (seen.has(sourceId)) continue;
        const entry = communityMap.get(row.track_id);
        if (entry) entry.count++;
        else communityMap.set(row.track_id, { track: row.track, count: 1 });
      }
      for (const { track, count } of [...communityMap.values()].sort((a, b) => b.count - a.count).slice(0, 10)) {
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

      // ── 3. Trending — most-added sitewide (optional) ──────────────────────

      const trendingMap = new Map<string, { track: Record<string, unknown>; count: number }>();
      for (const row of (trendingResult.data ?? []) as Array<{ track_id: string; track: Record<string, unknown> | null }>) {
        if (!row.track || libraryIds.has(row.track_id)) continue;
        const sourceId = row.track.source_id as string;
        if (seen.has(sourceId)) continue;
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
    }

    // ── 4. Genre fallback — cached, runs when recs are thin ───────────────────

    debug.push(`genre_check: popular=${popular} recs=${recs.length}`);
    if (popular || recs.length < 12) {
      const genre = GENRES[page % GENRES.length];
      const cacheKey = `genre:${genre}:${page}`;
      debug.push(`genre:${genre} cache_key:${cacheKey}`);

      try {
        let tracks = await getCached(serviceClient, cacheKey);
        if (tracks) {
          debug.push('genre:cache_hit');
        } else {
          debug.push('genre:cache_miss — calling Spotify');
          const token = await getSpotifyToken();
          const genreUrl = `/search?q=${encodeURIComponent(`genre:${genre}`)}&type=track&limit=10`;
          const data = await spotifyGet(genreUrl, token) as { tracks?: { items: SpotifyTrack[] } };
          tracks = data?.tracks?.items ?? [];
          await setCached(serviceClient, cacheKey, tracks);
        }

        for (const t of tracks as SpotifyTrack[]) {
          const rec = toRec(t, 'Popular on Spotify', 'new_release');
          if (rec) recs.push(rec);
        }
        debug.push(`after_genre:${recs.length}`);
      } catch (e) {
        debug.push(`genre:error:${String(e)}`);
      }
    }

    debug.push(`final:${recs.length}`);

    return new Response(
      JSON.stringify({
        recommendations: recs.slice(0, 24),
        hasRatings: hasLibrary,
        hasMore: true,
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
