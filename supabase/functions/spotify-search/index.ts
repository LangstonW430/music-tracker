/**
 * spotify-search — Supabase Edge Function
 *
 * Uses the Spotify Client Credentials flow to search tracks without
 * requiring any user login. The client secret stays server-side.
 *
 * Deploy:
 *   npx supabase functions deploy spotify-search
 *
 * Required secrets:
 *   npx supabase secrets set SPOTIFY_CLIENT_ID=xxx SPOTIFY_CLIENT_SECRET=yyy
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Cache the app-level token in memory for the lifetime of this function instance
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 10_000) {
    return cachedToken.value;
  }

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
    throw new Error(`Spotify auth failed: ${data?.error_description ?? data?.error ?? res.status}`);
  }
  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { query } = await req.json();

    if (!query?.trim()) {
      return new Response(JSON.stringify({ tracks: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = await getToken();

    const res = await fetch(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=10`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    const data = await res.json();
    if (!res.ok) {
      throw new Error(`Spotify error ${res.status}: ${data?.error?.message ?? JSON.stringify(data)}`);
    }

    const tracks = (data.tracks?.items ?? []).map((t: {
      id: string;
      name: string;
      artists: Array<{ name: string }>;
      album: { name: string; images: Array<{ url: string }> };
    }) => ({
      source_id: `spotify:${t.id}`,
      name: t.name,
      artist: t.artists[0]?.name ?? 'Unknown',
      album: t.album?.name ?? '',
      // Prefer the medium image (index 1) — good quality, reasonable size
      image_url: t.album?.images?.[1]?.url ?? t.album?.images?.[0]?.url ?? null,
    }));

    return new Response(JSON.stringify({ tracks }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
