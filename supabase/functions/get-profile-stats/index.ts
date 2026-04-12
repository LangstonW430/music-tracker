import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function getSpotifyToken(): Promise<string> {
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
  return data.access_token;
}

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

    const [{ data: libraryRows, error: libErr }, { data: ratingRows, error: ratErr }] =
      await Promise.all([
        supabase
          .from('user_tracks')
          .select('track_id, added_at, tracks(id, name, artist, album, image_url)')
          .eq('user_id', user.id)
          .order('added_at', { ascending: false }),
        supabase
          .from('ratings')
          .select('track_id, rating')
          .eq('user_id', user.id),
      ]);

    if (libErr) throw new Error(`Library query failed: ${libErr.message}`);
    if (ratErr) throw new Error(`Ratings query failed: ${ratErr.message}`);

    const ratingByTrackId: Record<string, number> = {};
    for (const r of (ratingRows ?? [])) ratingByTrackId[r.track_id] = r.rating;

    const tracks: Array<{
      id: string; name: string; artist: string;
      album: string; image_url: string | null;
      added_at: string; rating: number | null;
    }> = [];

    for (const row of (libraryRows ?? [])) {
      const t = Array.isArray(row.tracks) ? row.tracks[0] : row.tracks;
      if (!t) continue;
      tracks.push({
        id: t.id, name: t.name, artist: t.artist,
        album: t.album ?? '', image_url: t.image_url ?? null,
        added_at: row.added_at,
        rating: ratingByTrackId[row.track_id] ?? null,
      });
    }

    // ── Overview ──────────────────────────────────────────────────────────────

    const ratedTracks = tracks.filter((t) => t.rating !== null);
    const avgRating = ratedTracks.length > 0
      ? ratedTracks.reduce((s, t) => s + t.rating!, 0) / ratedTracks.length
      : 0;

    const ratingDist = [1, 2, 3, 4, 5].map((star) => ({
      star, count: ratedTracks.filter((t) => t.rating === star).length,
    }));

    // ── Top artists ───────────────────────────────────────────────────────────

    const artistCounts: Record<string, { count: number; ratings: number[] }> = {};
    for (const t of tracks) {
      if (!artistCounts[t.artist]) artistCounts[t.artist] = { count: 0, ratings: [] };
      artistCounts[t.artist].count++;
      if (t.rating !== null) artistCounts[t.artist].ratings.push(t.rating);
    }
    const topArtists = Object.entries(artistCounts)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 8)
      .map(([name, { count, ratings }]) => ({
        name, count,
        avgRating: ratings.length > 0
          ? Math.round((ratings.reduce((s, r) => s + r, 0) / ratings.length) * 10) / 10
          : null,
      }));

    // ── Top albums ────────────────────────────────────────────────────────────

    const albumCounts: Record<string, { count: number; artist: string }> = {};
    for (const t of tracks) {
      if (!t.album) continue;
      if (!albumCounts[t.album]) albumCounts[t.album] = { count: 0, artist: t.artist };
      albumCounts[t.album].count++;
    }
    const topAlbums = Object.entries(albumCounts)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5)
      .map(([name, { count, artist }]) => ({ name, count, artist }));

    // ── Recently added ────────────────────────────────────────────────────────

    const recentTracks = tracks.slice(0, 6).map((t) => ({
      name: t.name, artist: t.artist,
      image_url: t.image_url, added_at: t.added_at, rating: t.rating,
    }));

    // ── Top rated tracks ──────────────────────────────────────────────────────

    const topRatedTracks = ratedTracks
      .sort((a, b) => b.rating! - a.rating! || new Date(b.added_at).getTime() - new Date(a.added_at).getTime())
      .slice(0, 5)
      .map((t) => ({ name: t.name, artist: t.artist, image_url: t.image_url, rating: t.rating! }));

    // ── Monthly activity (last 6 months) ──────────────────────────────────────

    const now = new Date();
    const monthlyActivity = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const count = tracks.filter((t) => {
        const td = new Date(t.added_at);
        return td.getFullYear() === d.getFullYear() && td.getMonth() === d.getMonth();
      }).length;
      return {
        month: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        count,
      };
    });

    // ── Taste insights ────────────────────────────────────────────────────────

    const insights: Array<{ emoji: string; title: string; subtitle: string }> = [];

    // Rating coverage
    if (tracks.length > 0) {
      const pct = Math.round((ratedTracks.length / tracks.length) * 100);
      if (pct >= 80) insights.push({ emoji: '⭐', title: 'Dedicated Rater', subtitle: `${pct}% of your library is rated` });
      else if (pct >= 40) insights.push({ emoji: '📝', title: 'Active Rater', subtitle: `${pct}% of your library is rated` });
      else if (pct > 0) insights.push({ emoji: '🎧', title: 'Casual Browser', subtitle: `Only ${pct}% of tracks rated so far` });
    }

    // Rating personality
    if (ratedTracks.length >= 5) {
      const avg = Math.round(avgRating * 10) / 10;
      if (avg >= 4.2) insights.push({ emoji: '😄', title: 'Easy to Please', subtitle: `Average rating ${avg} ★ — you love what you add` });
      else if (avg <= 2.8) insights.push({ emoji: '🎯', title: 'Discerning Critic', subtitle: `Average rating ${avg} ★ — you hold a high bar` });
      else insights.push({ emoji: '⚖️', title: 'Balanced Listener', subtitle: `Average rating ${avg} ★ — fair and consistent` });
    }

    // Artist loyalty
    const topArtist = topArtists[0];
    if (topArtist && tracks.length >= 5) {
      const pct = Math.round((topArtist.count / tracks.length) * 100);
      if (pct >= 35) insights.push({ emoji: '🎤', title: 'Loyal Fan', subtitle: `${pct}% of your library is ${topArtist.name}` });
      else if (Object.keys(artistCounts).length >= Math.ceil(tracks.length * 0.7)) {
        insights.push({ emoji: '🌍', title: 'Genre Explorer', subtitle: `${Object.keys(artistCounts).length} different artists in your library` });
      }
    }

    // Collection size
    if (tracks.length >= 50) insights.push({ emoji: '📚', title: 'Serious Collector', subtitle: `${tracks.length} tracks in your library` });
    else if (tracks.length >= 20) insights.push({ emoji: '🎵', title: 'Growing Collection', subtitle: `${tracks.length} tracks and counting` });

    // Most common rating
    if (ratedTracks.length >= 5) {
      const modeStar = [...ratingDist].sort((a, b) => b.count - a.count)[0];
      if (modeStar.count >= 3) {
        insights.push({ emoji: '📊', title: 'Rating Pattern', subtitle: `Your most given rating is ${modeStar.star} ★` });
      }
    }

    // ── Spotify genres ────────────────────────────────────────────────────────

    const topGenres: string[] = [];
    try {
      const token = await getSpotifyToken();
      const artistNames = topArtists.slice(0, 5).map((a) => a.name);
      const searches = await Promise.allSettled(
        artistNames.map((name) =>
          fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(name)}&type=artist&limit=1`, {
            headers: { Authorization: `Bearer ${token}` },
          }).then((r) => r.json())
        )
      );
      const genreCount: Record<string, number> = {};
      for (const result of searches) {
        if (result.status === 'rejected') continue;
        const artist = result.value?.artists?.items?.[0];
        for (const genre of (artist?.genres ?? [])) {
          genreCount[genre] = (genreCount[genre] ?? 0) + 1;
        }
      }
      topGenres.push(
        ...Object.entries(genreCount)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([name]) => name)
      );

      // Genre diversity insight
      if (topGenres.length >= 6) {
        insights.push({ emoji: '🎼', title: 'Genre Explorer', subtitle: `Your taste spans ${topGenres.length} distinct genres` });
      }
    } catch { /* genres are optional */ }

    return new Response(
      JSON.stringify({
        overview: {
          totalTracks: tracks.length,
          totalRated: ratedTracks.length,
          avgRating: Math.round(avgRating * 10) / 10,
          uniqueArtists: Object.keys(artistCounts).length,
        },
        topGenres,
        topArtists,
        topAlbums,
        ratingDist,
        recentTracks,
        topRatedTracks,
        monthlyActivity,
        insights,
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
